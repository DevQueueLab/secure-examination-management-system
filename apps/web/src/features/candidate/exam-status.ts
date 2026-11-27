import type { CandidateExamCard } from '@athena/shared';

export type ExamBucket = 'available' | 'upcoming' | 'completed';

export type ExamAction =
  | { kind: 'start'; href: string; label: 'Start' }
  | { kind: 'resume'; href: string; label: 'Resume' }
  | { kind: 'details'; href: string; label: 'View details' }
  | { kind: 'awaiting'; href: string; label: 'Awaiting results' }
  | { kind: 'result'; href: string; label: 'View result' }
  | { kind: 'none'; reason: string };

export function bucketOf(card: CandidateExamCard): ExamBucket {
  const status = card.attempt?.status;
  if (status === 'submitted') return 'completed';
  if (status === 'in_progress' || status === 'awaiting_sync') return 'available';
  if (card.phase === 'scheduled' || card.phase === 'draft') return 'upcoming';
  if (card.phase === 'ongoing') return 'available';
  return 'completed';
}

export function actionOf(card: CandidateExamCard): ExamAction {
  const attempt = card.attempt;
  if (attempt?.status === 'submitted') {
    return card.resultsStatus === 'published'
      ? { kind: 'result', href: `/results/${attempt.id}`, label: 'View result' }
      : { kind: 'awaiting', href: `/attempt/${attempt.id}`, label: 'Awaiting results' };
  }
  if (attempt) return { kind: 'resume', href: `/attempt/${attempt.id}`, label: 'Resume' };
  if (card.canStart) return { kind: 'start', href: `/take/${card.examId}`, label: 'Start' };
  if (card.phase === 'scheduled') return { kind: 'details', href: `/take/${card.examId}`, label: 'View details' };
  return { kind: 'none', reason: card.blockedReason ?? (card.phase === 'completed' ? 'Not attempted' : 'Not available') };
}

/** Extra time from accommodations, in minutes (0 when none). */
export function extraMinutes(card: Pick<CandidateExamCard, 'timeLimitMinutes' | 'durationMinutes'>): number {
  return Math.max(0, Math.round(card.timeLimitMinutes - card.durationMinutes));
}
