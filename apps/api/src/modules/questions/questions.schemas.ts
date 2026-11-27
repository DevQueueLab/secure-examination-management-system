import { z } from 'zod';
import { DIFFICULTIES, QUESTION_TYPES, paginationQuerySchema } from '@athena/shared';

const tag = z
  .string()
  .trim()
  .min(1)
  .max(40, 'Tags are at most 40 characters')
  .transform((t) => t.replace(/\s+/g, ' ').toLowerCase());

/** Tags are stored lower-case and de-duplicated, so filtering by tag is exact. */
export const tagsSchema = z
  .array(tag)
  .max(20, 'Use at most 20 tags')
  .default([])
  .transform((tags) => [...new Set(tags)]);

export const marksSchema = z
  .number({ error: 'Enter the marks as a number' })
  .positive('Marks must be more than 0')
  .max(1000, 'Marks must be at most 1000')
  .refine((n) => Math.round(n * 1000) === n * 1000, 'Use at most three decimal places');

/** Bank metadata shared by create, update and import. */
export const questionMetaSchema = z.object({
  title: z.string().trim().min(3, 'Give the question a short title (3+ characters)').max(200, 'Keep the title under 200 characters'),
  difficulty: z.enum(DIFFICULTIES, { error: 'Choose easy, medium or hard' }).default('medium'),
  categoryId: z.string().uuid('Unknown category').nullable().default(null),
  tags: tagsSchema,
  defaultMarks: marksSchema.default(1),
});

export const createQuestionSchema = questionMetaSchema.extend({
  type: z.enum(QUESTION_TYPES, { error: 'Choose a question type' }),
  content: z.unknown(),
  key: z.unknown(),
});

export const updateQuestionSchema = questionMetaSchema.extend({
  /** Optional echo of the type; a question's type can never change. */
  type: z.enum(QUESTION_TYPES).optional(),
  content: z.unknown(),
  key: z.unknown(),
  /** The version the author started from. A mismatch means someone else saved in between. */
  baseVersion: z.number().int().min(1).optional(),
});

/** Query strings send blank filters as ""; treat them as absent. */
export const withoutBlanks = <S extends z.ZodTypeAny>(schema: S) =>
  z.preprocess((v) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== '')) : v), schema);

const listQuestionsBase = paginationQuerySchema.extend({
  type: z.enum(QUESTION_TYPES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  /** A category id, or "none" for uncategorized questions. */
  categoryId: z.union([z.string().uuid(), z.literal('none')]).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  tag: z.string().trim().max(40).optional(),
  sort: z.enum(['updated', 'title', 'usage', 'difficulty']).default('updated'),
  /** Hide questions already in this exam (the "add from bank" picker). */
  excludeExamId: z.string().uuid().optional(),
});
export const listQuestionsSchema = withoutBlanks(listQuestionsBase);
export type ListQuestionsQuery = z.infer<typeof listQuestionsBase>;

export const previewSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  content: z.unknown(),
  key: z.unknown(),
  seed: z.string().trim().min(1).max(64).optional(),
  shuffleOptions: z.boolean().default(true),
});

export const bulkIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Select at least one question').max(200),
});

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the category').max(80, 'Keep the name under 80 characters'),
  description: z.string().trim().max(500).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0A84FF')
    .nullable()
    .optional(),
});

export const importRequestSchema = z.object({
  format: z.enum(['csv', 'json'], { error: 'Format must be csv or json' }),
  data: z.string().min(1, 'The file is empty').max(2_000_000, 'The file is larger than 2 MB'),
  dryRun: z.boolean().default(true),
  filename: z.string().trim().max(200).optional(),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;
