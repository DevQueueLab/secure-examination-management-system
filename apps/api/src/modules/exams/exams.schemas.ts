import { z } from 'zod';
import { EXAM_PHASES, paginationQuerySchema } from '@athena/shared';
import { withoutBlanks } from '../questions/questions.schemas';

const isoDate = z.coerce.date({ error: 'Enter a valid date and time' }).refine((d) => !Number.isNaN(d.getTime()), 'Enter a valid date and time');

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

export const examFieldsSchema = z.object({
  title: z.string().trim().min(3, 'Give the exam a title (3+ characters)').max(200, 'Keep the title under 200 characters'),
  code: z
    .string()
    .trim()
    .max(40, 'Keep the code under 40 characters')
    .regex(/^[A-Za-z0-9 ._/-]*$/, 'Use letters, digits, spaces and - _ . /')
    .nullable()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  description: optionalText(5000, 'Keep the description under 5000 characters'),
  instructions: z.string().max(20000, 'Keep the instructions under 20,000 characters').optional(),
  windowOpensAt: isoDate,
  windowClosesAt: isoDate,
  durationMinutes: z
    .number({ error: 'Enter the duration in minutes' })
    .int('Use whole minutes')
    .min(1, 'The duration must be at least 1 minute')
    .max(1440, 'The duration can be at most 24 hours'),
  totalMarks: z.number({ error: 'Enter the total marks' }).min(0, 'Total marks cannot be negative').max(100000),
  /** Partial settings are deep-merged onto the defaults (create) or the stored settings (update). */
  settings: z.record(z.string(), z.unknown()).optional(),
});

/** Timing rules shared by create, update and review. Returns field -> message. */
export function timingIssues(t: { windowOpensAt: Date; windowClosesAt: Date; durationMinutes: number }): Record<string, string> {
  const fields: Record<string, string> = {};
  const windowMinutes = Math.floor((t.windowClosesAt.getTime() - t.windowOpensAt.getTime()) / 60_000);
  if (windowMinutes <= 0) fields.windowClosesAt = 'The window must close after it opens';
  else if (t.durationMinutes > windowMinutes) {
    fields.durationMinutes = `The duration (${t.durationMinutes} min) is longer than the window (${windowMinutes} min), so no one could finish in time`;
  }
  return fields;
}

export const createExamSchema = examFieldsSchema.extend({ totalMarks: examFieldsSchema.shape.totalMarks.default(0) });
export const updateExamSchema = examFieldsSchema.partial();

export const listExamsSchema = withoutBlanks(
  paginationQuerySchema.extend({
    phase: z.enum(EXAM_PHASES).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }),
);

export const sectionCreateSchema = z.object({
  title: z.string().trim().min(1, 'Name the section').max(120, 'Keep the name under 120 characters'),
  instructions: optionalText(2000, 'Keep section instructions under 2000 characters'),
  drawCount: z.number().int('Use a whole number').min(1, 'Draw at least 1 question').max(500).nullable().optional(),
});
export const sectionUpdateSchema = sectionCreateSchema.partial();
export const reorderSchema = z.object({ order: z.array(z.string().uuid()).min(1).max(500) });

export const addQuestionsSchema = z.object({
  sectionId: z.string().uuid('Choose a section'),
  questionIds: z.array(z.string().uuid()).min(1, 'Choose at least one question').max(200, 'Add at most 200 questions at once'),
});

export const examQuestionUpdateSchema = z.object({
  marks: z
    .number({ error: 'Enter the marks as a number' })
    .positive('Marks must be more than 0')
    .max(1000)
    .refine((n) => Math.round(n * 1000) === n * 1000, 'Use at most three decimal places')
    .optional(),
  sectionId: z.string().uuid().optional(),
  /** 0-based position inside the (target) section. */
  position: z.number().int().min(0).max(1000).optional(),
  /** Re-pin to the bank question's current version. */
  repin: z.literal(true).optional(),
});

export const staffAddSchema = z.object({
  userId: z.string().uuid('Choose a person'),
  role: z.enum(['co_examiner', 'grader', 'proctor'], { error: 'Choose co-examiner, grader or proctor' }),
});

export const enrollSchema = z
  .object({
    userIds: z.array(z.string().uuid()).max(2000).optional(),
    cohort: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => (v.userIds?.length ?? 0) > 0 || !!v.cohort, { message: 'Choose candidates or a cohort', path: ['userIds'] });

export const accommodationSchema = z.object({
  timeMultiplier: z
    .number({ error: 'Enter a multiplier such as 1.25' })
    .min(1, 'The multiplier must be between 1 and 3')
    .max(3, 'The multiplier must be between 1 and 3')
    .refine((n) => Math.round(n * 100) === n * 100, 'Use at most two decimal places')
    .optional(),
  extraMinutes: z.number().int('Use whole minutes').min(0, 'Extra time cannot be negative').max(600, 'At most 600 extra minutes').optional(),
  accommodationNote: optionalText(500, 'Keep the note under 500 characters'),
});

export const enrollmentListSchema = withoutBlanks(
  z.object({
    q: z.string().trim().max(200).optional(),
    cohort: z.string().trim().max(80).optional(),
  }),
);

export const eligibleSchema = withoutBlanks(
  z.object({
    q: z.string().trim().max(200).optional(),
    cohort: z.string().trim().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
);

export const enrollmentImportSchema = z.object({
  format: z.enum(['csv', 'json'], { error: 'Format must be csv or json' }),
  data: z.string().min(1, 'The file is empty').max(2_000_000, 'The file is larger than 2 MB'),
  dryRun: z.boolean().default(true),
  filename: z.string().trim().max(200).optional(),
});
export type EnrollmentImportRequest = z.infer<typeof enrollmentImportSchema>;
