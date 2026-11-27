import { z } from 'zod';

/**
 * Question type contracts.
 *
 * Every type is described by three schemas:
 *  - content: what a candidate may see (stem, options...). Safe to send to the browser.
 *  - key:     the answer key. Stored in a separate column and NEVER sent to candidates.
 *  - response: what a candidate submits.
 *
 * Keeping the key structurally separate from the content means a candidate payload cannot leak it by accident.
 */

export const QUESTION_TYPES = [
  'single_choice',
  'true_false',
  'multiple_choice',
  'numeric',
  'short_text',
  'fill_blanks',
  'matching',
  'ordering',
  'long_text',
  'code',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_META: Record<
  QuestionType,
  { label: string; short: string; autoGraded: boolean; description: string }
> = {
  single_choice: { label: 'Single choice', short: 'MCQ', autoGraded: true, description: 'One correct option. Optional negative marking.' },
  true_false: { label: 'True / False', short: 'T/F', autoGraded: true, description: 'A statement judged true or false.' },
  multiple_choice: { label: 'Multiple select', short: 'Multi', autoGraded: true, description: 'Several correct options with all-or-nothing or partial credit.' },
  numeric: { label: 'Numeric', short: 'Num', autoGraded: true, description: 'A number checked with tolerance. Can be parameterized per candidate.' },
  short_text: { label: 'Short answer', short: 'Short', autoGraded: true, description: 'A word or phrase matched against accepted answers.' },
  fill_blanks: { label: 'Fill in the blanks', short: 'Blanks', autoGraded: true, description: 'Several blanks, each credited separately.' },
  matching: { label: 'Matching', short: 'Match', autoGraded: true, description: 'Pair prompts with answers; each pair earns credit.' },
  ordering: { label: 'Ordering', short: 'Order', autoGraded: true, description: 'Arrange items in the correct sequence; partial credit for position.' },
  long_text: { label: 'Written response', short: 'Essay', autoGraded: false, description: 'An extended answer graded with a rubric.' },
  code: { label: 'Code', short: 'Code', autoGraded: false, description: 'Source code written in an editor, graded with a rubric.' },
};

const id = z.string().min(1).max(64);
const text = z.string().trim().min(1, 'Required').max(5000);
const option = z.object({ id, text: z.string().trim().min(1, 'Option text is required').max(2000) });

/** "Show your working": method marks graded by rubric, separate from the final-answer marks. */
export const workingSchema = z
  .object({
    enabled: z.boolean().default(false),
    marks: z.number().min(0).max(100).default(0),
    guidance: z.string().max(1000).optional(),
  })
  .default({ enabled: false, marks: 0 });

const base = {
  stem: z.string().trim().min(1, 'The question text is required').max(20000),
  explanation: z.string().max(10000).optional(),
  working: workingSchema.optional(),
};

// ---------- content (candidate-visible) ----------
export const contentSchemas = {
  single_choice: z.object({ ...base, options: z.array(option).min(2, 'Add at least two options').max(12) }),
  true_false: z.object({ ...base }),
  multiple_choice: z.object({ ...base, options: z.array(option).min(2, 'Add at least two options').max(12) }),
  numeric: z.object({
    ...base,
    unit: z.string().max(40).optional(),
    /** Parameterized questions: values are drawn per attempt and substituted into {{name}} in the stem. */
    variables: z
      .array(
        z.object({
          name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,15}$/, 'Use letters, digits and _'),
          min: z.number(),
          max: z.number(),
          step: z.number().positive().default(1),
        }),
      )
      .max(8)
      .default([]),
  }),
  short_text: z.object({ ...base, maxLength: z.number().int().min(1).max(500).default(200) }),
  fill_blanks: z.object({
    ...base,
    /** Text with blanks written as [[blankId]], e.g. "Water boils at [[b1]] °C". */
    template: text,
    blanks: z.array(z.object({ id, label: z.string().max(80).optional() })).min(1).max(20),
  }),
  matching: z.object({
    ...base,
    prompts: z.array(option).min(2).max(12),
    answers: z.array(option).min(2).max(16),
  }),
  ordering: z.object({ ...base, items: z.array(option).min(2).max(12) }),
  long_text: z.object({
    ...base,
    minWords: z.number().int().min(0).max(5000).optional(),
    maxWords: z.number().int().min(1).max(10000).optional(),
  }),
  code: z.object({
    ...base,
    language: z.enum(['python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'sql', 'other']).default('python'),
    starterCode: z.string().max(20000).optional(),
  }),
} satisfies Record<QuestionType, z.ZodTypeAny>;

// ---------- answer keys (server only) ----------
export const keySchemas = {
  single_choice: z.object({ correct: id }),
  true_false: z.object({ correct: z.boolean() }),
  multiple_choice: z.object({ correct: z.array(id).min(1, 'Mark at least one correct option') }),
  numeric: z.object({
    /** Fixed answer, or a formula over the variables (e.g. "d / t"). One of the two is required. */
    answer: z.number().nullable().default(null),
    formula: z.string().max(500).optional(),
    tolerance: z
      .object({ type: z.enum(['absolute', 'relative']).default('absolute'), value: z.number().min(0).default(0) })
      .default({ type: 'absolute', value: 0 }),
  }),
  short_text: z.object({
    accepted: z.array(z.string().trim().min(1)).min(1, 'Add at least one accepted answer'),
    caseSensitive: z.boolean().default(false),
  }),
  fill_blanks: z.object({
    blanks: z.record(z.string(), z.array(z.string().trim().min(1)).min(1)),
    caseSensitive: z.boolean().default(false),
  }),
  matching: z.object({ pairs: z.record(z.string(), id) }),
  ordering: z.object({ order: z.array(id).min(2) }),
  long_text: z.object({ sampleAnswer: z.string().max(20000).optional() }),
  code: z.object({ sampleAnswer: z.string().max(20000).optional() }),
} satisfies Record<QuestionType, z.ZodTypeAny>;

// ---------- responses (candidate input) ----------
export const responseSchemas = {
  single_choice: z.object({ optionId: id.nullable() }),
  true_false: z.object({ value: z.boolean().nullable() }),
  multiple_choice: z.object({ optionIds: z.array(id).max(12) }),
  numeric: z.object({ value: z.string().max(64) }),
  short_text: z.object({ text: z.string().max(500) }),
  fill_blanks: z.object({ blanks: z.record(z.string(), z.string().max(200)) }),
  matching: z.object({ pairs: z.record(z.string(), id.nullable()) }),
  ordering: z.object({ order: z.array(id).max(12) }),
  long_text: z.object({ text: z.string().max(60000) }),
  code: z.object({ code: z.string().max(60000) }),
} satisfies Record<QuestionType, z.ZodTypeAny>;

export type QuestionContent<T extends QuestionType = QuestionType> = z.infer<(typeof contentSchemas)[T]>;
export type QuestionKey<T extends QuestionType = QuestionType> = z.infer<(typeof keySchemas)[T]>;
export type QuestionResponse<T extends QuestionType = QuestionType> = z.infer<(typeof responseSchemas)[T]>;

/** Working answer attached to any question that enables "show your working". */
export const workingResponseSchema = z.object({
  text: z.string().max(30000).default(''),
  /** Scratchpad page ids the candidate attached as evidence of method. */
  scratchPages: z.array(z.string().max(64)).max(10).default([]),
});
export type WorkingResponse = z.infer<typeof workingResponseSchema>;

/** Marking rules. Exam-level defaults that a question in an exam may override. */
export const markingSchemeSchema = z.object({
  /** all_or_nothing: exact set only. partial: credit per correct pick. partial_penalty: wrong picks subtract, floor 0. */
  multiSelect: z.enum(['all_or_nothing', 'partial', 'partial_penalty']).default('partial_penalty'),
  /** Fraction of the question's marks deducted for a wrong single-choice / true-false answer. 0 disables. */
  negativeMarking: z.number().min(0).max(1).default(0),
});
export type MarkingScheme = z.infer<typeof markingSchemeSchema>;

/** Authoring payload: a question as written in the bank. */
export function questionDraftSchema<T extends QuestionType>(type: T) {
  return z.object({ content: contentSchemas[type], key: keySchemas[type] });
}

export function isAutoGraded(type: QuestionType): boolean {
  return QUESTION_TYPE_META[type].autoGraded;
}
