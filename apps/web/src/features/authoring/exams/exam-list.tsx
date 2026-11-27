'use client';

import { EXAM_PHASE_LABEL, type ExamPhase } from '@athena/shared';
import { CalendarClock, ClipboardCheck, Plus, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useState, ViewTransition } from 'react';
import { PhaseBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination, usePageParam, usePageSizeParam } from '@/components/ui/pagination';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchField } from '@/features/admin/components/search-field';
import { Can, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useExams } from '../api';
import { LoadError } from '../components/load-error';
import { formatMinutes, formatWindow, relativeTo } from '../lib/datetime';
import { formatMarks } from '../lib/format';
import type { ExamListItem, NextActionKey } from '../types';

type PhaseFilter = ExamPhase | 'all';
const FILTERS: PhaseFilter[] = ['all', 'ongoing', 'scheduled', 'draft', 'completed', 'archived'];

/** Where each "next step" the API suggests takes you. */
export function nextActionHref(examId: string, key: NextActionKey): string {
  const base = `/exams/${examId}`;
  switch (key) {
    case 'add_questions':
      return `${base}/questions`;
    case 'enroll':
      return `${base}/candidates`;
    case 'monitor':
      return `${base}/monitor`;
    case 'grade':
      return `${base}/grading`;
    case 'publish_results':
      return `${base}/results`;
    case 'analytics':
      return `${base}/analytics`;
    default:
      return base;
  }
}

export function ExamList() {
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState<PhaseFilter>('all');
  const [page, setPage] = usePageParam();
  const pageSize = usePageSizeParam(30);
  const query = useExams({ q: q || undefined, phase: phase === 'all' ? undefined : phase, page, pageSize });
  const data = query.data;
  const counts = data?.phaseCounts;
  const filtered = !!q || phase !== 'all';

  return (
    <>
      <PageHeader
        title="Exams"
        subtitle="Every exam you author, proctor or grade, with what each one needs next."
        actions={
          <Can permission="exams.create">
            <Button asChild variant="filled">
              <Link href="/exams/new">
                <Plus aria-hidden /> New exam
              </Link>
            </Button>
          </Can>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 overflow-x-auto px-1 pb-1 scrollbar-none">
          <SegmentedControl<PhaseFilter>
            aria-label="Filter by phase"
            value={phase}
            onValueChange={(v) => {
              setPhase(v);
              setPage(1);
            }}
            options={FILTERS.map((f) => ({
              value: f,
              label: (
                <>
                  {f === 'all' ? 'All' : EXAM_PHASE_LABEL[f]}
                  {counts && f !== 'all' && counts[f] > 0 && <span className="tabular-nums text-label-tertiary">{counts[f]}</span>}
                </>
              ),
            }))}
          />
        </div>
        <SearchField
          label="Search exams"
          placeholder="Search by title or code"
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          className="lg:w-72"
        />
      </div>

      {query.isError ? (
        <LoadError error={query.error} what="list" onRetry={() => void query.refetch()} />
      ) : !data ? (
        <ExamListSkeleton />
      ) : data.total === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchX />}
            title="No exams match"
            description={phase === 'archived' ? 'Archived exams appear here once you archive one.' : 'Try another phase, or search by the exam code.'}
            action={
              <Button
                variant="gray"
                onClick={() => {
                  setQ('');
                  setPhase('all');
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<ClipboardCheck />}
            title="No exams yet"
            description="Create an exam, add questions from the bank, enroll candidates, then review and publish it. Candidates see it when its window opens."
            action={
              <Can permission="exams.create">
                <Button asChild variant="filled">
                  <Link href="/exams/new">New exam</Link>
                </Button>
              </Can>
            }
          />
        )
      ) : (
        <>
          <ul className={cn('flex flex-col overflow-hidden rounded-xl bg-surface shadow-xs transition-opacity', query.isPlaceholderData && 'opacity-60')}>
            {data.items.map((exam, i) => (
              <ExamRow key={exam.id} exam={exam} first={i === 0} />
            ))}
          </ul>
          <Pagination className="mt-4" label="Exam pages" page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        </>
      )}
    </>
  );
}

function ExamRow({ exam, first }: { exam: ExamListItem; first: boolean }) {
  const { can } = useAuth();
  const live = exam.phase === 'ongoing';
  const mismatch = exam.status === 'draft' && exam.counts.questions > 0 && exam.computedTotal !== exam.totalMarks;
  const action = exam.nextAction;
  return (
    <li className={cn('relative', !first && 'border-t border-separator')}>
      <div className="flex flex-col gap-3 px-4 py-4 transition-colors duration-100 hover:bg-fill-secondary sm:flex-row sm:items-center sm:gap-6 sm:px-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/exams/${exam.id}`}
              className="min-w-0 truncate text-headline text-label after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent"
            >
              <ViewTransition name={`exam-title-${exam.id}`} share="morph" default="none">
                <span>{exam.title}</span>
              </ViewTransition>
            </Link>
            {exam.code && <span className="text-footnote font-medium tracking-wide text-label-tertiary">{exam.code}</span>}
            <PhaseBadge phase={exam.phase} size="sm" />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote text-label-secondary">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock aria-hidden className="size-3.5 text-label-tertiary" />
              <time dateTime={exam.windowOpensAt}>{formatWindow(exam.windowOpensAt, exam.windowClosesAt)}</time>
            </span>
            <span>{formatMinutes(exam.durationMinutes)}</span>
            {exam.phase === 'scheduled' && <span>Opens {relativeTo(exam.windowOpensAt)}</span>}
            {live && <span className="text-success-text">Closes {relativeTo(exam.windowClosesAt)}</span>}
          </p>
        </div>

        <dl className="flex shrink-0 gap-5 text-footnote sm:gap-6">
          <Stat label="Questions" value={exam.counts.questions} />
          <Stat label="Marks" value={formatMarks(exam.totalMarks)} warn={mismatch ? `Questions add up to ${formatMarks(exam.computedTotal)}` : undefined} />
          <Stat label="Enrolled" value={exam.counts.enrolled} />
          {(live || exam.phase === 'completed') && (
            <Stat label={live ? 'Writing' : 'Submitted'} value={live ? exam.counts.inProgress : exam.counts.submitted} />
          )}
        </dl>

        <div className="relative z-[1] flex shrink-0 sm:w-44 sm:justify-end">
          {action && (action.key !== 'add_questions' || can('exams.manage') || can('exams.create')) ? (
            <Button asChild variant={action.key === 'monitor' || action.key === 'review_publish' ? 'tinted' : 'gray'} size="sm">
              <Link href={nextActionHref(exam.id, action.key)}>
{action.label}</Link>
            </Button>
          ) : (
            <span className="text-footnote text-label-tertiary">{exam.myRole ? roleLabel(exam.myRole) : ''}</span>
          )}
        </div>
      </div>
    </li>
  );
}

const ROLE_LABEL = { owner: 'Owner', co_examiner: 'Co-examiner', grader: 'Grader', proctor: 'Proctor' } as const;
export const roleLabel = (r: keyof typeof ROLE_LABEL) => ROLE_LABEL[r];

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: string }) {
  return (
    <div className="flex min-w-12 flex-col">
      <dt className="text-caption text-label-tertiary">{label}</dt>
      <dd className={cn('text-callout font-medium tabular-nums', warn ? 'text-warning-text' : 'text-label')} title={warn}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        {warn && <span className="sr-only">. {warn}</span>}
      </dd>
    </div>
  );
}

function ExamListSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-surface shadow-xs" aria-busy aria-label="Loading exams">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={cn('flex items-center gap-6 px-5 py-4', i > 0 && 'border-t border-separator')}>
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
          <Skeleton className="hidden h-8 w-48 sm:block" />
          <Skeleton className="hidden h-7 w-32 sm:block" />
        </div>
      ))}
    </div>
  );
}
