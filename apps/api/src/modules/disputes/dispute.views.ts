import type { DisputeCategory, DisputeOutcome, DisputeStatus, ExamStaffRole, RemedyType } from '@athena/shared';
import type { FrozenEvidence } from './evidence';

export const CATEGORY_LABEL: Record<DisputeCategory, string> = {
  grading_error: 'Grading error',
  ambiguous_question: 'Ambiguous question',
  technical_incident: 'Technical incident',
  other: 'Something else',
};

export const STATUS_LABEL: Record<DisputeStatus, string> = {
  open: 'Submitted',
  under_review: 'Under review',
  needs_info: 'Needs your reply',
  resolved: 'Resolved',
  appealed: 'Appealed',
  closed: 'Closed',
};

export const OUTCOME_LABEL: Record<DisputeOutcome, string> = {
  upheld: 'Upheld',
  partially_upheld: 'Partially upheld',
  rejected: 'Not upheld',
};

export const REMEDY_LABEL: Record<RemedyType, string> = {
  accept_alternatives: 'Accept an alternative answer',
  full_marks_all: 'Full marks for everyone',
  drop_question: 'Drop the question',
};

/** Staff appear to candidates by role only, never by name. */
export function roleLabel(examRole: ExamStaffRole | null | undefined, orgRoleName: string | null | undefined): string {
  if (examRole === 'owner' || examRole === 'co_examiner') return 'Examiner';
  if (examRole === 'grader') return 'Grader';
  if (examRole === 'proctor') return 'Proctor';
  return orgRoleName ?? 'Exam team';
}

export interface Visibility {
  /** Results are published right now (decided at read time, never at freeze time). */
  published: boolean;
  showCorrectAnswers: boolean;
  showFeedback: boolean;
}

/**
 * The frozen evidence as the candidate may see it. Scores, rubric and feedback only once results are published;
 * the key only when the exam shows correct answers; never who graded it.
 */
export function candidateEvidence(e: FrozenEvidence, vis: Visibility, sealIntact: boolean) {
  return {
    frozenAt: e.frozenAt,
    sealIntact,
    ledgerHead: e.ledgerHead,
    exam: { title: e.exam.title, code: e.exam.code },
    attempt: {
      submittedAt: e.attempt.submittedAt,
      submitReason: e.attempt.submitReason,
      score: vis.published ? e.attempt.score : null,
      maxScore: vis.published ? e.attempt.maxScore : null,
    },
    item: e.item
      ? {
          number: e.item.number,
          title: e.item.title,
          type: e.item.type,
          typeLabel: e.item.typeLabel,
          stem: e.item.stem,
          content: e.item.content,
          marks: e.item.marks,
          workingMarks: e.item.workingMarks,
          voidReason: e.item.voidReason,
        }
      : null,
    answer: e.answer ? { formatted: e.answer.formatted, working: e.answer.working, answeredAt: e.answer.answeredAt, timeSpentMs: e.answer.timeSpentMs } : null,
    score: vis.published ? e.score : null,
    rubric: vis.published && vis.showFeedback ? e.rubric.map((r) => ({ label: r.label, points: r.points, target: r.target })) : [],
    feedback: vis.published && vis.showFeedback ? e.feedback : null,
    correctAnswer: vis.published && vis.showCorrectAnswers ? e.correctAnswer : null,
    incidents: e.incidents,
    connectivity: e.connectivity,
    appealOf: e.appealOf,
  };
}
export type CandidateEvidence = ReturnType<typeof candidateEvidence>;

/** Staff see everything frozen, with grader ids resolved to names by the caller. */
export function staffEvidence(e: FrozenEvidence, sealIntact: boolean, graders: { id: string; name: string }[]) {
  const { seal: _seal, grading, ...rest } = e;
  return { ...rest, sealIntact, grading: { gradedAt: grading.gradedAt, graders } };
}
