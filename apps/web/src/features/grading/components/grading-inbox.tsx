'use client';

import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { Badge, PhaseBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress';
import { Section } from '@/components/ui/section';
import { SkeletonRows } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { fmtRelative, plural } from '../../analytics/format';
import { Meta } from '../../analytics/components/meta';
import { useGradingInbox } from '../api';
import type { InboxExam } from '../types';

const ROLE: Record<string, string> = { owner: 'Owner', co_examiner: 'Co-examiner', grader: 'Grader' };

function ExamRow({ exam }: { exam: InboxExam }) {
  const done = exam.total > 0 && exam.remaining === 0;
  const status =
    exam.total === 0
      ? exam.inProgress
        ? `${plural(exam.inProgress, 'candidate')} still writing`
        : 'No submissions yet'
      : done
        ? `All ${exam.total} answers graded`
        : `${exam.remaining} of ${exam.total} answers to grade, in ${plural(exam.questionsOpen, 'question')}`;
  return (
    <li>
      <Link
        href={`/exams/${exam.examId}/grading`}
        className="group flex flex-col gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-fill-secondary focus-visible:outline-[length:var(--focus-width)] focus-visible:-outline-offset-2 focus-visible:outline-focus sm:flex-row sm:items-center sm:gap-6"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-callout font-semibold text-label">{exam.title}</span>
            <PhaseBadge phase={exam.phase} size="sm" />
            {exam.resultsStatus === 'published' && (
              <Badge tone="success" size="sm">
                Published
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-footnote text-label-secondary">
            <Meta items={[exam.code, exam.role ? ROLE[exam.role] ?? exam.role : null, exam.lastGradedAt ? `Last graded ${fmtRelative(exam.lastGradedAt)}` : null]} />
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex w-56 flex-col gap-1.5">
            <span className="text-footnote tabular-nums text-label-secondary">{status}</span>
            {exam.total > 0 && <ProgressBar size="sm" tone={done ? 'success' : 'accent'} value={exam.graded} max={exam.total} label={`${exam.title} grading progress`} valueText={`${exam.graded} of ${exam.total}`} />}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function GradingInbox() {
  const { data, isPending, error, refetch } = useGradingInbox();
  const exams = data ?? [];
  const waiting = exams.filter((e) => e.remaining > 0).sort((a, b) => b.remaining - a.remaining);
  const upcoming = exams.filter((e) => e.total === 0);
  const done = exams.filter((e) => e.total > 0 && e.remaining === 0);
  const remaining = waiting.reduce((s, e) => s + e.remaining, 0);

  return (
    <>
      <PageHeader
        title="Grading"
        subtitle={
          isPending || error
            ? 'Written answers waiting for a human grader, across the exams you grade.'
            : remaining
              ? `${plural(remaining, 'answer')} waiting across ${plural(waiting.length, 'exam')}.`
              : 'Nothing is waiting for you right now.'
        }
      />
      {isPending ? (
        <SkeletonRows rows={4} />
      ) : error ? (
        <EmptyState
          icon={<Inbox />}
          title="Couldn’t load your grading"
          description={errorMessage(error)}
          action={
            <Button variant="tinted" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : !exams.length ? (
        <EmptyState icon={<Inbox />} title="No exams to grade" description="Exams appear here when an examiner adds you as a grader. Answers arrive as candidates submit." />
      ) : (
        <div className="flex flex-col gap-8">
          {waiting.length > 0 && (
            <Section title="Waiting for you">
              <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
                {waiting.map((e) => (
                  <ExamRow key={e.examId} exam={e} />
                ))}
              </ul>
            </Section>
          )}
          {upcoming.length > 0 && (
            <Section title="No submissions yet">
              <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
                {upcoming.map((e) => (
                  <ExamRow key={e.examId} exam={e} />
                ))}
              </ul>
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Fully graded">
              <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
                {done.map((e) => (
                  <ExamRow key={e.examId} exam={e} />
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  );
}
