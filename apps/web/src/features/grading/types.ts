import type { ExamPhase, QuestionType, ResultsStatus } from '@athena/shared';

/** Which mark a grader is awarding: the answer itself, or the shown working (two-part questions). */
export type Part = 'answer' | 'working';

export interface RubricItem {
  id: string;
  examId: string;
  questionId: string;
  target: Part;
  label: string;
  description: string | null;
  points: number;
  position: number;
  /** Answers that currently have this item ticked. */
  usage: number;
  updatedAt: string;
}

export interface RubricQuestion {
  questionId: string;
  label: string;
  title: string;
  type: QuestionType;
  parts: { part: Part; max: number }[];
}

export interface RubricList {
  question: RubricQuestion;
  items: RubricItem[];
}

export interface Rescore {
  answers: number;
  attempts: number;
  changedScores: number;
}

export interface QueueQuestion {
  questionId: string;
  label: string;
  number: number;
  title: string;
  type: QuestionType;
  typeLabel: string;
  sectionTitle: string | null;
  category: string | null;
  parts: { part: Part; max: number; graded: number }[];
  total: number;
  graded: number;
  remaining: number;
  /** Written answers left empty: they can be zeroed in one step. */
  blank: number;
  rubricCount: number;
}

export interface GradingQueue {
  exam: { id: string; title: string; code: string | null; resultsStatus: ResultsStatus };
  anonymous: boolean;
  submitted: number;
  inProgress: number;
  progress: { total: number; graded: number; remaining: number };
  questions: QueueQuestion[];
}

export interface PartState {
  max: number;
  score: number | null;
  graded: boolean;
  adjustment: number;
  auto: boolean;
}

export interface ScratchPage {
  pageKey: string;
  kind: 'canvas' | 'notes' | null;
  data: Record<string, unknown> | null;
}

export interface Provenance {
  typedPercent: number | null;
  pastedPercent: number | null;
  typedChars: number | null;
  pastedChars: number | null;
  pasteCount: number;
  largestPaste: number | null;
  bursts: number;
  spanMs: number | null;
}

export interface FormattedResponse {
  text: string | null;
  format: 'text' | 'code' | 'choice' | 'list';
  language?: string;
  selected?: string[];
}

export interface GradeableAnswer {
  id: string;
  attemptId: string;
  attemptItemId: string;
  position: number;
  candidate: { label: string; name: string | null; rollNumber: string | null };
  answered: boolean;
  response: FormattedResponse;
  working: { text: string; scratchPages: ScratchPage[] } | null;
  provenance: Provenance | null;
  flagged: boolean;
  timeSpentMs: number;
  parts: { answer: PartState; working: PartState | null };
  rubricItemIds: string[];
  feedback: string | null;
  scoreStatus: string;
  itemScore: number | null;
  itemMax: number;
  graded: boolean;
  gradedAt: string | null;
  gradedBy: string | null;
  reviewPriority: number | null;
  /** Set when other answers to this question are identical (after normalising case and spacing). */
  groupKey: string | null;
}

export interface AnswerGroup {
  key: string;
  text: string;
  count: number;
  answerIds: string[];
}

export interface QuestionAnswers {
  exam: { id: string; title: string; code: string | null; resultsStatus: ResultsStatus };
  anonymous: boolean;
  question: RubricQuestion & {
    typeLabel: string;
    stem: string;
    workingGuidance: string | null;
    language: string | null;
  };
  rubric: RubricItem[];
  progress: { total: number; graded: number };
  answers: GradeableAnswer[];
  groups: AnswerGroup[];
}

export interface GradeInput {
  part: Part;
  rubricItemIds: string[];
  adjustment?: number;
  score?: number;
  feedback?: string | null;
}

export interface GradeResult {
  answer: {
    id: string;
    attemptId: string;
    parts: { answer: PartState; working: PartState | null };
    rubricItemIds: string[];
    feedback: string | null;
    itemScore: number | null;
    graded: boolean;
    gradedAt: string | null;
    gradedBy: string | null;
  };
  attempt: { id: string; score: number | null; maxScore: number | null; gradingStatus: string; pending: number };
  progress: { total: number; graded: number };
  published: boolean;
}

export interface InboxExam {
  examId: string;
  title: string;
  code: string | null;
  phase: ExamPhase;
  resultsStatus: ResultsStatus;
  role: string | null;
  submitted: number;
  inProgress: number;
  total: number;
  graded: number;
  remaining: number;
  questionsOpen: number;
  lastGradedAt: string | null;
  windowClosesAt: string;
}
