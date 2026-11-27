import type { GradeInput, GradeableAnswer, Part, PartState, RubricItem } from './types';

/**
 * A grader's unsaved decision for one answer (or one group of identical answers).
 * Mirrors the API's arithmetic: part score = clamp(Σ ticked points + adjustment, 0, max), or an explicit score
 * that must already lie in [0, max].
 */

export interface PartDraft {
  ids: string[];
  /** Text of the adjustment field; empty means 0. */
  adjustment: string;
  /** The grader typed the score directly instead of building it from the rubric. */
  explicit: boolean;
  score: string;
}

export interface Draft {
  answer: PartDraft | null;
  working: PartDraft | null;
  feedback: string;
}

export interface PartOutcome {
  score: number | null;
  /** Σ points + adjustment before clamping. */
  raw: number | null;
  clamped: boolean;
  error: { field: 'score' | 'adjustment'; message: string } | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const marks = (n: number) => `${n} mark${n === 1 ? '' : 's'}`;

function parseMarks(text: string): number | null {
  const t = text.trim().replace('−', '-').replace(',', '.');
  if (!t) return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return Number.NaN;
  return Number(t);
}

const threeDecimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

export function humanParts(a: Pick<GradeableAnswer, 'parts'>): Part[] {
  const out: Part[] = [];
  if (!a.parts.answer.auto) out.push('answer');
  if (a.parts.working) out.push('working');
  return out;
}

export function partState(a: Pick<GradeableAnswer, 'parts'>, part: Part): PartState | null {
  return part === 'answer' ? a.parts.answer : a.parts.working;
}

export function itemsFor(rubric: RubricItem[], part: Part): RubricItem[] {
  return rubric.filter((r) => r.target === part).sort((x, y) => x.position - y.position || x.label.localeCompare(y.label));
}

function initialPart(state: PartState, selected: string[], items: RubricItem[]): PartDraft {
  const ids = selected.filter((id) => items.some((i) => i.id === id));
  return {
    ids,
    adjustment: state.adjustment ? String(state.adjustment) : '',
    // Without a rubric for this part the grader types the score.
    explicit: items.length === 0,
    score: state.score === null ? '' : String(state.score),
  };
}

export function initialDraft(a: GradeableAnswer, rubric: RubricItem[]): Draft {
  return {
    answer: a.parts.answer.auto ? null : initialPart(a.parts.answer, a.rubricItemIds, itemsFor(rubric, 'answer')),
    working: a.parts.working ? initialPart(a.parts.working, a.rubricItemIds, itemsFor(rubric, 'working')) : null,
    feedback: a.feedback ?? '',
  };
}

/** One draft for a whole group: shared ticks are kept only when every answer in the group agrees. */
export function initialGroupDraft(group: GradeableAnswer[], rubric: RubricItem[]): Draft {
  const first = group[0]!;
  const same = group.every((a) => a.rubricItemIds.slice().sort().join() === first.rubricItemIds.slice().sort().join() && a.parts.answer.adjustment === first.parts.answer.adjustment);
  const sameFeedback = group.every((a) => (a.feedback ?? '') === (first.feedback ?? ''));
  const items = itemsFor(rubric, 'answer');
  return {
    answer: first.parts.answer.auto
      ? null
      : same
        ? initialPart(first.parts.answer, first.rubricItemIds, items)
        : { ids: [], adjustment: '', explicit: items.length === 0, score: '' },
    working: null,
    feedback: sameFeedback ? (first.feedback ?? '') : '',
  };
}

export function evaluatePart(d: PartDraft, items: RubricItem[], max: number): PartOutcome {
  if (d.explicit) {
    const v = parseMarks(d.score);
    if (v === null) return { score: null, raw: null, clamped: false, error: { field: 'score', message: 'Enter a score' } };
    if (Number.isNaN(v)) return { score: null, raw: null, clamped: false, error: { field: 'score', message: 'The score must be a number' } };
    if (v < 0 || v > max) return { score: null, raw: v, clamped: false, error: { field: 'score', message: `Enter a score between 0 and ${max} (this part is worth ${marks(max)})` } };
    if (!threeDecimals(v)) return { score: null, raw: v, clamped: false, error: { field: 'score', message: 'Use at most three decimals' } };
    return { score: round3(v), raw: v, clamped: false, error: null };
  }
  const adj = parseMarks(d.adjustment);
  if (Number.isNaN(adj)) return { score: null, raw: null, clamped: false, error: { field: 'adjustment', message: 'The adjustment must be a number, like 1.5 or −2' } };
  const adjustment = adj ?? 0;
  if (Math.abs(adjustment) > max) return { score: null, raw: null, clamped: false, error: { field: 'adjustment', message: `An adjustment can move the score by at most ${marks(max)}` } };
  if (!threeDecimals(adjustment)) return { score: null, raw: null, clamped: false, error: { field: 'adjustment', message: 'Use at most three decimals' } };
  const sum = d.ids.reduce((s, id) => s + (items.find((i) => i.id === id)?.points ?? 0), 0);
  const raw = round3(sum + adjustment);
  const score = round3(Math.min(max, Math.max(0, raw)));
  return { score, raw, clamped: score !== raw, error: null };
}

export function toGradeInput(part: Part, d: PartDraft, feedback: string): GradeInput {
  const base = { part, rubricItemIds: d.ids, feedback: feedback.trim() ? feedback.trim() : null };
  if (d.explicit) return { ...base, score: Number(parseMarks(d.score)) };
  return { ...base, adjustment: parseMarks(d.adjustment) ?? 0 };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  const part = (x: PartDraft | null, y: PartDraft | null) =>
    x === y ||
    (!!x &&
      !!y &&
      x.explicit === y.explicit &&
      (x.explicit ? x.score.trim() === y.score.trim() : (parseMarks(x.adjustment) ?? 0) === (parseMarks(y.adjustment) ?? 0)) &&
      x.ids.slice().sort().join() === y.ids.slice().sort().join());
  return part(a.answer, b.answer) && part(a.working, b.working) && a.feedback.trim() === b.feedback.trim();
}

/** Projected score of an answer if one rubric item's points changed (the Rubrics tab's preview). */
export function projectRescore(a: GradeableAnswer, rubric: RubricItem[], itemId: string, nextPoints: number | null): { part: Part; from: number | null; to: number } | null {
  const item = rubric.find((r) => r.id === itemId);
  if (!item || !a.rubricItemIds.includes(itemId)) return null;
  const state = partState(a, item.target);
  if (!state || state.score === null) return null;
  const ids = a.rubricItemIds.filter((id) => rubric.find((r) => r.id === id)?.target === item.target);
  const points = (id: string) => (id === itemId ? (nextPoints ?? 0) : (rubric.find((r) => r.id === id)?.points ?? 0));
  const oldSum = ids.reduce((s, id) => s + (rubric.find((r) => r.id === id)?.points ?? 0), 0);
  const expected = round3(Math.min(state.max, Math.max(0, oldSum + state.adjustment)));
  // A score set another way (a dispute, an explicit score) shifts by the delta, as the API does.
  const adjustment = Math.abs(expected - state.score) > 1e-9 ? round3(state.score - oldSum) : state.adjustment;
  const newSum = ids.reduce((s, id) => s + points(id), 0);
  return { part: item.target, from: state.score, to: round3(Math.min(state.max, Math.max(0, newSum + adjustment))) };
}
