import type { MarkingScheme, QuestionType } from '@athena/shared';
import { contentSchemas, keySchemas, responseSchemas } from '@athena/shared';
import { ValidationError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import type { Rng } from '../rng';
import type { GradeOutcome, Json, PreparedItem, QuestionTypeHandler } from './types';

/** Template method base: zod validation from @athena/shared plus per-type hooks. */
export abstract class BaseQuestionType implements QuestionTypeHandler {
  abstract readonly type: QuestionType;

  validateDraft(content: unknown, key: unknown) {
    const c = parse(contentSchemas[this.type], content) as Json;
    const k = parse(keySchemas[this.type], key) as Json;
    this.crossValidate(c, k);
    return { content: c, key: k };
  }

  /** Cross-field rules, e.g. "the correct option must exist". */
  protected crossValidate(_content: Json, _key: Json): void {}

  prepare(content: Json, key: Json, _ctx: { rng: Rng; shuffleOptions: boolean }): PreparedItem {
    return { content: structuredClone(content), answerKey: structuredClone(key), variant: {} };
  }

  parseResponse(content: Json, response: unknown): Json {
    const r = parse(responseSchemas[this.type], response) as Json;
    this.checkResponseRefs(content, r);
    return r;
  }

  protected checkResponseRefs(_content: Json, _response: Json): void {}

  abstract isAnswered(response: Json | null | undefined): boolean;
  abstract grade(key: Json, response: Json | null | undefined, marks: number, marking: MarkingScheme): GradeOutcome;

  protected fail(message: string, field = '_'): never {
    throw new ValidationError(message, { [field]: message });
  }
}

export const normalizeText = (value: string, caseSensitive: boolean) => {
  const collapsed = value.trim().replace(/\s+/g, ' ');
  return caseSensitive ? collapsed : collapsed.toLocaleLowerCase();
};
