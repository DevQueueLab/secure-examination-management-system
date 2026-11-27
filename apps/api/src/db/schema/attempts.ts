import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, marks, tstz, updatedAt } from './_common';
import {
  attemptStatus,
  eventSeverity,
  gradingStatus,
  incidentReviewStatus,
  questionType,
  scoreStatus,
  submitReason,
} from './enums';
import { examQuestions, exams, examSections } from './exams';
import { organizations, users } from './identity';
import { questions, questionVersions } from './questions';

/**
 * One sitting of an exam by a candidate. The deadline is fixed by the server at start and only moves
 * through audited extensions (proctor, accommodation, verified outage).
 */
export const attempts = pgTable(
  'attempts',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Examiner previews: excluded from every statistic, result and monitor view. */
    isSandbox: boolean('is_sandbox').notNull().default(false),
    status: attemptStatus('status').notNull().default('in_progress'),
    submitReason: submitReason('submit_reason'),
    /** Seed for this candidate's paper (question draw, order, option order, variables). */
    seed: text('seed').notNull(),
    /** Leak-tracing code embedded invisibly in every rendition of this paper. */
    fingerprint: text('fingerprint').notNull().unique(),
    startedAt: tstz('started_at').notNull().defaultNow(),
    deadlineAt: tstz('deadline_at').notNull(),
    submittedAt: tstz('submitted_at'),
    lastSeenAt: tstz('last_seen_at'),
    timeExtensionSeconds: integer('time_extension_seconds').notNull().default(0),
    /** Single active device: the session that currently owns the attempt. */
    activeSessionId: uuid('active_session_id'),
    clientInfo: jsonb('client_info').$type<Record<string, unknown>>().notNull().default({}),
    pledgeAcceptedAt: tstz('pledge_accepted_at'),
    score: marks('score'),
    maxScore: marks('max_score').notNull().default(0),
    gradingStatus: gradingStatus('grading_status').notNull().default('pending'),
    /** Expected score fraction of this paper from calibrated difficulty (fairness audit). */
    paperExpected: numeric('paper_expected', { precision: 6, scale: 4, mode: 'number' }),
    /** Review priority from integrity indicators: none | low | medium | high. Never a verdict. */
    reviewPriority: text('review_priority').$type<'none' | 'low' | 'medium' | 'high'>().notNull().default('none'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One real attempt per candidate per exam, enforced by the database (no duplicate starts under races).
    uniqueIndex('attempts_one_real_per_candidate_uq').on(t.examId, t.userId).where(sql`${t.isSandbox} = false`),
    index('attempts_exam_status_idx').on(t.examId, t.status),
    index('attempts_user_idx').on(t.userId),
    index('attempts_deadline_idx').on(t.status, t.deadlineAt),
  ],
);

/**
 * Frozen snapshot of each question as assigned to this attempt: content in display order, the variant's
 * answer key and the marking scheme. Later edits to the bank or exam never change an active attempt.
 */
export const attemptItems = pgTable(
  'attempt_items',
  {
    id: id(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    examQuestionId: uuid('exam_question_id').references(() => examQuestions.id, { onDelete: 'set null' }),
    sectionId: uuid('section_id').references(() => examSections.id, { onDelete: 'set null' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    questionVersionId: uuid('question_version_id')
      .notNull()
      .references(() => questionVersions.id),
    position: integer('position').notNull(),
    type: questionType('type').notNull(),
    marks: marks('marks').notNull(),
    workingMarks: marks('working_marks').notNull().default(0),
    /** Candidate-safe content (options permuted, variables substituted). */
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    /** Answer key for this variant. Server only. */
    answerKey: jsonb('answer_key').$type<Record<string, unknown>>().notNull(),
    marking: jsonb('marking').$type<Record<string, unknown>>().notNull(),
    variant: jsonb('variant').$type<Record<string, unknown>>().notNull().default({}),
    /** Set when a remedy drops the question from scoring for everyone; the reason is shown to candidates. */
    voidReason: text('void_reason'),
  },
  (t) => [uniqueIndex('attempt_items_position_uq').on(t.attemptId, t.position), index('attempt_items_question_idx').on(t.questionId)],
);

/** The candidate's latest accepted response per item. Writes carry a revision; stale revisions are ignored. */
export const answers = pgTable(
  'answers',
  {
    id: id(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    attemptItemId: uuid('attempt_item_id')
      .notNull()
      .references(() => attemptItems.id, { onDelete: 'cascade' }),
    response: jsonb('response').$type<Record<string, unknown> | null>(),
    working: jsonb('working').$type<{ text: string; scratchPages: string[] } | null>(),
    revision: integer('revision').notNull().default(0),
    flagged: boolean('flagged').notNull().default(false),
    firstViewedAt: tstz('first_viewed_at'),
    answeredAt: tstz('answered_at'),
    timeSpentMs: integer('time_spent_ms').notNull().default(0),
    /** Authorship provenance for written answers: typed vs pasted, bursts, replay ops. */
    provenance: jsonb('provenance').$type<Record<string, unknown>>(),
    /** Offline journal entry that reached the server after the deadline, held for examiner decision. */
    pendingOffline: jsonb('pending_offline').$type<Record<string, unknown> | null>(),
    autoScore: marks('auto_score'),
    manualScore: marks('manual_score'),
    workingScore: marks('working_score'),
    score: marks('score'),
    scoreStatus: scoreStatus('score_status').notNull().default('ungraded'),
    rubricItemIds: uuid('rubric_item_ids').array().notNull().default(sql`'{}'::uuid[]`),
    /** Grader point adjustments per part (score = clamp(Σ rubric points + adjustment)); kept so rubric edits re-score exactly. */
    manualAdjustment: marks('manual_adjustment').notNull().default(0),
    workingAdjustment: marks('working_adjustment').notNull().default(0),
    feedback: text('feedback'),
    gradedBy: uuid('graded_by').references(() => users.id),
    gradedAt: tstz('graded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('answers_item_uq').on(t.attemptId, t.attemptItemId)],
);

/** Timeline of lifecycle, connectivity and integrity events. Indicators are reviewed, never auto-penalized. */
export const attemptEvents = pgTable(
  'attempt_events',
  {
    id: id(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    examId: uuid('exam_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    type: text('type').notNull(),
    severity: eventSeverity('severity').notNull().default('info'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** What the client claimed; informational only. Ordering uses createdAt (server time). */
    clientTs: tstz('client_ts'),
    reviewStatus: incidentReviewStatus('review_status'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: tstz('reviewed_at'),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
  },
  (t) => [index('events_exam_time_idx').on(t.examId, t.createdAt), index('events_attempt_time_idx').on(t.attemptId, t.createdAt)],
);

/** Digital scratchpad pages (canvas strokes or notes), autosaved with the attempt. */
export const scratchpads = pgTable(
  'scratchpads',
  {
    id: id(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    pageKey: text('page_key').notNull(),
    kind: text('kind').$type<'canvas' | 'notes'>().notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    revision: integer('revision').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('scratchpads_page_uq').on(t.attemptId, t.pageKey)],
);

export const announcements = pgTable(
  'announcements',
  {
    id: id(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    /** null = every candidate in the exam. */
    targetUserId: uuid('target_user_id').references(() => users.id),
    priority: text('priority').$type<'normal' | 'urgent'>().notNull().default('normal'),
    createdAt: createdAt(),
  },
  (t) => [index('announcements_exam_idx').on(t.examId, t.createdAt)],
);

export const announcementReads = pgTable(
  'announcement_reads',
  {
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] })],
);

/** Candidate questions to proctors during the exam; answers can be broadcast to everyone for fairness. */
export const clarifications = pgTable(
  'clarifications',
  {
    id: id(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    askedBy: uuid('asked_by')
      .notNull()
      .references(() => users.id),
    attemptItemId: uuid('attempt_item_id').references(() => attemptItems.id, { onDelete: 'set null' }),
    question: text('question').notNull(),
    answer: text('answer'),
    answeredBy: uuid('answered_by').references(() => users.id),
    answeredAt: tstz('answered_at'),
    broadcast: boolean('broadcast').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('clarifications_exam_idx').on(t.examId, t.createdAt)],
);
