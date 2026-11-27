import {
  isAutoGraded,
  markingSchemeSchema,
  type QuestionType,
  type ScoreStatus,
} from '@athena/shared';
import { questionType, type Json } from '../../domain/question-types/registry';

interface GradableItem {
  type: QuestionType;
  marks: number;
  workingMarks: number;
  answerKey: Json;
  marking: Json;
}

interface GradableAnswer {
  response: Json | null;
  working: { text?: string; scratchPages?: string[] } | null;
  manualScore: number | null;
  workingScore: number | null;
}

/** The answer columns automatic grading owns. */
export interface AutoGrade {
  autoScore: number | null;
  manualScore: number | null;
  workingScore: number | null;
  /** Describes the answer part: auto (objective, or a blank written answer) or ungraded (awaits a human). */
  scoreStatus: ScoreStatus;
}

export const isWorkingBlank = (working: GradableAnswer['working']) =>
  !working || (!(working.text ?? '').trim() && (working.scratchPages ?? []).length === 0);

/**
 * Grades what can be graded without a person, at submission or when held offline answers are accepted:
 * - objective types get autoScore from their strategy;
 * - a blank written answer (essay, code) is 0, an answered one stays ungraded for a grader;
 * - blank working earns 0 method marks; shown working stays pending for a grader.
 * Existing human grades for unchanged parts are preserved (pass them in `current`).
 */
export function autoGrade(item: GradableItem, current: GradableAnswer | undefined): AutoGrade {
  const handler = questionType(item.type);
  const response = current?.response ?? null;
  let autoScore: number | null = null;
  let manualScore = current?.manualScore ?? null;
  let scoreStatus: ScoreStatus = 'ungraded';

  if (isAutoGraded(item.type)) {
    autoScore =
      handler.grade(item.answerKey, response, item.marks, markingSchemeSchema.parse(item.marking))
        .score ?? 0;
    scoreStatus = 'auto';
  } else if (!handler.isAnswered(response)) {
    manualScore = 0;
    scoreStatus = 'auto';
  } else if (manualScore !== null) {
    scoreStatus = 'manual';
  }

  let workingScore = current?.workingScore ?? null;
  if (item.workingMarks > 0 && workingScore === null && isWorkingBlank(current?.working ?? null))
    workingScore = 0;
  return { autoScore, manualScore, workingScore, scoreStatus };
}
