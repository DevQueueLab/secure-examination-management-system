import { z } from 'zod';
import { markingSchemeSchema } from './question-types';

/** Examination settings stored as JSON on the exam. Every field has a safe default. */
export const examSettingsSchema = z.object({
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(true),
  /** free: jump anywhere. linear: forward only, no revisiting. */
  navigation: z.enum(['free', 'linear']).default('free'),
  /** Minutes after the window opens during which a candidate may still start. null = any time in the window. */
  lateEntryMinutes: z.number().int().min(0).max(10080).nullable().default(null),
  /** How long after the deadline an offline candidate's sealed journal is still accepted for review. */
  reconnectGraceMinutes: z.number().int().min(0).max(120).default(15),
  allowCalculator: z.boolean().default(true),
  allowScratchpad: z.boolean().default(true),
  accessCode: z.string().trim().max(32).nullable().default(null),
  passPercent: z.number().min(0).max(100).nullable().default(50),
  marking: markingSchemeSchema.default({ multiSelect: 'partial_penalty', negativeMarking: 0 }),
  integrity: z
    .object({
      requireFullscreen: z.boolean().default(false),
      detectFocusLoss: z.boolean().default(true),
      blockCopyPaste: z.boolean().default(false),
      watermark: z.boolean().default(true),
      honorCode: z
        .string()
        .max(2000)
        .nullable()
        .default('I will complete this examination on my own, without help from other people or AI tools, and I will not share its contents.'),
    })
    .default({ requireFullscreen: false, detectFocusLoss: true, blockCopyPaste: false, watermark: true, honorCode: null }),
  results: z
    .object({
      showCorrectAnswers: z.boolean().default(false),
      showFeedback: z.boolean().default(true),
      allowDisputes: z.boolean().default(true),
      disputeWindowDays: z.number().int().min(0).max(60).default(7),
    })
    .default({ showCorrectAnswers: false, showFeedback: true, allowDisputes: true, disputeWindowDays: 7 }),
  grading: z
    .object({
      /** Hide candidate identities from graders. */
      anonymous: z.boolean().default(true),
    })
    .default({ anonymous: true }),
  fairness: z
    .object({
      /** Balance each randomized paper's expected difficulty to the target. */
      balanceDifficulty: z.boolean().default(true),
      /** Allowed deviation of a paper's expected score from the target, in percent of total marks. */
      tolerancePercent: z.number().min(0.5).max(20).default(3),
    })
    .default({ balanceDifficulty: true, tolerancePercent: 3 }),
});
export type ExamSettings = z.infer<typeof examSettingsSchema>;
export const DEFAULT_EXAM_SETTINGS: ExamSettings = examSettingsSchema.parse({});
