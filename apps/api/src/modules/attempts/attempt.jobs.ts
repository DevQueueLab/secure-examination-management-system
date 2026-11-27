import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { RT } from '@athena/shared';
import type { Container } from '../../container';
import type { Database, Executor } from '../../db/client';
import { attemptEvents, attempts, outages, systemState } from '../../db/schema';
import { logger } from '../../lib/logger';
import type { Realtime } from '../../realtime/realtime';
import type { AuditService } from '../audit/audit.service';
import { timelineEvent } from './attempt.events';
import { DEADLINE_GRACE_MS } from './attempt.policy';
import { attemptEngine, type AttemptService } from './attempt.service';
import { deadlineGate } from './deadline-gate';

export const SWEEP_INTERVAL_MS = 5_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;
/** A heartbeat gap longer than this is an outage; an ordinary restart or deploy takes a few seconds. */
export const OUTAGE_THRESHOLD_MS = 30_000;
/** Compensation never adds more than this, however long the outage was. */
export const MAX_COMPENSATION_MS = 30 * 60_000;
export const HEARTBEAT_KEY = 'api.heartbeat';
const SWEEP_BATCH = 100;

export interface OutageCompensation {
  outageId: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  creditSeconds: number;
  attempts: {
    id: string;
    examId: string;
    organizationId: string;
    isSandbox: boolean;
    deadlineAt: Date;
  }[];
}

async function writeHeartbeat(db: Executor, now: Date): Promise<void> {
  const value = { at: now.toISOString() };
  await db
    .insert(systemState)
    .values({ key: HEARTBEAT_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: now } });
}

/**
 * Outage compensation, run once at startup before any deadline is enforced. The API writes a heartbeat every
 * 10 s; if the last one is more than 30 s old, the server was down for that gap and candidates' clocks kept
 * running. Every attempt whose clock was running when the outage began gets the lost time back (at most 30
 * minutes), which may run past the exam window: the time was lost to us, not to the candidate.
 * The heartbeat row is locked, so two processes starting together cannot compensate the same outage twice.
 */
export async function compensateOutage(
  deps: { db: Database; audit: Pick<AuditService, 'record'>; realtime: Realtime },
  now: Date,
): Promise<OutageCompensation | null> {
  const result = await deps.db.transaction(async (tx) => {
    const [beat] = await tx
      .select()
      .from(systemState)
      .where(eq(systemState.key, HEARTBEAT_KEY))
      .limit(1)
      .for('update');
    await writeHeartbeat(tx, now);
    const last = beat ? Date.parse(String(beat.value.at)) : Number.NaN;
    if (!Number.isFinite(last) || now.getTime() - last <= OUTAGE_THRESHOLD_MS) return null;

    const startedAt = new Date(last);
    const durationSeconds = Math.round((now.getTime() - last) / 1000);
    const creditSeconds = Math.round(Math.min(now.getTime() - last, MAX_COMPENSATION_MS) / 1000);
    // Clocks that were running when the outage began: started before it, deadline not yet reached at that moment.
    const running = await tx
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.status, 'in_progress'),
          lt(attempts.startedAt, startedAt),
          gt(attempts.deadlineAt, startedAt),
        ),
      )
      .for('update');
    const extended: OutageCompensation['attempts'] = [];
    for (const attempt of running) {
      const deadlineAt = new Date(attempt.deadlineAt.getTime() + creditSeconds * 1000);
      await tx
        .update(attempts)
        .set({
          deadlineAt,
          timeExtensionSeconds: attempt.timeExtensionSeconds + creditSeconds,
          updatedAt: now,
        })
        .where(eq(attempts.id, attempt.id));
      extended.push({
        id: attempt.id,
        examId: attempt.examId,
        organizationId: attempt.organizationId,
        isSandbox: attempt.isSandbox,
        deadlineAt,
      });
    }
    if (running.length > 0) {
      await tx.insert(attemptEvents).values(
        running.map((a) =>
          timelineEvent(
            a,
            'outage_compensated',
            'info',
            {
              seconds: creditSeconds,
              outageSeconds: durationSeconds,
              outageStartedAt: startedAt.toISOString(),
              previousDeadline: a.deadlineAt.toISOString(),
            },
            now,
          ),
        ),
      );
    }
    const [outage] = await tx
      .insert(outages)
      .values({ startedAt, endedAt: now, durationSeconds, compensatedAttempts: extended.length })
      .returning({ id: outages.id });
    return {
      outageId: outage!.id,
      startedAt,
      endedAt: now,
      durationSeconds,
      creditSeconds,
      attempts: extended,
    };
  });
  if (!result) return null;

  const reason = `Server outage: ${result.creditSeconds} s added back`;
  for (const a of result.attempts) {
    const payload = { attemptId: a.id, deadlineAt: a.deadlineAt.toISOString(), reason };
    deps.realtime.toAttempt(a.id, RT.timeExtended, payload);
    if (!a.isSandbox) deps.realtime.toExamStaff(a.examId, RT.timeExtended, payload);
  }
  const summary = `Server outage of ${result.durationSeconds} s detected`;
  await deps.audit.record({
    action: 'system.outage_detected',
    entityType: 'outage',
    entityId: result.outageId,
    summary,
    metadata: {
      startedAt: result.startedAt.toISOString(),
      endedAt: result.endedAt.toISOString(),
      creditSeconds: result.creditSeconds,
      attempts: result.attempts.length,
    },
  });
  const byOrganization = new Map<string, string[]>();
  for (const a of result.attempts)
    byOrganization.set(a.organizationId, [...(byOrganization.get(a.organizationId) ?? []), a.id]);
  for (const [organizationId, ids] of byOrganization) {
    await deps.audit.record({
      organizationId,
      action: 'attempt.outage_compensated',
      entityType: 'outage',
      entityId: result.outageId,
      summary: `${ids.length} attempt(s) in progress given ${result.creditSeconds} s back after a ${result.durationSeconds} s server outage`,
      metadata: {
        creditSeconds: result.creditSeconds,
        outageSeconds: result.durationSeconds,
        attemptIds: ids.slice(0, 200),
      },
    });
  }
  return result;
}

/** Submits every attempt whose deadline (plus the 2 s grace) has passed, each in its own transaction. */
export async function sweepExpiredAttempts(
  engine: AttemptService,
  db: Executor,
  now: Date,
): Promise<number> {
  const due = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(
      and(
        eq(attempts.status, 'in_progress'),
        lt(attempts.deadlineAt, new Date(now.getTime() - DEADLINE_GRACE_MS)),
      ),
    )
    .orderBy(asc(attempts.deadlineAt))
    .limit(SWEEP_BATCH);
  let finalized = 0;
  for (const { id } of due) {
    try {
      if ((await engine.finalize(id, 'timeout')).finalized) finalized++;
    } catch (err) {
      logger.error(
        { err, attemptId: id },
        'automatic submission failed; retrying on the next sweep',
      );
    }
  }
  return finalized;
}

/**
 * Background jobs of the attempt engine: outage compensation at startup, then the heartbeat and the deadline
 * sweep. Lazy deadline checks in the request path wait on the deadline gate until compensation has run, so no
 * attempt is finalized for time it lost to our own downtime.
 */
export function startAttemptJobs(c: Container): () => void {
  const engine = attemptEngine(c);
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let sweeping = false;
  deadlineGate.hold();

  const sweep = async () => {
    if (sweeping || stopped) return;
    sweeping = true;
    try {
      const n = await sweepExpiredAttempts(engine, c.db, new Date());
      if (n > 0) logger.info({ submitted: n }, 'attempts submitted at their deadline');
    } catch (err) {
      logger.error({ err }, 'deadline sweep failed');
    } finally {
      sweeping = false;
    }
  };

  void (async () => {
    try {
      const outage = await compensateOutage(
        { db: c.db, audit: c.audit, realtime: c.realtime },
        new Date(),
      );
      if (outage)
        logger.warn(
          { seconds: outage.durationSeconds, compensated: outage.attempts.length },
          'server outage compensated',
        );
    } catch (err) {
      logger.error({ err }, 'outage compensation failed');
    } finally {
      deadlineGate.open();
    }
    if (stopped) return;
    timers.push(
      setInterval(() => {
        writeHeartbeat(c.db, new Date()).catch((err: unknown) =>
          logger.error({ err }, 'heartbeat write failed'),
        );
      }, HEARTBEAT_INTERVAL_MS),
      setInterval(() => void sweep(), SWEEP_INTERVAL_MS),
    );
    void sweep();
  })();

  return () => {
    stopped = true;
    for (const t of timers) clearInterval(t);
  };
}
