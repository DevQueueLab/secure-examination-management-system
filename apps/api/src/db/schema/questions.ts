import { sql } from 'drizzle-orm';
import { index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, marks, tstz, updatedAt } from './_common';
import { difficulty, questionStatus, questionType } from './enums';
import { organizations, users } from './identity';

export const questionCategories = pgTable(
  'question_categories',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('categories_org_name_uq').on(t.organizationId, t.name)],
);

/** A bank question. Its content lives in immutable versions so exams and attempts never change underneath. */
export const questions = pgTable(
  'questions',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => questionCategories.id, { onDelete: 'set null' }),
    type: questionType('type').notNull(),
    difficulty: difficulty('difficulty').notNull().default('medium'),
    title: text('title').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    status: questionStatus('status').notNull().default('active'),
    currentVersion: integer('current_version').notNull().default(1),
    defaultMarks: marks('default_marks').notNull().default(1),
    /** Fairness engine calibration: observed mean score fraction and sample size (real attempts only). */
    observedP: numeric('observed_p', { precision: 6, scale: 4, mode: 'number' }),
    observedN: integer('observed_n').notNull().default(0),
    /** Times delivered to real candidates (exposure control, leak risk). */
    exposureCount: integer('exposure_count').notNull().default(0),
    /** Set when a leak was traced to this question; leaked questions should be retired. */
    leakedAt: tstz('leaked_at'),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('questions_org_status_idx').on(t.organizationId, t.status),
    index('questions_org_category_idx').on(t.organizationId, t.categoryId),
  ],
);

export const questionVersions = pgTable(
  'question_versions',
  {
    id: id(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Candidate-visible content (see contentSchemas in @athena/shared). */
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    /** Answer key. Never selected by candidate-facing queries. */
    answerKey: jsonb('answer_key').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('question_versions_uq').on(t.questionId, t.version)],
);
