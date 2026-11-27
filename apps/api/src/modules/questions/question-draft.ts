import { questionDraftSchema, type QuestionType } from '@athena/shared';
import { questionType, type Json } from '../../domain/question-types/registry';
import { createRng } from '../../domain/rng';
import { randomToken } from '../../lib/crypto';
import { ValidationError } from '../../lib/errors';
import { parse } from '../../lib/validate';

/** Functions and constants a numeric formula may use. Everything else is rejected before mathjs sees it. */
const FORMULA_NAMES = new Set([
  'abs', 'sqrt', 'cbrt', 'exp', 'log', 'log10', 'log2', 'ln', 'pow', 'round', 'floor', 'ceil', 'min', 'max', 'mod',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'pi', 'e', 'PI', 'E',
]);
const FORMULA_TOKEN = /\s+|[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|[-+*/^%(),]/gy;

/**
 * Formulas are evaluated by mathjs when papers are generated. Authors are trusted staff, but a formula is still
 * untrusted text, so only arithmetic, the listed functions and the question's own variables are allowed.
 */
export function assertSafeFormula(formula: string, variables: readonly string[]): void {
  const allowed = new Set([...FORMULA_NAMES, ...variables]);
  FORMULA_TOKEN.lastIndex = 0;
  let consumed = 0;
  for (let m = FORMULA_TOKEN.exec(formula); m; m = FORMULA_TOKEN.exec(formula)) {
    consumed = FORMULA_TOKEN.lastIndex;
    const token = m[0];
    if (/^[A-Za-z_]/.test(token) && !allowed.has(token)) {
      throw new ValidationError(`Unknown name "${token}" in the formula`, {
        'key.formula': `"${token}" is not a variable of this question or a supported function`,
      });
    }
  }
  if (consumed !== formula.length) {
    const bad = formula.slice(consumed, consumed + 1);
    throw new ValidationError(`The formula contains "${bad}"`, { 'key.formula': `Use numbers, variables, + - * / ^ ( ) and functions such as sqrt()` });
  }
}

/**
 * Validates authored content and key. Shape errors come back with `content.` / `key.` prefixed paths
 * (e.g. `content.options.1.text`, `key.correct`) so the editor can attach each message to its field;
 * the type handler then applies its cross-field rules.
 */
export function validateQuestionDraft(type: QuestionType, content: unknown, key: unknown): { content: Json; key: Json } {
  const shaped = parse(questionDraftSchema(type), { content, key }) as { content: Json; key: Json };
  if (type === 'numeric' && typeof shaped.key.formula === 'string' && shaped.key.formula.trim()) {
    const names = ((shaped.content.variables as { name: string }[] | undefined) ?? []).map((v) => v.name);
    assertSafeFormula(shaped.key.formula, names);
  }
  return questionType(type).validateDraft(content, key);
}

/**
 * Builds one candidate variant the way the attempt engine will (same handler, a random seed), so an author sees
 * shuffled options and drawn variable values. The candidate view drops the explanation, which candidates only
 * see with results. `expectedAnswer` is for the author (numeric only) and never reaches a candidate endpoint.
 */
export function previewQuestion(type: QuestionType, content: unknown, key: unknown, options: { seed?: string; shuffleOptions?: boolean } = {}) {
  const draft = validateQuestionDraft(type, content, key);
  const seed = options.seed ?? randomToken(9);
  const prepared = questionType(type).prepare(draft.content, draft.key, { rng: createRng(seed), shuffleOptions: options.shuffleOptions ?? true });
  const { explanation: _explanation, ...candidateView } = prepared.content;
  return {
    seed,
    candidateView,
    variant: prepared.variant,
    expectedAnswer: type === 'numeric' ? (prepared.answerKey.answer as number) : undefined,
  };
}

/** Stable JSON for comparing documents whose key order may differ (jsonb reorders keys). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
