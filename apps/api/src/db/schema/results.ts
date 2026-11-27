import { bigserial, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, marks, tstz, updatedAt } from './_common';
import { disputeCategory, disputeOutcome, disputeStatus, ledgerAction, remedyType, reportStatus } from './enums';
import { answers, attemptItems, attempts } from './attempts';
import { exams } from './exams';
import { organizations, users } from './identity';
import { questions } from './questions';

/**
 * Append-only, hash-chained record of every score change. A database trigger rejects UPDATE and DELETE,
 * and each row's hash covers the previous row's hash, so tampering is detectable.
 */
export const gradeLedger = pgTable(
  'grade_ledger',
  {
    id: id(),
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    organizationId: uuid('organization_id').notNull(),
    examId: uuid('exam_id').notNull(),
    attemptId: uuid('attempt_id'),
    answerId: uuid('answer_id'),
    action: ledgerAction('action').notNull(),
    actorId: uuid('actor_id'),
    previousScore: marks('previous_score'),
    newScore: marks('new_score'),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_exam_idx').on(t.examId, t.seq), index('ledger_attempt_idx').on(t.attemptId, t.seq)],
);

/** Issued result reports. The public verification page reads only the minimal signed payload. */
export const issuedReports = pgTable(
  'issued_reports',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verificationCode: text('verification_code').notNull().unique(),
    resultsVersion: integer('results_version').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    signature: text('signature').notNull(),
    status: reportStatus('status').notNull().default('valid'),
    issuedAt: createdAt(),
    supersededAt: tstz('superseded_at'),
  },
  (t) => [index('reports_attempt_idx').on(t.attemptId)],
);

export const disputes = pgTable(
  'disputes',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    attemptItemId: uuid('attempt_item_id').references(() => attemptItems.id, { onDelete: 'set null' }),
    answerId: uuid('answer_id').references(() => answers.id, { onDelete: 'set null' }),
    raisedBy: uuid('raised_by')
      .notNull()
      .references(() => users.id),
    category: disputeCategory('category').notNull(),
    description: text('description').notNull(),
    /** Context frozen at submission: answer, rubric applied, incidents. */
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    status: disputeStatus('status').notNull().default('open'),
    outcome: disputeOutcome('outcome'),
    resolutionNote: text('resolution_note'),
    scoreBefore: marks('score_before'),
    scoreAfter: marks('score_after'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: tstz('resolved_at'),
    /** Appeals reference the original dispute and must be reviewed by someone else. */
    appealOf: uuid('appeal_of'),
    dueAt: tstz('due_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('disputes_exam_status_idx').on(t.examId, t.status), index('disputes_raised_by_idx').on(t.raisedBy)],
);

export const disputeMessages = pgTable(
  'dispute_messages',
  {
    id: id(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputes.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    /** Internal staff notes are never shown to the candidate. */
    internal: integer('internal').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('dispute_messages_idx').on(t.disputeId, t.createdAt)],
);

/** Question-level remedies applied to every candidate at once (accept alternatives, full marks, drop). */
export const remedies = pgTable(
  'remedies',
  {
    id: id(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    type: remedyType('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    reason: text('reason').notNull(),
    affectedAttempts: integer('affected_attempts').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('remedies_exam_idx').on(t.examId)],
);
