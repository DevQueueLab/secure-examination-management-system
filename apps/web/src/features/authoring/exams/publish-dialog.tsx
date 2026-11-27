'use client';

import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { SkeletonRows } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useExamLifecycle, useExamReview } from '../api';
import { formatWhen } from '../lib/datetime';
import { formatMarks, plural } from '../lib/format';
import { fixLabel, useApplyFix } from '../lib/use-apply-fix';
import type { ExamDetail, ReviewIssue } from '../types';

/** Where the author goes to fix an issue the review can't fix by itself. */
export function issueHref(examId: string, issue: Pick<ReviewIssue, 'code' | 'field'>): string {
  const base = `/exams/${examId}`;
  if (issue.code === 'missing_rubric') return `${base}/grading?tab=rubrics`;
  if (issue.code === 'no_candidates') return `${base}/candidates`;
  if (['invalid_timing', 'window_closed', 'opens_in_past'].includes(issue.code) || issue.field.startsWith('window') || issue.field === 'durationMinutes') return `${base}/settings`;
  return `${base}/questions`;
}

export function IssueRow({ examId, issue, onNavigate }: { examId: string; issue: ReviewIssue; onNavigate?: () => void }) {
  const applyFix = useApplyFix(examId);
  const error = issue.severity === 'error';
  return (
    <li className="flex items-start gap-3 py-3">
      {error ? (
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-text" />
      ) : (
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
      )}
      <p className="min-w-0 flex-1 text-callout text-label">
        <span className="sr-only">{error ? 'Blocking: ' : 'Warning: '}</span>
        {issue.message}
      </p>
      {issue.fix ? (
        <Button variant="tinted" size="sm" loading={applyFix.isPending} onClick={() => applyFix.mutate(issue.fix!)}>
          {fixLabel(issue.fix)}
        </Button>
      ) : (
        <Button asChild variant="plain" size="sm">
          <Link href={issueHref(examId, issue)} onClick={onNavigate}>
            {issue.code === 'missing_rubric' ? 'Rubrics' : 'Open'}
          </Link>
        </Button>
      )}
    </li>
  );
}

/**
 * "Review and publish": the same review the API runs on publish, so what this dialog says is exactly what the
 * server will accept. Blocking problems disable Publish; warnings are listed but don't stop it.
 */
export function PublishDialog({ exam, open, onOpenChange }: { exam: ExamDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const review = useExamReview(exam.id, open);
  const lifecycle = useExamLifecycle(exam.id);
  const data = review.data ?? exam.review;
  const errors = data.errors;
  const warnings = data.warnings;

  const publish = () =>
    lifecycle.mutate('publish', {
      onSuccess: (next) => {
        toast.success(next.phase === 'ongoing' ? 'Published. The window is open now.' : `Published. Opens ${formatWhen(next.windowOpensAt)}.`);
        onOpenChange(false);
      },
      onError: (e) => {
        void review.refetch();
        toast.error(isApiError(e) && e.code === 'EXAM_NOT_READY' ? 'The review found something new. Check the list.' : errorMessage(e));
      },
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title="Review and publish"
          description={
            errors.length
              ? `${plural(errors.length, 'problem')} must be fixed before candidates can see this exam.`
              : 'Publishing schedules the exam. Enrolled candidates see it on their dashboard and can start when the window opens.'
          }
        />
        <DialogBody className="flex flex-col gap-5">
          {review.isLoading && !review.data ? (
            <SkeletonRows rows={3} />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-separator sm:grid-cols-4">
                {[
                  { label: 'Questions per paper', value: data.paper.deliveredCount },
                  { label: 'Paper total', value: formatMarks(data.paper.computedTotal), bad: data.paper.computedTotal !== data.paper.declaredTotal },
                  { label: 'Declared total', value: formatMarks(data.paper.declaredTotal) },
                  { label: 'Enrolled', value: exam.counts.enrolled },
                ].map((s) => (
                  <div key={s.label} className="flex flex-col gap-0.5 bg-surface-sunken px-3 py-2.5">
                    <dt className="text-caption text-label-secondary">{s.label}</dt>
                    <dd className={cn('text-headline tabular-nums', s.bad ? 'text-danger-text' : 'text-label')}>{s.value}</dd>
                  </div>
                ))}
              </dl>

              {errors.length === 0 && (
                <p className="flex items-center gap-2 text-callout font-medium text-success-text">
                  <CircleCheck aria-hidden className="size-4" /> Ready to publish
                </p>
              )}

              {errors.length > 0 && (
                <section className="flex flex-col">
                  <h3 className="text-footnote font-medium text-label-secondary">Must fix</h3>
                  <ul className="divide-y divide-separator">
                    {errors.map((issue, i) => (
                      <IssueRow key={`${issue.code}-${i}`} examId={exam.id} issue={issue} onNavigate={() => onOpenChange(false)} />
                    ))}
                  </ul>
                </section>
              )}

              {warnings.length > 0 && (
                <section className="flex flex-col">
                  <h3 className="text-footnote font-medium text-label-secondary">Worth a look</h3>
                  <ul className="divide-y divide-separator">
                    {warnings.map((issue, i) => (
                      <IssueRow key={`${issue.code}-${i}`} examId={exam.id} issue={issue} onNavigate={() => onOpenChange(false)} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="gray" onClick={() => onOpenChange(false)}>
            {errors.length ? 'Close' : 'Not yet'}
          </Button>
          <Button variant="filled" disabled={errors.length > 0 || review.isFetching} loading={lifecycle.isPending} onClick={publish}>
            {errors.length ? `Fix ${plural(errors.length, 'problem')} to publish` : 'Publish exam'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
