import { answerProvenanceSchema, summarizeProvenance as summarizeCanonical, type QuestionType } from '@athena/shared';
import { questionType } from '../../domain/question-types/registry';

/**
 * Turns stored responses and answer keys into readable text for graders, result pages and PDF reports.
 * Option ids are resolved against the candidate's own (permuted) content, so labels match what they saw.
 */

type Json = Record<string, unknown>;
type Option = { id: string; text: string };

const options = (content: Json, field = 'options') => (Array.isArray(content[field]) ? (content[field] as Option[]) : []);
const optionText = (list: Option[], id: unknown) => list.find((o) => o.id === id)?.text ?? String(id ?? '');

export interface FormattedResponse {
  /** Plain-text rendering, or null when nothing was answered. */
  text: string | null;
  /** 'code' responses are shown in monospace with this language. */
  format: 'text' | 'code' | 'choice' | 'list';
  language?: string;
  /** Selected option ids for choice types (lets the UI mark them in the option list). */
  selected?: string[];
}

export function isAnswered(type: QuestionType, response: Json | null | undefined): boolean {
  try {
    return questionType(type).isAnswered(response ?? null);
  } catch {
    return false;
  }
}

/** Option ids a candidate picked (choice types). True/false map to 'true' / 'false'. */
export function selectedOptions(type: QuestionType, response: Json | null | undefined): string[] | null {
  if (!response) return type === 'single_choice' || type === 'multiple_choice' || type === 'true_false' ? [] : null;
  if (type === 'single_choice') return response.optionId ? [String(response.optionId)] : [];
  if (type === 'multiple_choice') return Array.isArray(response.optionIds) ? (response.optionIds as unknown[]).map(String) : [];
  if (type === 'true_false') return typeof response.value === 'boolean' ? [String(response.value)] : [];
  return null;
}

export function formatResponse(type: QuestionType, content: Json, response: Json | null | undefined): FormattedResponse {
  if (!isAnswered(type, response)) return { text: null, format: type === 'code' ? 'code' : 'text' };
  const r = response!;
  switch (type) {
    case 'long_text':
    case 'short_text':
      return { text: String(r.text ?? ''), format: 'text' };
    case 'code':
      return { text: String(r.code ?? ''), format: 'code', language: typeof content.language === 'string' ? content.language : undefined };
    case 'single_choice':
      return { text: optionText(options(content), r.optionId), format: 'choice', selected: [String(r.optionId)] };
    case 'true_false':
      return { text: r.value ? 'True' : 'False', format: 'choice', selected: [String(r.value)] };
    case 'multiple_choice': {
      const ids = (r.optionIds as string[]) ?? [];
      return { text: ids.map((id) => optionText(options(content), id)).join('\n'), format: 'list', selected: ids };
    }
    case 'numeric': {
      const unit = typeof content.unit === 'string' && content.unit ? ` ${content.unit}` : '';
      return { text: `${String(r.value ?? '').trim()}${unit}`, format: 'text' };
    }
    case 'fill_blanks': {
      const blanks = (r.blanks as Record<string, string>) ?? {};
      const template = typeof content.template === 'string' ? content.template : '';
      const text = template
        ? template.replace(/\[\[([^\]]+)\]\]/g, (_m, id: string) => `[${blanks[id]?.trim() || '—'}]`)
        : Object.entries(blanks).map(([k, v]) => `${k}: ${v}`).join('\n');
      return { text, format: 'text' };
    }
    case 'matching': {
      const pairs = (r.pairs as Record<string, string | null>) ?? {};
      const prompts = options(content, 'prompts');
      const answers = options(content, 'answers');
      const text = prompts.map((p) => `${p.text} → ${pairs[p.id] ? optionText(answers, pairs[p.id]) : '—'}`).join('\n');
      return { text, format: 'list' };
    }
    case 'ordering': {
      const items = options(content, 'items');
      const order = (r.order as string[]) ?? [];
      return { text: order.map((id, i) => `${i + 1}. ${optionText(items, id)}`).join('\n'), format: 'list' };
    }
  }
}

/** The correct answer in words. Only ever called for published results with showCorrectAnswers on. */
export function formatCorrectAnswer(type: QuestionType, content: Json, key: Json): string | null {
  switch (type) {
    case 'single_choice':
      return optionText(options(content), key.correct);
    case 'true_false':
      return key.correct ? 'True' : 'False';
    case 'multiple_choice':
      return ((key.correct as string[]) ?? []).map((id) => optionText(options(content), id)).join('\n');
    case 'numeric': {
      if (typeof key.answer !== 'number') return null;
      const unit = typeof content.unit === 'string' && content.unit ? ` ${content.unit}` : '';
      const tol = key.tolerance as { type?: string; value?: number } | undefined;
      const within = tol?.value ? (tol.type === 'relative' ? ` (±${Number((tol.value * 100).toPrecision(6))}%)` : ` (±${tol.value})`) : '';
      // A computed key like 24.248711… reads better at the precision a person would write it.
      const digits = Math.max(1, Math.floor(Math.log10(Math.abs(key.answer) || 1)) + 1);
      const shown = Number.isInteger(key.answer) ? key.answer : Number(key.answer.toPrecision(Math.min(15, Math.max(4, digits + 2))));
      return `${shown}${unit}${within}`;
    }
    case 'short_text':
      return ((key.accepted as string[]) ?? []).join(' / ') || null;
    case 'fill_blanks': {
      const blanks = (key.blanks as Record<string, string[]>) ?? {};
      const template = typeof content.template === 'string' ? content.template : '';
      return template
        ? template.replace(/\[\[([^\]]+)\]\]/g, (_m, id: string) => `[${blanks[id]?.[0] ?? '—'}]`)
        : Object.entries(blanks).map(([k, v]) => `${k}: ${v[0]}`).join('\n');
    }
    case 'matching': {
      const pairs = (key.pairs as Record<string, string>) ?? {};
      const answers = options(content, 'answers');
      return options(content, 'prompts').map((p) => `${p.text} → ${optionText(answers, pairs[p.id])}`).join('\n');
    }
    case 'ordering': {
      const items = options(content, 'items');
      return ((key.order as string[]) ?? []).map((id, i) => `${i + 1}. ${optionText(items, id)}`).join('\n');
    }
    case 'long_text':
    case 'code':
      return typeof key.sampleAnswer === 'string' && key.sampleAnswer.trim() ? key.sampleAnswer : null;
  }
}

/** Groups identical answers: whitespace collapsed, case and trailing punctuation ignored. */
export function normalizeForGrouping(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/[.;,!]+$/, '').toLocaleLowerCase();
}

export interface ProvenanceSummary {
  typedPercent: number | null;
  /** Share of the answer that arrived by paste or one-shot insertion (burst), in percent. */
  pastedPercent: number | null;
  typedChars: number | null;
  pastedChars: number | null;
  pasteCount: number;
  largestPaste: number | null;
  bursts: number;
  /** Time between the first and the last edit. */
  spanMs: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const countOf = (v: unknown): number | null => (Array.isArray(v) ? v.length : num(v));

/**
 * Summarises the authorship record the candidate workspace keeps for written answers. Tolerates the shapes the
 * client may send (totals, or a list of operations) and returns null when there is nothing to show.
 */
export function summarizeProvenance(raw: unknown): ProvenanceSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  // The workspace's canonical record (see @athena/shared integrity): share of the final text that was external.
  const canonical = answerProvenanceSchema.safeParse(raw);
  if (canonical.success) {
    const s = summarizeCanonical(canonical.data);
    if (s.typedChars + s.pastedChars + s.burstChars === 0) return null;
    const pastedPercent = Math.round((s.finalExternalShare ?? s.externalShare) * 100);
    return {
      typedPercent: 100 - pastedPercent,
      pastedPercent,
      typedChars: s.typedChars,
      pastedChars: s.pastedChars + s.burstChars,
      pasteCount: s.pasteCount,
      largestPaste: s.largestPaste || null,
      bursts: s.burstCount,
      spanMs: s.spanMs,
    };
  }
  const p = raw as Record<string, unknown>;
  const chars = (p.chars && typeof p.chars === 'object' ? p.chars : {}) as Record<string, unknown>;
  let typed = num(p.typedChars) ?? num(p.typed) ?? num(chars.typed);
  let pasted = num(p.pastedChars) ?? num(p.pasted) ?? num(chars.pasted);
  let pasteCount = num(p.pasteCount) ?? countOf(p.pastes) ?? null;
  let largest = num(p.largestPaste) ?? num(p.maxPaste) ?? null;
  const pasteSizes = Array.isArray(p.pastes)
    ? (p.pastes as unknown[]).map((x) => (typeof x === 'number' ? x : num((x as Record<string, unknown>)?.chars) ?? num((x as Record<string, unknown>)?.length) ?? 0))
    : [];
  if (largest === null && pasteSizes.length) largest = Math.max(...pasteSizes);

  const ops = Array.isArray(p.ops) ? (p.ops as Record<string, unknown>[]) : Array.isArray(p.events) ? (p.events as Record<string, unknown>[]) : null;
  if ((typed === null || pasted === null) && ops) {
    let t = 0;
    let pa = 0;
    let pc = 0;
    let big = 0;
    for (const op of ops) {
      const kind = String(op.t ?? op.type ?? op.kind ?? '');
      const n = num(op.n) ?? num(op.chars) ?? num(op.length) ?? (typeof op.text === 'string' ? op.text.length : 0);
      if (kind.startsWith('paste') || kind === 'p') {
        pa += n;
        pc++;
        big = Math.max(big, n);
      } else if (kind.startsWith('type') || kind === 'insert' || kind === 'i') t += n;
    }
    typed ??= t;
    pasted ??= pa;
    pasteCount ??= pc;
    largest ??= big || null;
  }
  const bursts = countOf(p.bursts) ?? num(p.burstCount) ?? 0;
  if (typed === null && pasted === null && !pasteCount && !bursts) return null;
  const total = (typed ?? 0) + (pasted ?? 0);
  const ratio = num(p.pastedRatio) ?? num(p.pasteRatio);
  const pastedPercent = total > 0 ? Math.round(((pasted ?? 0) / total) * 100) : ratio !== null ? Math.round(ratio * (ratio <= 1 ? 100 : 1)) : null;
  return {
    typedPercent: pastedPercent === null ? null : 100 - pastedPercent,
    pastedPercent,
    typedChars: typed,
    pastedChars: pasted,
    pasteCount: pasteCount ?? 0,
    largestPaste: largest,
    bursts,
    spanMs: num(p.spanMs),
  };
}

/** "Candidate 07": stable for an exam because it follows the order attempts were started. */
export const pseudonym = (index: number) => `Candidate ${String(index + 1).padStart(2, '0')}`;

/** "Ali Hassan" → "A** H*****". Used on public verification pages and signed payloads. */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const chars = [...w];
      return chars[0]!.toLocaleUpperCase() + '*'.repeat(Math.max(1, chars.length - 1));
    })
    .join(' ');
}
