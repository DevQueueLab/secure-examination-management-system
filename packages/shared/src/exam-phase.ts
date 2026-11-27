import type { ExamPhase, ExamStatus } from './enums';

/** The single source of truth for the lifecycle phase a user sees. Uses server time only. */
export function examPhase(
  exam: { status: ExamStatus; windowOpensAt: Date | string; windowClosesAt: Date | string },
  now: Date = new Date(),
): ExamPhase {
  if (exam.status === 'draft') return 'draft';
  if (exam.status === 'archived') return 'archived';
  const opens = new Date(exam.windowOpensAt).getTime();
  const closes = new Date(exam.windowClosesAt).getTime();
  const t = now.getTime();
  if (t < opens) return 'scheduled';
  if (t < closes) return 'ongoing';
  return 'completed';
}

export const EXAM_PHASE_LABEL: Record<ExamPhase, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  ongoing: 'Live',
  completed: 'Completed',
  archived: 'Archived',
};
