import { desc, eq, sql } from 'drizzle-orm';
import type { LedgerAction } from '@athena/shared';
import { env } from '../../config/env';
import type { Executor } from '../../db/client';
import { gradeLedger } from '../../db/schema';
import { hmac } from '../../lib/crypto';

export interface LedgerEntry {
  organizationId: string;
  examId: string;
  attemptId?: string | null;
  answerId?: string | null;
  action: LedgerAction;
  actorId?: string | null;
  previousScore?: number | null;
  newScore?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

const LOCK_KEY = 7_412_026; // serialises appends so the chain has a single tip

function digest(prevHash: string | null, e: LedgerEntry, createdAt: string) {
  const canonical = JSON.stringify([
    prevHash ?? '',
    e.organizationId,
    e.examId,
    e.attemptId ?? null,
    e.answerId ?? null,
    e.action,
    e.actorId ?? null,
    e.previousScore ?? null,
    e.newScore ?? null,
    e.reason ?? null,
    e.metadata ?? {},
    createdAt,
  ]);
  return hmac(env.LEDGER_SECRET, canonical);
}

/**
 * Appends one score change to the hash-chained ledger. Must run inside the transaction that changes the score,
 * so a score never changes without its ledger row (and vice versa).
 */
export async function appendLedger(tx: Executor, entry: LedgerEntry): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
  const [tip] = await tx.select({ hash: gradeLedger.hash }).from(gradeLedger).orderBy(desc(gradeLedger.seq)).limit(1);
  const createdAt = new Date();
  const hash = digest(tip?.hash ?? null, entry, createdAt.toISOString());
  await tx.insert(gradeLedger).values({
    organizationId: entry.organizationId,
    examId: entry.examId,
    attemptId: entry.attemptId ?? null,
    answerId: entry.answerId ?? null,
    action: entry.action,
    actorId: entry.actorId ?? null,
    previousScore: entry.previousScore ?? null,
    newScore: entry.newScore ?? null,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? {},
    prevHash: tip?.hash ?? null,
    hash,
    createdAt,
  });
}

/** Recomputes the whole chain. Any edited, inserted or deleted row breaks it at that point. */
export async function verifyLedger(db: Executor): Promise<{ ok: boolean; checked: number; brokenAtSeq: number | null }> {
  const rows = await db.select().from(gradeLedger).orderBy(gradeLedger.seq);
  let prev: string | null = null;
  for (const r of rows) {
    const expected = digest(
      prev,
      {
        organizationId: r.organizationId,
        examId: r.examId,
        attemptId: r.attemptId,
        answerId: r.answerId,
        action: r.action,
        actorId: r.actorId,
        previousScore: r.previousScore,
        newScore: r.newScore,
        reason: r.reason,
        metadata: r.metadata,
      },
      r.createdAt.toISOString(),
    );
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked: rows.length, brokenAtSeq: r.seq };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length, brokenAtSeq: null };
}

export const ledgerForExam = (db: Executor, examId: string) =>
  db.select().from(gradeLedger).where(eq(gradeLedger.examId, examId)).orderBy(gradeLedger.seq);
