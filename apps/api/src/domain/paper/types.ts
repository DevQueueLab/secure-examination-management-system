import type { Difficulty, QuestionType } from '@athena/shared';
import type { Json, PreparedItem } from '../question-types/registry';

/**
 * Inputs of the paper engine. Everything here is plain data so the engine stays pure: the same input and
 * seed always produce the same paper, which is what lets any candidate's paper be reproduced in a dispute.
 */

/** The minimum the selection and fairness maths need to know about a question. */
export interface SelectableQuestion {
  /** Bank question id: identity for draws, overlap and exposure. */
  questionId: string;
  /** Answer marks for this question in the exam (method marks are not part of difficulty balancing). */
  marks: number;
  /** Author's difficulty label, the prior for the estimate. */
  difficulty: Difficulty;
  /** Observed mean score fraction from real attempts (null when never delivered). */
  observedP: number | null;
  /** Number of real attempts behind observedP. */
  observedN: number;
  /** Authoring order inside the section. */
  position: number;
}

/** A question as it will be delivered: adds what `questionType(type).prepare` needs. */
export interface DeliverableQuestion extends SelectableQuestion {
  examQuestionId: string;
  questionVersionId: string;
  type: QuestionType;
  content: Json;
  answerKey: Json;
}

export interface PaperSection<Q extends SelectableQuestion = SelectableQuestion> {
  id: string;
  position: number;
  /** null: every question is delivered (fixed section). N: draw N questions from the pool. */
  drawCount: number | null;
  questions: Q[];
}

export interface PaperSettings {
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  fairness: { balanceDifficulty: boolean; tolerancePercent: number };
}

export interface PaperInput<Q extends SelectableQuestion = SelectableQuestion> {
  sections: PaperSection<Q>[];
  settings: PaperSettings;
}

/** One selected question with its place on the paper. */
export interface SelectedQuestion<Q extends SelectableQuestion = SelectableQuestion> {
  sectionId: string;
  /** 1-based position on the whole paper. */
  position: number;
  question: Q;
  /** Calibrated probability of a correct answer used for balancing. */
  expectedP: number;
}

export interface PaperSelection<Q extends SelectableQuestion = SelectableQuestion> {
  items: SelectedQuestion<Q>[];
  /** Sum of answer marks on this paper. Constant across papers of one exam. */
  totalMarks: number;
  /** Expected score of this paper in marks: sum of marks x p. */
  expectedScore: number;
  /** Expected score of a purely random paper in marks (the balancing target). */
  targetScore: number;
  /** expectedScore / totalMarks, the value stored on the attempt for the fairness audit. */
  paperExpected: number;
  /** targetScore / totalMarks. */
  targetExpected: number;
  /** Whether the balancer ran (setting on and at least one pool). */
  balanced: boolean;
  /** |expected - target| is within tolerancePercent of totalMarks. */
  withinTolerance: boolean;
  /** Number of swaps the balancer applied. */
  swaps: number;
}

/** A selected question prepared for one candidate (options permuted, variables drawn). */
export interface AssembledItem<
  Q extends DeliverableQuestion = DeliverableQuestion,
> extends SelectedQuestion<Q> {
  prepared: PreparedItem;
}

export interface AssembledPaper<Q extends DeliverableQuestion = DeliverableQuestion> extends Omit<
  PaperSelection<Q>,
  'items'
> {
  items: AssembledItem<Q>[];
}
