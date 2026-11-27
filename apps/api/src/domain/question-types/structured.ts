import type { MarkingScheme } from '@athena/shared';
import { round3, type Rng } from '../rng';
import { BaseQuestionType, normalizeText } from './base';
import type { GradeOutcome, Json, PreparedItem } from './types';

type Option = { id: string; text: string };

export class FillBlanksType extends BaseQuestionType {
  readonly type = 'fill_blanks' as const;

  protected override crossValidate(content: Json, key: Json) {
    const blanks = (content.blanks as { id: string }[]).map((b) => b.id);
    const template = content.template as string;
    for (const id of blanks) {
      if (!template.includes(`[[${id}]]`)) this.fail(`Blank [[${id}]] is missing from the text`, 'content.template');
      const accepted = (key.blanks as Record<string, string[]>)[id];
      if (!accepted?.length) this.fail(`Add accepted answers for blank ${id}`, 'key.blanks');
    }
  }
  protected override checkResponseRefs(content: Json, r: Json) {
    const ids = new Set((content.blanks as { id: string }[]).map((b) => b.id));
    if (Object.keys(r.blanks as object).some((k) => !ids.has(k))) this.fail('Unknown blank');
  }
  isAnswered(r: Json | null | undefined) {
    return !!r && Object.values((r.blanks as Record<string, string>) ?? {}).some((v) => v.trim() !== '');
  }
  grade(key: Json, r: Json | null | undefined, marks: number, _m: MarkingScheme): GradeOutcome {
    const accepted = key.blanks as Record<string, string[]>;
    const ids = Object.keys(accepted);
    if (!this.isAnswered(r)) return { score: 0, detail: { answered: false, correct: 0, of: ids.length } };
    const cs = Boolean(key.caseSensitive);
    const given = r!.blanks as Record<string, string>;
    const perBlank: Record<string, boolean> = {};
    for (const id of ids) {
      const g = normalizeText(given[id] ?? '', cs);
      perBlank[id] = g !== '' && accepted[id]!.some((a) => normalizeText(a, cs) === g);
    }
    const correct = Object.values(perBlank).filter(Boolean).length;
    return { score: round3((marks * correct) / ids.length), detail: { correct, of: ids.length, perBlank } };
  }
}

export class MatchingType extends BaseQuestionType {
  readonly type = 'matching' as const;

  protected override crossValidate(content: Json, key: Json) {
    const answers = new Set((content.answers as Option[]).map((a) => a.id));
    const pairs = key.pairs as Record<string, string>;
    for (const p of content.prompts as Option[]) {
      if (!pairs[p.id] || !answers.has(pairs[p.id]!)) this.fail(`Choose the match for "${p.text}"`, 'key.pairs');
    }
  }
  override prepare(content: Json, key: Json, ctx: { rng: Rng; shuffleOptions: boolean }): PreparedItem {
    const answers = content.answers as Option[];
    const order = ctx.rng.shuffle(answers);
    return { content: { ...structuredClone(content), answers: order }, answerKey: structuredClone(key), variant: { answerOrder: order.map((a) => a.id) } };
  }
  protected override checkResponseRefs(content: Json, r: Json) {
    const prompts = new Set((content.prompts as Option[]).map((p) => p.id));
    const answers = new Set((content.answers as Option[]).map((a) => a.id));
    for (const [p, a] of Object.entries(r.pairs as Record<string, string | null>)) {
      if (!prompts.has(p) || (a !== null && !answers.has(a))) this.fail('Unknown match');
    }
  }
  isAnswered(r: Json | null | undefined) {
    return !!r && Object.values((r.pairs as Record<string, string | null>) ?? {}).some((v) => v != null);
  }
  grade(key: Json, r: Json | null | undefined, marks: number, _m: MarkingScheme): GradeOutcome {
    const pairs = key.pairs as Record<string, string>;
    const prompts = Object.keys(pairs);
    if (!this.isAnswered(r)) return { score: 0, detail: { answered: false, correct: 0, of: prompts.length } };
    const given = r!.pairs as Record<string, string | null>;
    const correct = prompts.filter((p) => given[p] === pairs[p]).length;
    return { score: round3((marks * correct) / prompts.length), detail: { correct, of: prompts.length } };
  }
}

/** Length of the longest run of items kept in the correct relative order (LCS of two permutations). */
export function longestOrderedRun(given: string[], correct: string[]): number {
  const pos = new Map(correct.map((id, i) => [id, i]));
  const seq = given.map((id) => pos.get(id)).filter((v): v is number => v !== undefined);
  const tails: number[] = [];
  for (const x of seq) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = x;
  }
  return tails.length;
}

export class OrderingType extends BaseQuestionType {
  readonly type = 'ordering' as const;

  protected override crossValidate(content: Json, key: Json) {
    const items = (content.items as Option[]).map((i) => i.id).sort();
    const order = [...(key.order as string[])].sort();
    if (items.length !== order.length || items.some((id, i) => id !== order[i])) {
      this.fail('The correct order must list every item exactly once', 'key.order');
    }
  }
  override prepare(content: Json, key: Json, ctx: { rng: Rng; shuffleOptions: boolean }): PreparedItem {
    const items = content.items as Option[];
    let order = ctx.rng.shuffle(items);
    const correct = key.order as string[];
    // Never hand a candidate the solved order.
    if (order.every((it, i) => it.id === correct[i])) order = [...order.slice(1), order[0]!];
    return { content: { ...structuredClone(content), items: order }, answerKey: structuredClone(key), variant: { initialOrder: order.map((i) => i.id) } };
  }
  protected override checkResponseRefs(content: Json, r: Json) {
    const ids = new Set((content.items as Option[]).map((i) => i.id));
    const order = r.order as string[];
    if (order.some((id) => !ids.has(id)) || new Set(order).size !== order.length) this.fail('Invalid order');
  }
  isAnswered(r: Json | null | undefined) {
    return !!r && Array.isArray(r.order) && r.order.length > 0;
  }
  /** Credit for the longest run of items in the right relative order, so one misplaced item costs one item. */
  grade(key: Json, r: Json | null | undefined, marks: number, _m: MarkingScheme): GradeOutcome {
    const correct = key.order as string[];
    if (!this.isAnswered(r)) return { score: 0, detail: { answered: false } };
    const run = longestOrderedRun(r!.order as string[], correct);
    const exact = run === correct.length && (r!.order as string[]).length === correct.length;
    return { score: round3((marks * run) / correct.length), detail: { inOrder: run, of: correct.length, exact } };
  }
}
