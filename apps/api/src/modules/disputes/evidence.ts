import { asc, desc, eq, inArray, and } from 'drizzle-orm';
import { QUESTION_TYPE_META, isAutoGraded, type DisputeCategory, type QuestionType } from '@athena/shared';
import { env } from '../../config/env';
import type { Executor } from '../../db/client';
import { answers, attemptEvents, attemptItems, attempts, exams, gradeLedger, questions, rubricItems } from '../../db/schema';
import { canonicalJson } from '../../domain/ledger/ledger';
import { round3 } from '../../domain/rng';
import { hmac } from '../../lib/crypto';
import { formatCorrectAnswer, formatResponse, type FormattedResponse } from '../grading/response-format';

type AttemptRow = typeof attempts.$inferSelect;
type ExamRow = typeof exams.$inferSelect;
type ItemRow = typeof attemptItems.$inferSelect;
type AnswerRow = typeof answers.$inferSelect;

/** Lifecycle and connectivity events attached to technical-incident disputes. Integrity indicators are not. */
export const CONNECTIVITY_EVENTS = [
  'started',
  'resumed',
  'device_switched',
  'went_offline',
  'came_online',
  'offline_journal_received',
  'outage_compensated',
  'time_extended',
  'submitted',
  'auto_submitted',
  'force_submitted',
] as const;

export interface EvidenceParts {
  answer: { score: number | null; max: number; auto: boolean };
  working: { score: number | null; max: number } | null;
}

/**
 * What the dispute is about, frozen at the moment it is raised. Nothing here is recomputed later: if the answer is
 * re-graded or the rubric edited, the dispute still shows what the candidate disputed. The ledger head at that moment
 * and an HMAC seal make a quiet rewrite of this record detectable.
 */
export interface FrozenEvidence {
  version: 1;
  frozenAt: string;
  category: DisputeCategory;
  /** Tip of the grade ledger when the dispute was raised. */
  ledgerHead: { seq: number; hash: string } | null;
  exam: { id: string; title: string; code: string | null; resultsStatus: string; resultsVersion: number; resultsPublishedAt: string | null };
  attempt: {
    id: string;
    status: string;
    startedAt: string;
    submittedAt: string | null;
    submitReason: string | null;
    deadlineAt: string;
    timeExtensionSeconds: number;
    score: number | null;
    maxScore: number;
    gradingStatus: string;
  };
  item: {
    id: string;
    /** Number on this candidate's paper. */
    number: number;
    questionId: string;
    title: string;
    type: QuestionType;
    typeLabel: string;
    stem: string;
    /** Candidate-safe content exactly as delivered (their option order, their numbers). */
    content: Record<string, unknown>;
    marks: number;
    workingMarks: number;
    voidReason: string | null;
  } | null;
  answer: {
    id: string;
    response: Record<string, unknown> | null;
    formatted: FormattedResponse;
    working: { text: string; scratchPages: number } | null;
    answeredAt: string | null;
    timeSpentMs: number;
  } | null;
  score: { item: number | null; status: string; parts: EvidenceParts } | null;
  /** Rubric items applied at the time (labels and points). */
  rubric: { id: string; label: string; points: number; target: 'answer' | 'working' }[];
  feedback: string | null;
  /** The key in words. Staff only, unless results are published with correct answers shown. */
  correctAnswer: string | null;
  /** Staff only: who graded the disputed answer (conflict-of-interest check). */
  grading: { graderIds: string[]; gradedAt: string | null };
  incidents: { type: string; severity: string; at: string; detail: Record<string, unknown> }[];
  connectivity: { offlineSpells: number; offlineSeconds: number; timeExtendedSeconds: number; deviceSwitches: number; submitReason: string | null } | null;
  /** For appeals: the decision being appealed. */
  appealOf: { disputeId: string; outcome: string | null; note: string | null; resolvedAt: string | null; scoreBefore: number | null; scoreAfter: number | null } | null;
  seal: string;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Keeps payloads small and free of anything large or nested deeply. */
function boundedDetail(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload ?? {}).slice(0, 12)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
  }
  return out;
}

export function summarizeConnectivity(events: { type: string; at: Date; payload: Record<string, unknown> }[], submitReason: string | null) {
  let offlineSince: Date | null = null;
  let offlineSpells = 0;
  let offlineMs = 0;
  let extendedSeconds = 0;
  let deviceSwitches = 0;
  for (const e of events) {
    if (e.type === 'went_offline' && !offlineSince) {
      offlineSince = e.at;
      offlineSpells++;
    } else if ((e.type === 'came_online' || e.type === 'offline_journal_received') && offlineSince) {
      offlineMs += e.at.getTime() - offlineSince.getTime();
      offlineSince = null;
    } else if (e.type === 'time_extended' || e.type === 'outage_compensated') {
      const s = Number(e.payload.seconds ?? e.payload.extraSeconds ?? (Number(e.payload.minutes ?? 0) || 0) * 60);
      if (Number.isFinite(s)) extendedSeconds += s;
    } else if (e.type === 'device_switched') deviceSwitches++;
  }
  return { offlineSpells, offlineSeconds: Math.round(offlineMs / 1000), timeExtendedSeconds: Math.round(extendedSeconds), deviceSwitches, submitReason };
}

export const sealEvidence = (disputeId: string, evidence: Omit<FrozenEvidence, 'seal'>) =>
  hmac(env.LEDGER_SECRET, `dispute-evidence:${disputeId}:${canonicalJson(evidence)}`);

/** True when the stored evidence is byte-for-byte what was frozen for this dispute. */
export function verifyEvidenceSeal(disputeId: string, raw: Record<string, unknown>): boolean {
  if (!raw || typeof raw.seal !== 'string') return false;
  const { seal, ...rest } = raw;
  return sealEvidence(disputeId, rest as Omit<FrozenEvidence, 'seal'>) === seal;
}

export const graderIdsOf = (raw: Record<string, unknown> | null | undefined): string[] => {
  const g = (raw?.grading as { graderIds?: unknown } | undefined)?.graderIds;
  return Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : [];
};

/** Number of an item on the candidate's own paper (1-based, in delivered order). */
export async function itemNumbers(db: Executor, attemptId: string): Promise<Map<string, number>> {
  const rows = await db.select({ id: attemptItems.id }).from(attemptItems).where(eq(attemptItems.attemptId, attemptId)).orderBy(asc(attemptItems.position));
  return new Map(rows.map((r, i) => [r.id, i + 1]));
}

export function partsOf(item: Pick<ItemRow, 'type' | 'marks' | 'workingMarks'>, a: Pick<AnswerRow, 'autoScore' | 'manualScore' | 'workingScore'> | undefined): EvidenceParts {
  const auto = isAutoGraded(item.type);
  return {
    answer: { score: auto ? (a?.autoScore ?? 0) : (a?.manualScore ?? null), max: item.marks, auto },
    working: item.workingMarks > 0 ? { score: a?.workingScore ?? null, max: item.workingMarks } : null,
  };
}

export interface FreezeInput {
  disputeId: string;
  category: DisputeCategory;
  exam: ExamRow;
  attempt: AttemptRow;
  item: ItemRow | null;
  answer: AnswerRow | null;
  appealOf?: FrozenEvidence['appealOf'];
  now?: Date;
}

/** Builds and seals the evidence record. Run it inside the transaction that creates the dispute. */
export async function freezeEvidence(tx: Executor, input: FreezeInput): Promise<FrozenEvidence> {
  const { exam, attempt, item, answer } = input;
  const [head] = await tx.select({ seq: gradeLedger.seq, hash: gradeLedger.hash }).from(gradeLedger).orderBy(desc(gradeLedger.seq)).limit(1);

  let itemView: FrozenEvidence['item'] = null;
  let correctAnswer: string | null = null;
  if (item) {
    const numbers = await itemNumbers(tx, attempt.id);
    const [q] = await tx.select({ title: questions.title }).from(questions).where(eq(questions.id, item.questionId));
    const content = item.content ?? {};
    itemView = {
      id: item.id,
      number: numbers.get(item.id) ?? item.position + 1,
      questionId: item.questionId,
      title: q?.title ?? 'Question',
      type: item.type,
      typeLabel: QUESTION_TYPE_META[item.type].label,
      stem: typeof content.stem === 'string' ? content.stem : '',
      content,
      marks: item.marks,
      workingMarks: item.workingMarks,
      voidReason: item.voidReason,
    };
    try {
      correctAnswer = formatCorrectAnswer(item.type, content, item.answerKey ?? {});
    } catch {
      correctAnswer = null;
    }
  }

  const rubric =
    answer && answer.rubricItemIds.length
      ? await tx
          .select({ id: rubricItems.id, label: rubricItems.label, points: rubricItems.points, target: rubricItems.target, position: rubricItems.position })
          .from(rubricItems)
          .where(inArray(rubricItems.id, answer.rubricItemIds))
          .orderBy(asc(rubricItems.target), asc(rubricItems.position))
      : [];

  let incidents: FrozenEvidence['incidents'] = [];
  let connectivity: FrozenEvidence['connectivity'] = null;
  if (input.category === 'technical_incident') {
    const events = await tx
      .select({ type: attemptEvents.type, severity: attemptEvents.severity, payload: attemptEvents.payload, at: attemptEvents.createdAt })
      .from(attemptEvents)
      .where(and(eq(attemptEvents.attemptId, attempt.id), inArray(attemptEvents.type, [...CONNECTIVITY_EVENTS])))
      .orderBy(asc(attemptEvents.createdAt))
      .limit(200);
    incidents = events.map((e) => ({ type: e.type, severity: e.severity, at: e.at.toISOString(), detail: boundedDetail(e.payload) }));
    connectivity = summarizeConnectivity(events, attempt.submitReason);
  }

  const evidence: Omit<FrozenEvidence, 'seal'> = {
    version: 1,
    frozenAt: (input.now ?? new Date()).toISOString(),
    category: input.category,
    ledgerHead: head ? { seq: head.seq, hash: head.hash } : null,
    exam: {
      id: exam.id,
      title: exam.title,
      code: exam.code,
      resultsStatus: exam.resultsStatus,
      resultsVersion: exam.resultsVersion,
      resultsPublishedAt: iso(exam.resultsPublishedAt),
    },
    attempt: {
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: iso(attempt.submittedAt),
      submitReason: attempt.submitReason,
      deadlineAt: attempt.deadlineAt.toISOString(),
      timeExtensionSeconds: attempt.timeExtensionSeconds,
      score: attempt.score,
      maxScore: attempt.maxScore,
      gradingStatus: attempt.gradingStatus,
    },
    item: itemView,
    answer:
      item && answer
        ? {
            id: answer.id,
            response: answer.response ?? null,
            formatted: formatResponse(item.type, item.content ?? {}, answer.response),
            working: answer.working ? { text: answer.working.text ?? '', scratchPages: (answer.working.scratchPages ?? []).length } : null,
            answeredAt: iso(answer.answeredAt),
            timeSpentMs: answer.timeSpentMs,
          }
        : item
          ? { id: '', response: null, formatted: formatResponse(item.type, item.content ?? {}, null), working: null, answeredAt: null, timeSpentMs: 0 }
          : null,
    score: item ? { item: answer?.score ?? null, status: answer?.scoreStatus ?? 'ungraded', parts: partsOf(item, answer ?? undefined) } : null,
    rubric: rubric.map((r) => ({ id: r.id, label: r.label, points: round3(r.points), target: r.target })),
    feedback: answer?.feedback ?? null,
    correctAnswer,
    grading: { graderIds: answer?.gradedBy ? [answer.gradedBy] : [], gradedAt: iso(answer?.gradedAt) },
    incidents,
    connectivity,
    appealOf: input.appealOf ?? null,
  };
  return { ...evidence, seal: sealEvidence(input.disputeId, evidence) };
}
