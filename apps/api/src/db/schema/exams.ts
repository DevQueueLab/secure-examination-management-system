import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ExamSettings, MarkingScheme } from '@athena/shared';
import { createdAt, id, marks, tstz, updatedAt } from './_common';
import { enrollmentStatus, examStaffRole, examStatus, resultsStatus } from './enums';
import { organizations, users } from './identity';
import { questions, questionVersions } from './questions';

export const exams = pgTable(
  'exams',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    code: text('code'),
    description: text('description'),
    instructions: text('instructions').notNull().default(''),
    status: examStatus('status').notNull().default('draft'),
    resultsStatus: resultsStatus('results_status').notNull().default('unpublished'),
    windowOpensAt: tstz('window_opens_at').notNull(),
    windowClosesAt: tstz('window_closes_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    /** Declared total; must equal the sum of a paper's question marks before publishing. */
    totalMarks: marks('total_marks').notNull().default(0),
    settings: jsonb('settings').$type<ExamSettings>().notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    publishedAt: tstz('published_at'),
    publishedBy: uuid('published_by').references(() => users.id),
    resultsPublishedAt: tstz('results_published_at'),
    resultsPublishedBy: uuid('results_published_by').references(() => users.id),
    /** Bumped on every publish/unpublish so issued reports can be marked superseded. */
    resultsVersion: integer('results_version').notNull().default(0),
    archivedAt: tstz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('exams_org_status_idx').on(t.organizationId, t.status),
    check('exams_window_ck', sql`${t.windowClosesAt} > ${t.windowOpensAt}`),
    check('exams_duration_ck', sql`${t.durationMinutes} > 0 AND ${t.durationMinutes} <= 1440`),
  ],
);

/** Exam-level access: examiners only see exams they are staff on (unless they hold exams.view_all). */
export const examStaff = pgTable(
  'exam_staff',
  {
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: examStaffRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.examId, t.userId] })],
);

/** Sections are fixed (drawCount null) or pools ("draw N of M") feeding the fairness engine. */
export const examSections = pgTable(
  'exam_sections',
  {
    id: id(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    instructions: text('instructions'),
    position: integer('position').notNull().default(0),
    drawCount: integer('draw_count'),
    createdAt: createdAt(),
  },
  (t) => [index('exam_sections_exam_idx').on(t.examId)],
);

export const examQuestions = pgTable(
  'exam_questions',
  {
    id: id(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => examSections.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    /** Pinned version: editing the bank question never changes this exam. */
    questionVersionId: uuid('question_version_id')
      .notNull()
      .references(() => questionVersions.id),
    marks: marks('marks').notNull(),
    position: integer('position').notNull().default(0),
    /** Optional per-question override of the exam marking scheme. */
    marking: jsonb('marking').$type<Partial<MarkingScheme>>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('exam_questions_uq').on(t.examId, t.questionId), index('exam_questions_section_idx').on(t.sectionId)],
);

export const examEnrollments = pgTable(
  'exam_enrollments',
  {
    id: id(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: enrollmentStatus('status').notNull().default('enrolled'),
    /** Accommodations (e.g. 1.5x time). */
    timeMultiplier: numeric('time_multiplier', { precision: 4, scale: 2, mode: 'number' }).notNull().default(1),
    extraMinutes: integer('extra_minutes').notNull().default(0),
    accommodationNote: text('accommodation_note'),
    enrolledBy: uuid('enrolled_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('enrollments_exam_user_uq').on(t.examId, t.userId), index('enrollments_user_idx').on(t.userId)],
);

/** Gradescope-style rubric items, per exam and question. Editing points regrades every answer using them. */
export const rubricItems = pgTable(
  'rubric_items',
  {
    id: id(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    /** 'answer' grades the response; 'working' grades the shown method. */
    target: text('target').$type<'answer' | 'working'>().notNull().default('answer'),
    label: text('label').notNull(),
    description: text('description'),
    points: marks('points').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('rubric_exam_question_idx').on(t.examId, t.questionId)],
);
