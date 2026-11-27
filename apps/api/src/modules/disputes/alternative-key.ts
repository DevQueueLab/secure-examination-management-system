import { evaluate } from 'mathjs';
import { z } from 'zod';
import { markingSchemeSchema, type MarkingScheme, type QuestionType } from '@athena/shared';
import { questionType, type Json } from '../../domain/question-types/registry';
import { round3 } from '../../domain/rng';
import { ValidationError } from '../../lib/errors';

/**
 * "Accept alternatives": a question's key turned out to be too narrow (a second defensible option, a rounding
 * convention, a synonym). Each affected answer is re-marked against the original key OR the alternative, and the
 * candidate keeps the higher score, so the remedy can only ever add marks.
 */

export const ALTERNATIVE_TYPES = ['single_choice', 'true_false', 'multiple_choice', 'numeric', 'short_text', 'fill_blanks'] as const satisfies readonly QuestionType[];

export const supportsAlternatives = (type: QuestionType) => (ALTERNATIVE_TYPES as readonly string[]).includes(type);

/** One delivered copy of the question (options permuted, variables drawn), as stored on the attempt item. */
export interface GradableItem {
  type: QuestionType;
  marks: number;
  answerKey: Json;
  marking: Json;
  variant: Json;
}

export interface AlternativePlan {
  /** Plain-language description, shown to staff and to candidates. */
  summary: string;
  /** The validated payload stored with the remedy. */
  payload: Json;
  /** Best score the response earns under the alternative key(s). The caller keeps the max with the stored score. */
  grade(item: GradableItem, response: Json | null): number;
}

type Option = { id: string; text: string };

const optionIdsSchema = z.object({
  optionIds: z.array(z.string().trim().min(1).max(64)).min(1, 'Choose at least one option to accept').max(12),
});
const toleranceSchema = z.object({
  type: z.enum(['absolute', 'relative'], { error: 'Choose an absolute or a relative tolerance' }),
  value: z.number({ error: 'Enter the tolerance as a number' }).finite().min(0, 'The tolerance cannot be negative').max(1e9),
});
const numericSchema = z.object({
  value: z.number({ error: 'Enter the value as a number' }).finite().optional(),
  formula: z.string().trim().min(1).max(500, 'Keep the formula under 500 characters').optional(),
  tolerance: toleranceSchema.optional(),
});
const shortTextSchema = z.object({
  answers: z.array(z.string().trim().min(1, 'Remove the empty answer').max(200)).min(1, 'Add at least one answer to accept').max(50),
});
const blanksSchema = z.object({
  blanks: z.record(z.string().min(1).max(64), z.array(z.string().trim().min(1).max(200)).max(50)),
});

/** Validates a payload, reporting issues under `payload.<path>` so the wizard can show them next to the input. */
function parsePayload<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) fields[['payload', ...issue.path].join('.')] ??= issue.message;
  throw new ValidationError(Object.values(fields)[0] ?? 'Check the alternative answer', fields);
}

const fail = (field: string, message: string): never => {
  throw new ValidationError(message, { [field]: message });
};

export function markingOf(raw: Json | null | undefined): MarkingScheme {
  const parsed = markingSchemeSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : markingSchemeSchema.parse({});
}

const gradeWith = (item: GradableItem, key: Json, response: Json | null) =>
  questionType(item.type).grade(key, response, item.marks, markingOf(item.marking)).score ?? 0;

const quote = (s: string) => `“${s}”`;
const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

function formatTolerance(t: { type: 'absolute' | 'relative'; value: number }, unit: string) {
  return t.type === 'relative' ? `±${round3(t.value * 100)}%` : `±${t.value}${unit}`;
}

/**
 * Builds the alternative for one question.
 * @param content  the exam's pinned version content (authored option order, variables, blanks)
 * @param key      the pinned version's answer key (to reject "alternatives" that are already correct)
 */
export function planAlternatives(type: QuestionType, payload: unknown, content: Json, key: Json): AlternativePlan {
  const options = (Array.isArray(content.options) ? content.options : []) as Option[];
  const optionText = (id: string) => options.find((o) => o.id === id)?.text ?? id;

  switch (type) {
    case 'single_choice': {
      const { optionIds } = parsePayload(optionIdsSchema, payload);
      const ids = [...new Set(optionIds)];
      for (const id of ids) {
        if (!options.some((o) => o.id === id)) fail('payload.optionIds', 'One of the options is not part of this question');
        if (id === key.correct) fail('payload.optionIds', `${quote(optionText(id))} is already the correct answer`);
      }
      return {
        summary: `Also accepts ${list(ids.map((id) => quote(optionText(id))))} as correct`,
        payload: { optionIds: ids },
        grade: (item, response) => Math.max(...ids.map((id) => gradeWith(item, { ...item.answerKey, correct: id }, response))),
      };
    }
    case 'true_false': {
      const { optionIds } = parsePayload(optionIdsSchema, payload);
      const ids = [...new Set(optionIds)];
      if (ids.length !== 1 || (ids[0] !== 'true' && ids[0] !== 'false')) fail('payload.optionIds', 'Choose True or False');
      const value = ids[0] === 'true';
      if (value === key.correct) fail('payload.optionIds', `${value ? 'True' : 'False'} is already the correct answer`);
      return {
        summary: `Accepts both True and False`,
        payload: { optionIds: ids },
        grade: (item, response) => gradeWith(item, { ...item.answerKey, correct: value }, response),
      };
    }
    case 'multiple_choice': {
      const { optionIds } = parsePayload(optionIdsSchema, payload);
      const ids = [...new Set(optionIds)];
      for (const id of ids) if (!options.some((o) => o.id === id)) fail('payload.optionIds', 'One of the options is not part of this question');
      const original = new Set((key.correct as string[]) ?? []);
      if (ids.length === original.size && ids.every((id) => original.has(id))) fail('payload.optionIds', 'That is already the correct set of options');
      return {
        summary: `Also accepts the set ${list(ids.map((id) => quote(optionText(id))))} as fully correct`,
        payload: { optionIds: ids },
        // Spread the delivered key so the penalty scheme keeps its optionCount.
        grade: (item, response) => gradeWith(item, { ...item.answerKey, correct: ids }, response),
      };
    }
    case 'numeric': {
      const p = parsePayload(numericSchema, payload);
      const variables = (Array.isArray(content.variables) ? content.variables : []) as { name: string; min: number; max: number }[];
      const unit = typeof content.unit === 'string' && content.unit ? ` ${content.unit}` : '';
      if (p.value !== undefined && p.formula !== undefined) fail('payload.value', 'Give a value or a formula, not both');
      if (p.value === undefined && p.formula === undefined && !p.tolerance) {
        fail('payload.value', 'Give the alternative value, a formula, or a wider tolerance');
      }
      if (p.value !== undefined && variables.length > 0) {
        fail(
          'payload.value',
          'Each candidate got different numbers in this question, so one fixed value cannot be right for everyone. Give a formula over the variables, or widen the tolerance.',
        );
      }
      if (p.formula !== undefined) {
        // Prove the formula works at both ends of every variable's range before it touches a score.
        for (const pick of ['min', 'max'] as const) {
          const scope = Object.fromEntries(variables.map((v) => [v.name, v[pick]]));
          try {
            const n = Number(evaluate(p.formula, scope));
            if (!Number.isFinite(n)) throw new Error('it does not produce a finite number');
          } catch (e) {
            fail('payload.formula', `The formula does not work: ${(e as Error).message}`);
          }
        }
      }
      const tol = p.tolerance;
      const summary =
        p.formula !== undefined
          ? `Also accepts answers computed as ${p.formula}${tol ? ` (${formatTolerance(tol, unit)})` : ''}`
          : p.value !== undefined
            ? `Also accepts ${p.value}${unit}${tol ? ` (${formatTolerance(tol, unit)})` : ''}`
            : `Accepts answers within ${formatTolerance(tol!, unit)} of the correct value`;
      return {
        summary,
        payload: { ...(p.value !== undefined ? { value: p.value } : {}), ...(p.formula !== undefined ? { formula: p.formula } : {}), ...(tol ? { tolerance: tol } : {}) },
        grade: (item, response) => {
          let answer = item.answerKey.answer as number;
          if (p.value !== undefined) answer = p.value;
          if (p.formula !== undefined) {
            const values = ((item.variant.values as Record<string, number> | undefined) ?? {}) as Record<string, number>;
            answer = Number(evaluate(p.formula, { ...values }));
            if (!Number.isFinite(answer)) fail('payload.formula', 'The formula does not produce a number for every candidate');
          }
          return gradeWith(item, { ...item.answerKey, answer, tolerance: tol ?? item.answerKey.tolerance }, response);
        },
      };
    }
    case 'short_text': {
      const { answers } = parsePayload(shortTextSchema, payload);
      const accepted = [...new Set(answers)];
      return {
        summary: `Also accepts ${list(accepted.map(quote))}`,
        payload: { answers: accepted },
        grade: (item, response) =>
          gradeWith(item, { ...item.answerKey, accepted: [...((item.answerKey.accepted as string[]) ?? []), ...accepted] }, response),
      };
    }
    case 'fill_blanks': {
      const { blanks } = parsePayload(blanksSchema, payload);
      const known = new Set(((Array.isArray(content.blanks) ? content.blanks : []) as { id: string }[]).map((b) => b.id));
      const extra = Object.fromEntries(Object.entries(blanks).filter(([, v]) => v.length > 0));
      if (Object.keys(extra).length === 0) fail('payload.blanks', 'Add at least one answer to accept for a blank');
      for (const id of Object.keys(extra)) if (!known.has(id)) fail('payload.blanks', `Blank “${id}” is not part of this question`);
      return {
        summary: `Also accepts ${Object.entries(extra)
          .map(([id, v]) => `${list(v.map(quote))} for blank ${id}`)
          .join('; ')}`,
        payload: { blanks: extra },
        grade: (item, response) => {
          const base = (item.answerKey.blanks as Record<string, string[]>) ?? {};
          const merged = Object.fromEntries(Object.keys({ ...base, ...extra }).map((id) => [id, [...(base[id] ?? []), ...(extra[id] ?? [])]]));
          return gradeWith(item, { ...item.answerKey, blanks: merged }, response);
        },
      };
    }
    default:
      return fail(
        'type',
        'Accepting alternatives works for choice, numeric, short-answer and fill-in questions. Give everyone full marks or drop the question instead.',
      );
  }
}
