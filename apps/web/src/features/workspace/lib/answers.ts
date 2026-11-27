import type { AttemptItemView, QuestionType } from '@athena/shared';
import { responseSchemas } from '@athena/shared';

export type Completion = 'none' | 'partial' | 'complete';

type ItemLike = Pick<AttemptItemView, 'type' | 'content'>;
type Response = Record<string, unknown> | null | undefined;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ids = (value: unknown): { id: string }[] =>
  Array.isArray(value) ? value.filter((v): v is { id: string } => !!v && typeof (v as { id?: unknown }).id === 'string') : [];

function share(filled: number, total: number): Completion {
  if (filled === 0) return 'none';
  return filled >= total ? 'complete' : 'partial';
}

/** How much of a question the candidate has answered. Partial covers blanks and pairs left empty. */
export function completion(item: ItemLike, response: Response): Completion {
  if (!response) return 'none';
  switch (item.type) {
    case 'single_choice':
      return typeof response.optionId === 'string' && response.optionId ? 'complete' : 'none';
    case 'true_false':
      return typeof response.value === 'boolean' ? 'complete' : 'none';
    case 'multiple_choice':
      return Array.isArray(response.optionIds) && response.optionIds.length > 0 ? 'complete' : 'none';
    case 'numeric':
      return text(response.value).trim() ? 'complete' : 'none';
    case 'short_text':
    case 'long_text':
      return text(response.text).trim() ? 'complete' : 'none';
    case 'code': {
      const code = text(response.code);
      return code.trim() && code !== text(item.content.starterCode) ? 'complete' : 'none';
    }
    case 'fill_blanks': {
      const blanks = ids(item.content.blanks);
      const values = (response.blanks ?? {}) as Record<string, unknown>;
      return share(blanks.filter((b) => text(values[b.id]).trim()).length, blanks.length);
    }
    case 'matching': {
      const prompts = ids(item.content.prompts);
      const pairs = (response.pairs ?? {}) as Record<string, unknown>;
      return share(prompts.filter((p) => typeof pairs[p.id] === 'string' && pairs[p.id]).length, prompts.length);
    }
    case 'ordering':
      return Array.isArray(response.order) && response.order.length > 0 ? 'complete' : 'none';
    default:
      return 'none';
  }
}

export function isAnswered(item: ItemLike, response: Response): boolean {
  return completion(item, response) !== 'none';
}

export type NormalizedResponse = { ok: true; value: Record<string, unknown> | null } | { ok: false; message: string };

/** Contract limits, enforced at the inputs so a response can never fail validation on the server. */
export const ANSWER_LIMITS = {
  longText: 60_000,
  code: 60_000,
  shortText: 500,
  numeric: 64,
  blank: 200,
  working: 30_000,
} as const;

/**
 * What goes over the wire: an empty answer is `null`, so "answered" means the same thing in the navigator,
 * the review sheet and the server's receipt. A response that fails the contract is NOT turned into null:
 * that would go out as a newer revision and erase the server's last good copy. The caller keeps it local
 * and tells the candidate instead.
 */
export function normalizeResponse(item: ItemLike, response: Response): NormalizedResponse {
  if (!response || completion(item, response) === 'none') return { ok: true, value: null };
  const schema = responseSchemas[item.type as QuestionType];
  const parsed = schema.safeParse(response);
  if (parsed.success) return { ok: true, value: parsed.data as Record<string, unknown> };
  const tooLong = parsed.error.issues.some((i) => i.code === 'too_big');
  return {
    ok: false,
    message: tooLong ? 'This answer is longer than the exam allows. Shorten it to save.' : 'This answer could not be saved in its current form.',
  };
}

/** Plain-text words, for the live word count and min/max guidance. */
export function countWords(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

/** Text fields that carry authorship provenance. */
export function hasWrittenResponse(type: QuestionType): type is 'long_text' | 'code' {
  return type === 'long_text' || type === 'code';
}

export function workingEnabled(item: ItemLike): { enabled: boolean; marks: number; guidance: string | null } {
  const w = item.content.working as { enabled?: unknown; marks?: unknown; guidance?: unknown } | undefined;
  return {
    enabled: w?.enabled === true,
    marks: typeof w?.marks === 'number' ? w.marks : 0,
    guidance: typeof w?.guidance === 'string' && w.guidance.trim() ? w.guidance : null,
  };
}
