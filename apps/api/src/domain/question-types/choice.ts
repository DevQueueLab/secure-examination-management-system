import type { MarkingScheme } from '@athena/shared';
import { round3, type Rng } from '../rng';
import { BaseQuestionType } from './base';
import type { GradeOutcome, Json, PreparedItem } from './types';

type Option = { id: string; text: string };

function prepareOptions(content: Json, key: Json, ctx: { rng: Rng; shuffleOptions: boolean }): PreparedItem {
  const options = content.options as Option[];
  const order = ctx.shuffleOptions ? ctx.rng.shuffle(options) : options;
  return { content: { ...structuredClone(content), options: order }, answerKey: structuredClone(key), variant: { optionOrder: order.map((o) => o.id) } };
}

function assertOptionIds(options: Option[], fail: (m: string, f?: string) => never) {
  const ids = new Set<string>();
  for (const o of options) {
    if (ids.has(o.id)) fail('Option ids must be unique', 'content.options');
    ids.add(o.id);
  }
  return ids;
}

export class SingleChoiceType extends BaseQuestionType {
  readonly type = 'single_choice' as const;

  protected override crossValidate(content: Json, key: Json) {
    const ids = assertOptionIds(content.options as Option[], (m, f) => this.fail(m, f));
    if (!ids.has(key.correct as string)) this.fail('Choose which option is correct', 'key.correct');
  }
  override prepare(content: Json, key: Json, ctx: { rng: Rng; shuffleOptions: boolean }) {
    return prepareOptions(content, key, ctx);
  }
  protected override checkResponseRefs(content: Json, r: Json) {
    if (r.optionId !== null && !(content.options as Option[]).some((o) => o.id === r.optionId)) this.fail('Unknown option');
  }
  isAnswered(r: Json | null | undefined) {
    return !!r && r.optionId != null;
  }
  grade(key: Json, r: Json | null | undefined, marks: number, marking: MarkingScheme): GradeOutcome {
    if (!this.isAnswered(r)) return { score: 0, detail: { answered: false } };
    const correct = r!.optionId === key.correct;
    return { score: correct ? marks : round3(-marks * marking.negativeMarking), detail: { correct } };
  }
}

export class TrueFalseType extends BaseQuestionType {
  readonly type = 'true_false' as const;
  isAnswered(r: Json | null | undefined) {
    return !!r && typeof r.value === 'boolean';
  }
  grade(key: Json, r: Json | null | undefined, marks: number, marking: MarkingScheme): GradeOutcome {
    if (!this.isAnswered(r)) return { score: 0, detail: { answered: false } };
    const correct = r!.value === key.correct;
    return { score: correct ? marks : round3(-marks * marking.negativeMarking), detail: { correct } };
  }
}

export class MultipleChoiceType extends BaseQuestionType {
  readonly type = 'multiple_choice' as const;

  protected override crossValidate(content: Json, key: Json) {
    const ids = assertOptionIds(content.options as Option[], (m, f) => this.fail(m, f));
    const correct = key.correct as string[];
    if (correct.some((c) => !ids.has(c))) this.fail('A correct option does not exist', 'key.correct');
    if (new Set(correct).size !== correct.length) this.fail('Correct options must be unique', 'key.correct');
  }
  override prepare(content: Json, key: Json, ctx: { rng: Rng; shuffleOptions: boolean }) {
    const prepared = prepareOptions(content, key, ctx);
    // The penalty scheme needs the size of the wrong-option pool.
    prepared.answerKey.optionCount = (content.options as Option[]).length;
    return prepared;
  }
  protected override checkResponseRefs(content: Json, r: Json) {
    const ids = new Set((content.options as Option[]).map((o) => o.id));
    if ((r.optionIds as string[]).some((id) => !ids.has(id))) this.fail('Unknown option');
  }
  isAnswered(r: Json | null | undefined) {
    return !!r && Array.isArray(r.optionIds) && r.optionIds.length > 0;
  }
  /**
   * all_or_nothing: the exact set earns full marks.
   * partial: credit per correct pick, but any wrong pick earns 0 (no reward for guessing everything).
   * partial_penalty: right picks minus wrong picks, each normalised by its pool size, floored at 0.
   */
  grade(key: Json, r: Json | null | undefined, marks: number, marking: MarkingScheme): GradeOutcome {
    if (!this.isAnswered(r)) return { score: 0, detail: { answered: false } };
    const correct = new Set(key.correct as string[]);
    const picked = new Set(r!.optionIds as string[]);
    const right = [...picked].filter((p) => correct.has(p)).length;
    const wrong = picked.size - right;
    const totalOptions = Number(key.optionCount ?? 0) || Math.max(correct.size + wrong, correct.size + 1);
    const wrongPool = Math.max(1, totalOptions - correct.size);
    const exact = right === correct.size && wrong === 0;
    let fraction: number;
    switch (marking.multiSelect) {
      case 'all_or_nothing':
        fraction = exact ? 1 : 0;
        break;
      case 'partial':
        fraction = wrong > 0 ? 0 : right / correct.size;
        break;
      default:
        fraction = Math.max(0, right / correct.size - wrong / wrongPool);
    }
    return { score: round3(marks * fraction), detail: { right, wrong, of: correct.size, exact } };
  }
}
