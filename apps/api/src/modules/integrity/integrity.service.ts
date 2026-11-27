import { and, asc, eq } from 'drizzle-orm';
import {
  answerProvenanceSchema,
  examPhase,
  markingSchemeSchema,
  replayProvenance,
  summarizeProvenance,
  type AnswerProvenance,
  type QuestionType,
} from '@athena/shared';
import type { Database } from '../../db/client';
import { answers, attemptEvents, attemptItems, attempts, exams, memberships, questions, users } from '../../db/schema';
import { realAttempts } from '../../db/scopes';
import {
  assessAttempt,
  finalComposition,
  PRIORITY_RULE,
  type ReviewPriority,
  type SimilarityNote,
  type TimedEvent,
  type WrittenAnswer,
} from '../../domain/integrity/indicators';
import {
  analyzeObjective,
  analyzeWritten,
  itemContentKey,
  OBJECTIVE_DEFAULTS,
  responseKey,
  SHINGLE_SIZE,
  WRITTEN_DEFAULTS,
  type ObjectivePair,
  type ObjectiveResponse,
  type WrittenPair,
  type WrittenResponse,
} from '../../domain/integrity/similarity';
import { questionType } from '../../domain/question-types/registry';
import { NotFoundError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import type { AuditService } from '../audit/audit.service';
import { loadExamForStaff } from '../exams/exam-access';
import { formatResponse } from '../grading/response-format';
import { eventTime } from '../monitoring/analysis';
import {
  INTEGRITY_NOTICE,
  type CandidateRef,
  type ExamRef,
  type IntegrityOverview,
  type OverviewAttempt,
  type ProvenanceView,
  type SimilarityLink,
  type SimilarityPair,
  type SimilarityReport,
  type WrittenAnswerView,
  type WrittenEvidence,
} from './integrity.types';

type Json = Record<string, unknown>;
type ExamRow = typeof exams.$inferSelect;

/** Who performed a sensitive lookup, for the audit log. */
export interface Actor {
  auth: TenantAuthContext;
  ip?: string | null;
}

const WRITTEN_TYPES = new Set<QuestionType>(['long_text', 'short_text', 'code']);
const NOUN: Partial<Record<QuestionType, string>> = { long_text: 'essay', short_text: 'short answer', code: 'code' };
const PRIORITY_RANK: Record<ReviewPriority, number> = { high: 0, medium: 1, low: 2, none: 3 };

const TYPED_VALUE_TYPES = new Set<QuestionType>(['numeric', 'short_text', 'fill_blanks']);

export const SIMILARITY_CAVEATS = [
  'Similarity is a statistic, not proof. Candidates who revised together, or from the same notes or past paper, share wrong answers and wording too.',
  'Shared correct answers are expected and ignored. Only uncommon shared wrong answers count: ones given by no more than 15% of the candidates who answered that question, or, in groups under 20, by the pair alone. Common mistakes are expected and left out. Each answer that counts is weighted by how rare it was.',
  'Answers are compared on the same question content. On questions with per-candidate numbers, the same wrong number on papers with different numbers also counts when it is just as uncommon, because it rarely happens independently; a shared method mistake can still produce it.',
  'The z-score ranks a pair against every other pair in this exam. Pair scores are skewed, so read it as a ranking, not a probability.',
  'Written overlap compares 5-character sequences after removing case, punctuation and the question text itself. Quoting a shared source or a standard derivation overlaps naturally.',
  'Answers given within minutes of each other are common when candidates work through the paper in order; timing is context, not a finding.',
];

function responseText(type: QuestionType, response: Json | null): string | null {
  if (!response) return null;
  const value = type === 'code' ? response.code : WRITTEN_TYPES.has(type) ? response.text : null;
  return typeof value === 'string' && value.trim() ? value : null;
}

function workingText(working: { text?: unknown } | null): string | null {
  return working && typeof working.text === 'string' && working.text.trim() ? working.text : null;
}

function parseProvenance(raw: unknown): AnswerProvenance | null {
  if (!raw) return null;
  const parsed = answerProvenanceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function examRef(exam: ExamRow): ExamRef {
  return { id: exam.id, title: exam.title, code: exam.code, phase: examPhase(exam) };
}

const stemOf = (content: Json) => (typeof content.stem === 'string' ? content.stem : '');

function groupBy<T>(list: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of list) {
    const key = keyOf(item);
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}

/**
 * Integrity review (IC-5.1): authorship provenance, behaviour indicators and answer similarity, all for a human
 * reviewer. Staff access goes through loadExamForStaff, every query is tenant scoped and uses realAttempts, and
 * looking at a candidate's authorship replay is audited.
 */
export class IntegrityService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------------------------------------

  private async attemptRows(examId: string, orgId: string) {
    return this.db
      .select({
        attemptId: attempts.id,
        userId: attempts.userId,
        status: attempts.status,
        startedAt: attempts.startedAt,
        submittedAt: attempts.submittedAt,
        deadlineAt: attempts.deadlineAt,
        name: users.name,
        email: users.email,
        rollNumber: memberships.externalId,
      })
      .from(attempts)
      .innerJoin(users, eq(users.id, attempts.userId))
      .leftJoin(memberships, and(eq(memberships.userId, attempts.userId), eq(memberships.organizationId, orgId)))
      .where(and(eq(attempts.examId, examId), eq(attempts.organizationId, orgId), realAttempts))
      .orderBy(asc(users.name));
  }

  private async eventRows(examId: string, orgId: string) {
    return this.db
      .select({
        attemptId: attemptEvents.attemptId,
        type: attemptEvents.type,
        severity: attemptEvents.severity,
        payload: attemptEvents.payload,
        clientTs: attemptEvents.clientTs,
        createdAt: attemptEvents.createdAt,
        reviewStatus: attemptEvents.reviewStatus,
      })
      .from(attemptEvents)
      .innerJoin(attempts, eq(attempts.id, attemptEvents.attemptId))
      .where(and(eq(attemptEvents.examId, examId), eq(attempts.organizationId, orgId), realAttempts))
      .orderBy(asc(attemptEvents.createdAt));
  }

  /** Every answered item of the exam's real attempts, with what the candidate saw. */
  private async answerRows(examId: string, orgId: string) {
    return this.db
      .select({
        attemptId: attemptItems.attemptId,
        attemptItemId: attemptItems.id,
        answerId: answers.id,
        position: attemptItems.position,
        type: attemptItems.type,
        marks: attemptItems.marks,
        content: attemptItems.content,
        answerKey: attemptItems.answerKey,
        marking: attemptItems.marking,
        variant: attemptItems.variant,
        voidReason: attemptItems.voidReason,
        questionId: attemptItems.questionId,
        title: questions.title,
        response: answers.response,
        working: answers.working,
        provenance: answers.provenance,
        answeredAt: answers.answeredAt,
        score: answers.score,
        scoreStatus: answers.scoreStatus,
      })
      .from(answers)
      .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
      .innerJoin(attempts, eq(attempts.id, answers.attemptId))
      .innerJoin(questions, eq(questions.id, attemptItems.questionId))
      .where(and(eq(attempts.examId, examId), eq(attempts.organizationId, orgId), realAttempts))
      .orderBy(asc(attemptItems.attemptId), asc(attemptItems.position));
  }

  private async load(examId: string, orgId: string) {
    const [attemptList, events, items] = await Promise.all([
      this.attemptRows(examId, orgId),
      this.eventRows(examId, orgId),
      this.answerRows(examId, orgId),
    ]);
    const candidates = new Map<string, CandidateRef>(
      attemptList.map((a) => [a.attemptId, { attemptId: a.attemptId, userId: a.userId, name: a.name, email: a.email, rollNumber: a.rollNumber }]),
    );
    return { attempts: attemptList, events, items, candidates };
  }

  // -------------------------------------------------------------------------------------------------------
  // Similarity
  // -------------------------------------------------------------------------------------------------------

  /** Full marks on the item, from the stored grade or by grading the variant's key now. Null when unknown. */
  private static isCorrect(row: ItemRow): boolean | null {
    if (row.voidReason) return null;
    if (row.scoreStatus !== 'ungraded' && row.score !== null) return row.score >= row.marks - 1e-6;
    try {
      const marking = markingSchemeSchema.parse(row.marking ?? {});
      const graded = questionType(row.type).grade(row.answerKey, row.response, row.marks, marking);
      return graded.score === null ? null : graded.score >= row.marks - 1e-6;
    } catch {
      return null;
    }
  }

  private similarityOf(items: ItemRow[]) {
    const objective: ObjectiveResponse[] = [];
    const written: WrittenResponse[] = [];
    const itemByKey = new Map<string, ItemRow>();
    const positionOf = new Map<string, number>();
    const rowOf = new Map<string, ItemRow>();
    const textOf = new Map<string, string>();
    const writtenMeta = new Map<string, { questionId: string; title: string; field: 'response' | 'working'; position: number }>();

    for (const row of items) {
      const response = row.response as Json | null;
      if (!WRITTEN_TYPES.has(row.type)) {
        const rk = responseKey(row.type, response);
        const correct = rk === null ? null : IntegrityService.isCorrect(row);
        if (rk !== null && correct !== null) {
          const itemKey = itemContentKey(row.type, row.content);
          // Only typed values can match across parameter variants; an option id means different text on another variant.
          const questionKey = TYPED_VALUE_TYPES.has(row.type) ? row.questionId : undefined;
          objective.push({ attemptId: row.attemptId, itemKey, questionKey, responseKey: rk, correct, answeredAt: row.answeredAt });
          if (!itemByKey.has(itemKey)) itemByKey.set(itemKey, row);
          positionOf.set(`${row.attemptId}|${itemKey}`, row.position);
          rowOf.set(`${row.attemptId}|${itemKey}`, row);
        }
      }
      const baseline = [stemOf(row.content), typeof row.content.starterCode === 'string' ? row.content.starterCode : ''].join('\n');
      const pieces: ['response' | 'working', string | null][] = [
        ['response', responseText(row.type, response)],
        ['working', workingText(row.working)],
      ];
      for (const [field, text] of pieces) {
        if (!text) continue;
        const groupKey = `${row.questionId}:${field}`;
        written.push({ attemptId: row.attemptId, groupKey, text, baseline });
        textOf.set(`${row.attemptId}|${groupKey}`, text);
        if (!writtenMeta.has(groupKey)) writtenMeta.set(groupKey, { questionId: row.questionId, title: row.title, field, position: row.position });
      }
    }

    return {
      objective: analyzeObjective(objective),
      written: analyzeWritten(written),
      comparedItems: new Set(objective.map((o) => o.itemKey)).size,
      itemByKey,
      positionOf,
      rowOf,
      textOf,
      writtenMeta,
    };
  }

  private static writtenLabel(meta: { title: string; field: 'response' | 'working'; position: number }) {
    return `Q${meta.position}, ${meta.title}${meta.field === 'working' ? ' (working)' : ''}`;
  }

  // -------------------------------------------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------------------------------------------

  async overview(auth: TenantAuthContext, examId: string): Promise<IntegrityOverview> {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const data = await this.load(exam.id, auth.organization.id);
    const sim = this.similarityOf(data.items);
    const now = new Date();
    const nameOf = (attemptId: string) => data.candidates.get(attemptId)?.name ?? 'another candidate';

    const notes = new Map<string, SimilarityNote[]>();
    const links = new Map<string, SimilarityLink[]>();
    const note = (attemptId: string, n: SimilarityNote, link: SimilarityLink) => {
      notes.set(attemptId, [...(notes.get(attemptId) ?? []), n]);
      links.set(attemptId, [...(links.get(attemptId) ?? []), link]);
    };
    const flaggedObjective = sim.objective.pairs.filter((p) => p.flagged);
    for (const p of flaggedObjective) {
      for (const [self, other] of [[p.a, p.b], [p.b, p.a]] as const) {
        const detail = `${p.sharedWrong.length} shared uncommon wrong answers`;
        note(self, { kind: 'objective', otherAttemptId: other, otherName: nameOf(other), sharedWrong: p.sharedWrong.length, z: p.z }, { otherAttemptId: other, otherName: nameOf(other), kind: 'objective', detail });
      }
    }
    for (const p of sim.written.pairs) {
      const meta = sim.writtenMeta.get(p.groupKey);
      const label = meta ? IntegrityService.writtenLabel(meta) : 'A written answer';
      for (const [self, other] of [[p.a, p.b], [p.b, p.a]] as const) {
        const detail = `${Math.round(p.jaccard * 100)}% wording overlap on ${label}`;
        note(self, { kind: 'written', otherAttemptId: other, otherName: nameOf(other), jaccard: p.jaccard, label, noun: meta?.field === 'working' ? 'working' : 'answer' }, { otherAttemptId: other, otherName: nameOf(other), kind: 'written', detail });
      }
    }

    const eventsByAttempt = groupBy(data.events, (e) => e.attemptId);
    const itemsByAttempt = groupBy(data.items, (i) => i.attemptId);

    const rows: OverviewAttempt[] = data.attempts.map((a) => {
      const events: TimedEvent[] = (eventsByAttempt.get(a.attemptId) ?? []).map((e) => ({
        type: e.type,
        severity: e.severity,
        at: eventTime(e, a.startedAt),
        receivedAt: e.createdAt,
        payload: e.payload ?? {},
        reviewStatus: e.reviewStatus,
      }));
      const endAt = a.submittedAt ?? (now < a.deadlineAt ? now : a.deadlineAt);

      const writtenInputs: (WrittenAnswer & { view: Omit<WrittenAnswerView, 'chars' | 'summary' | 'composition' | 'label' | 'noun'> })[] = [];
      for (const row of itemsByAttempt.get(a.attemptId) ?? []) {
        const resolved = resolveWritten(row);
        if (!resolved) continue;
        const label = `Q${row.position}, ${row.title}${resolved.field === 'working' ? ' (working)' : ''}`;
        const noun = resolved.field === 'working' ? 'working' : (NOUN[row.type] ?? 'answer');
        writtenInputs.push({
          answerId: row.answerId,
          label,
          noun,
          finalText: resolved.text,
          provenance: resolved.provenance,
          view: { answerId: row.answerId, attemptItemId: row.attemptItemId, position: row.position, title: row.title, type: row.type, field: resolved.field, hasReplay: !!resolved.provenance && resolved.provenance.ops.length > 0 },
        });
      }

      const assessment = assessAttempt({ events, endAt, written: writtenInputs, similarity: notes.get(a.attemptId) ?? [] });
      const written: WrittenAnswerView[] = assessment.written.map((w, i) => ({ ...writtenInputs[i]!.view, label: w.label, noun: w.noun, chars: w.chars, summary: w.summary, composition: w.composition }));

      return {
        candidate: data.candidates.get(a.attemptId)!,
        status: a.status,
        startedAt: a.startedAt.toISOString(),
        submittedAt: a.submittedAt?.toISOString() ?? null,
        priority: assessment.priority,
        reasons: assessment.reasons,
        incidents: assessment.incidents,
        focus: assessment.focus,
        deviceSwitches: assessment.deviceSwitches,
        offline: {
          intervals: assessment.offline.intervals.map((i) => ({ from: i.from.toISOString(), to: i.to.toISOString(), ms: i.ms, open: i.open })),
          totalMs: assessment.offline.totalMs,
        },
        written,
        similarity: links.get(a.attemptId) ?? [],
      };
    });

    rows.sort(
      (x, y) =>
        PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority] ||
        y.reasons.filter((r) => !r.cleared).length - x.reasons.filter((r) => !r.cleared).length ||
        x.candidate.name.localeCompare(y.candidate.name),
    );

    const byPriority: Record<ReviewPriority, number> = { high: 0, medium: 0, low: 0, none: 0 };
    for (const r of rows) byPriority[r.priority]++;
    const flaggedPairs = new Set([...flaggedObjective.map((p) => `${p.a}|${p.b}`), ...sim.written.pairs.map((p) => `${p.a}|${p.b}`)]).size;

    return {
      exam: examRef(exam),
      notice: INTEGRITY_NOTICE,
      priorityRule: PRIORITY_RULE,
      generatedAt: now.toISOString(),
      totals: {
        attempts: rows.length,
        byPriority,
        openIndicators: rows.reduce((n, r) => n + r.incidents.review.open, 0),
        writtenAnswers: rows.reduce((n, r) => n + r.written.length, 0),
        answersWithPastes: rows.reduce((n, r) => n + r.written.filter((w) => (w.summary?.pasteCount ?? 0) > 0).length, 0),
        flaggedPairs,
      },
      attempts: rows,
    };
  }

  // -------------------------------------------------------------------------------------------------------
  // Provenance replay
  // -------------------------------------------------------------------------------------------------------

  async provenance(actor: Actor, answerId: string): Promise<ProvenanceView> {
    const { auth } = actor;
    const [row] = await this.db
      .select({
        attemptId: attemptItems.attemptId,
        attemptItemId: attemptItems.id,
        answerId: answers.id,
        position: attemptItems.position,
        type: attemptItems.type,
        marks: attemptItems.marks,
        content: attemptItems.content,
        answerKey: attemptItems.answerKey,
        marking: attemptItems.marking,
        voidReason: attemptItems.voidReason,
        questionId: attemptItems.questionId,
        title: questions.title,
        response: answers.response,
        working: answers.working,
        provenance: answers.provenance,
        answeredAt: answers.answeredAt,
        score: answers.score,
        scoreStatus: answers.scoreStatus,
        examId: attempts.examId,
        userId: attempts.userId,
        name: users.name,
        email: users.email,
        rollNumber: memberships.externalId,
      })
      .from(answers)
      .innerJoin(attemptItems, eq(attemptItems.id, answers.attemptItemId))
      .innerJoin(attempts, eq(attempts.id, answers.attemptId))
      .innerJoin(questions, eq(questions.id, attemptItems.questionId))
      .innerJoin(users, eq(users.id, attempts.userId))
      .leftJoin(memberships, and(eq(memberships.userId, attempts.userId), eq(memberships.organizationId, auth.organization.id)))
      .where(and(eq(answers.id, answerId), eq(attempts.organizationId, auth.organization.id), realAttempts))
      .limit(1);
    if (!row) throw new NotFoundError('Answer');
    const exam = await loadExamForStaff(this.db, auth, row.examId);

    const resolved = resolveWritten(row) ?? { field: 'response' as const, text: '', provenance: parseProvenance(row.provenance) };
    const provenance = resolved.provenance;
    const replayed = provenance && !provenance.truncated ? replayProvenance(provenance).text : null;
    const candidate: CandidateRef = { attemptId: row.attemptId, userId: row.userId, name: row.name, email: row.email, rollNumber: row.rollNumber };
    const label = `Q${row.position}, ${row.title}${resolved.field === 'working' ? ' (working)' : ''}`;

    await this.audit.record({
      organizationId: auth.organization.id,
      actorId: auth.user.id,
      action: 'integrity.provenance_viewed',
      entityType: 'answer',
      entityId: row.answerId,
      summary: `Viewed the authorship replay of ${row.name}'s answer to ${label} (${exam.title})`,
      metadata: { examId: exam.id, attemptId: row.attemptId, attemptItemId: row.attemptItemId, field: resolved.field },
      ip: actor.ip ?? null,
    });

    return {
      notice: INTEGRITY_NOTICE,
      answerId: row.answerId,
      exam: examRef(exam),
      candidate,
      item: {
        attemptItemId: row.attemptItemId,
        position: row.position,
        title: row.title,
        type: row.type,
        stem: stemOf(row.content),
        field: resolved.field,
        label,
        noun: resolved.field === 'working' ? 'working' : (NOUN[row.type] ?? 'answer'),
      },
      provenance,
      summary: provenance ? summarizeProvenance(provenance) : null,
      composition: provenance ? finalComposition(provenance) : null,
      finalText: resolved.text,
      replayMatchesFinal: replayed !== null && replayed === resolved.text,
    };
  }

  // -------------------------------------------------------------------------------------------------------
  // Similarity report
  // -------------------------------------------------------------------------------------------------------

  async similarity(auth: TenantAuthContext, examId: string): Promise<SimilarityReport> {
    const exam = await loadExamForStaff(this.db, auth, examId);
    const data = await this.load(exam.id, auth.organization.id);
    const sim = this.similarityOf(data.items);

    const pairs = new Map<string, SimilarityPair>();
    const pairFor = (a: string, b: string) => {
      const id = `${a}:${b}`;
      let pair = pairs.get(id);
      if (!pair) {
        pair = { id, a: data.candidates.get(a)!, b: data.candidates.get(b)!, objective: null, written: [] };
        pairs.set(id, pair);
      }
      return pair;
    };

    for (const p of sim.objective.pairs.filter((x) => x.flagged)) {
      if (!data.candidates.has(p.a) || !data.candidates.has(p.b)) continue;
      pairFor(p.a, p.b).objective = objectiveEvidence(p, sim.itemByKey, sim.rowOf);
    }
    for (const p of sim.written.pairs) {
      if (!data.candidates.has(p.a) || !data.candidates.has(p.b)) continue;
      const meta = sim.writtenMeta.get(p.groupKey);
      if (!meta) continue;
      pairFor(p.a, p.b).written.push(writtenEvidence(p, meta, sim.textOf));
    }

    const strength = (p: SimilarityPair) => Math.max(p.objective?.z ?? 0, ...p.written.map((w) => w.jaccard * 10));
    return {
      exam: examRef(exam),
      notice: INTEGRITY_NOTICE,
      caveats: SIMILARITY_CAVEATS,
      generatedAt: new Date().toISOString(),
      thresholds: {
        z: OBJECTIVE_DEFAULTS.zThreshold,
        minSharedWrong: OBJECTIVE_DEFAULTS.minShared,
        uncommonShare: OBJECTIVE_DEFAULTS.uncommonShare,
        jaccard: WRITTEN_DEFAULTS.threshold,
        minChars: WRITTEN_DEFAULTS.minChars,
        shingle: SHINGLE_SIZE,
        timingWindowMinutes: 2,
      },
      objective: { distribution: sim.objective.distribution, flaggedPairs: sim.objective.pairs.filter((p) => p.flagged).length, comparedItems: sim.comparedItems },
      written: { distribution: sim.written.distribution, flaggedPairs: sim.written.pairs.length },
      pairs: [...pairs.values()].sort((x, y) => strength(y) - strength(x)),
    };
  }
}

type ItemRow = Awaited<ReturnType<IntegrityService['answerRows']>>[number];

/**
 * Which text the stored provenance describes. The replay decides when it can: the field whose stored text equals
 * the replayed text. Otherwise written types describe their response and other types their working.
 */
function resolveWritten(row: Pick<ItemRow, 'type' | 'response' | 'working' | 'provenance'>): {
  field: 'response' | 'working';
  text: string;
  provenance: AnswerProvenance | null;
} | null {
  const provenance = parseProvenance(row.provenance);
  const response = responseText(row.type, row.response as Json | null);
  const working = workingText(row.working);
  if (provenance && !provenance.truncated) {
    const replayed = replayProvenance(provenance).text;
    if (response !== null && replayed === response) return { field: 'response', text: response, provenance };
    if (working !== null && replayed === working) return { field: 'working', text: working, provenance };
  }
  if (response !== null) return { field: 'response', text: response, provenance };
  if (working !== null) return { field: 'working', text: working, provenance: WRITTEN_TYPES.has(row.type) ? null : provenance };
  return null;
}

function variantValues(row: ItemRow | undefined): string | null {
  const values = row?.variant && typeof row.variant === 'object' ? (row.variant as Json).values : null;
  if (!values || typeof values !== 'object') return null;
  const parts = Object.entries(values as Record<string, unknown>).map(([k, v]) => `${k} = ${String(v)}`);
  return parts.length ? parts.join(', ') : null;
}

function objectiveEvidence(p: ObjectivePair, itemByKey: Map<string, ItemRow>, rowOf: Map<string, ItemRow>) {
  return {
    score: p.score,
    z: p.z,
    comparableItems: p.comparableItems,
    bothWrong: p.bothWrong,
    within2Min: p.within2Min,
    sharedWrong: p.sharedWrong.map((w) => {
      const item = itemByKey.get(w.itemKey)!;
      const rowA = rowOf.get(`${p.a}|${w.itemKey}`) ?? item;
      const rowB = rowOf.get(`${p.b}|${w.itemKeyB ?? w.itemKey}`) ?? item;
      const formatted = formatResponse(rowA.type, rowA.content, rowA.response as Json | null);
      const valuesA = variantValues(rowA);
      const valuesB = variantValues(rowB);
      return {
        questionId: item.questionId,
        title: item.title,
        type: item.type,
        positionA: rowA.position,
        positionB: rowB.position,
        response: formatted.text ?? w.responseKey,
        respondents: w.respondents,
        count: w.count,
        share: w.share,
        weight: w.weight,
        apartMs: w.apartMs,
        crossVariant: w.crossVariant,
        variantNote: w.crossVariant && valuesA && valuesB ? `Their papers had different numbers (${valuesA} and ${valuesB})` : null,
      };
    }),
  };
}

function writtenEvidence(
  p: WrittenPair,
  meta: { questionId: string; title: string; field: 'response' | 'working'; position: number },
  textOf: Map<string, string>,
): WrittenEvidence {
  return {
    questionId: meta.questionId,
    title: meta.title,
    field: meta.field,
    label: `${meta.title}${meta.field === 'working' ? ' (working)' : ''}`,
    jaccard: p.jaccard,
    a: { text: textOf.get(`${p.a}|${p.groupKey}`) ?? '', passages: p.aPassages },
    b: { text: textOf.get(`${p.b}|${p.groupKey}`) ?? '', passages: p.bPassages },
  };
}
