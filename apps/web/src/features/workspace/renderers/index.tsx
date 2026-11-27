'use client';

import type { AttemptItemView, QuestionType } from '@athena/shared';
import { useMemo } from 'react';
import { MultipleChoice, SingleChoice, TrueFalse } from './choice';
import { FillBlanks, Matching, Ordering } from './structured';
import { CodeAnswer, LongTextAnswer, NumericAnswer, ShortTextAnswer } from './text';
import { parseContent, type RendererProps } from './shared';

type AnyRendererProps = Omit<RendererProps<QuestionType>, 'content'>;

/** The answer area for one question, chosen by its type. */
export function AnswerRenderer(props: AnyRendererProps & { item: AttemptItemView }) {
  const { item } = props;
  const content = useMemo(() => parseContent(item.type, item.content), [item.type, item.content]);
  switch (item.type) {
    case 'single_choice':
      return <SingleChoice {...props} content={content as RendererProps<'single_choice'>['content']} />;
    case 'true_false':
      return <TrueFalse {...props} content={content as RendererProps<'true_false'>['content']} />;
    case 'multiple_choice':
      return <MultipleChoice {...props} content={content as RendererProps<'multiple_choice'>['content']} />;
    case 'numeric':
      return <NumericAnswer {...props} content={content as RendererProps<'numeric'>['content']} />;
    case 'short_text':
      return <ShortTextAnswer {...props} content={content as RendererProps<'short_text'>['content']} />;
    case 'fill_blanks':
      return <FillBlanks {...props} content={content as RendererProps<'fill_blanks'>['content']} />;
    case 'matching':
      return <Matching {...props} content={content as RendererProps<'matching'>['content']} />;
    case 'ordering':
      return <Ordering {...props} content={content as RendererProps<'ordering'>['content']} />;
    case 'long_text':
      return <LongTextAnswer {...props} content={content as RendererProps<'long_text'>['content']} />;
    case 'code':
      return <CodeAnswer {...props} content={content as RendererProps<'code'>['content']} />;
    default:
      return <p className="text-callout text-label-secondary">This question type can’t be answered in this browser.</p>;
  }
}
