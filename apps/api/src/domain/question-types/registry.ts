import type { QuestionType } from '@athena/shared';
import { MultipleChoiceType, SingleChoiceType, TrueFalseType } from './choice';
import { NumericType } from './numeric';
import { FillBlanksType, MatchingType, OrderingType } from './structured';
import { CodeType, LongTextType, ShortTextType } from './text';
import type { QuestionTypeHandler } from './types';

const handlers: Record<QuestionType, QuestionTypeHandler> = {
  single_choice: new SingleChoiceType(),
  true_false: new TrueFalseType(),
  multiple_choice: new MultipleChoiceType(),
  numeric: new NumericType(),
  short_text: new ShortTextType(),
  fill_blanks: new FillBlanksType(),
  matching: new MatchingType(),
  ordering: new OrderingType(),
  long_text: new LongTextType(),
  code: new CodeType(),
};

/** Looks up the strategy for a question type. */
export function questionType(type: QuestionType): QuestionTypeHandler {
  return handlers[type];
}

export type { QuestionTypeHandler, PreparedItem, GradeOutcome, Json } from './types';
