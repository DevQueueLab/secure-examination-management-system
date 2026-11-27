import { questionType } from '../question-types/registry';
import { createRng } from '../rng';
import { selectPaper } from './select';
import type { AssembledPaper, DeliverableQuestion, PaperInput } from './types';

/**
 * Builds one candidate's paper: selection and order (see selectPaper), then each question's variant from its
 * own RNG stream `seed:questionId`. Per-question streams mean a question's option order and variables depend
 * only on the attempt seed and that question, never on what else was drawn, so a paper replays exactly.
 */
export function assemblePaper<Q extends DeliverableQuestion>(
  input: PaperInput<Q>,
  seed: string,
): AssembledPaper<Q> {
  const selection = selectPaper(input, seed);
  return {
    ...selection,
    items: selection.items.map((item) => ({
      ...item,
      prepared: questionType(item.question.type).prepare(
        item.question.content,
        item.question.answerKey,
        {
          rng: createRng(`${seed}:${item.question.questionId}`),
          shuffleOptions: input.settings.shuffleOptions,
        },
      ),
    })),
  };
}
