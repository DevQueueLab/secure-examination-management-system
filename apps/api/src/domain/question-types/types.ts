import type { MarkingScheme, QuestionType } from '@athena/shared';
import type { Rng } from '../rng';

export type Json = Record<string, unknown>;

/** A question as delivered to one candidate. */
export interface PreparedItem {
  /** Candidate-safe content (options permuted, variables substituted). */
  content: Json;
  /** Answer key for this exact variant. Server only. */
  answerKey: Json;
  /** Seed-derived choices, kept for audit and reproduction. */
  variant: Json;
}

export interface GradeOutcome {
  /** Awarded marks, or null when a human must grade. */
  score: number | null;
  /** Per-part correctness used for feedback and analytics (never includes the key for candidates). */
  detail?: Json;
}

/**
 * Strategy interface implemented once per question type. Adding a type means adding one handler and
 * registering it; nothing else in the engine changes (open/closed principle).
 */
export interface QuestionTypeHandler {
  readonly type: QuestionType;
  /** Validates authored content and key, including cross-field rules. Throws ValidationError. */
  validateDraft(content: unknown, key: unknown): { content: Json; key: Json };
  /** Builds a candidate's variant. Pure: never mutates its inputs. */
  prepare(content: Json, key: Json, ctx: { rng: Rng; shuffleOptions: boolean }): PreparedItem;
  /** Validates a candidate response against the delivered content. Throws ValidationError. */
  parseResponse(content: Json, response: unknown): Json;
  isAnswered(response: Json | null | undefined): boolean;
  grade(key: Json, response: Json | null | undefined, marks: number, marking: MarkingScheme): GradeOutcome;
}
