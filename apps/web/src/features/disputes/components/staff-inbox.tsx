'use client';

import { Inbox as InboxIcon, Scale, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useInbox } from '../api';
import { CATEGORY_COPY, plural } from '../format';
import type { DisputeCategory, InboxFilters, InboxRow } from '../types';
import { OutcomeBadge, SlaText, StatusBadge } from './primitives';

type View = 'active' | 'mine' | 'overdue' | 'decided' | 'all';
const ALL = '__all__';

function filtersFor(view: View, examId: string | undefined, category: DisputeCategory | undefined): InboxFilters {
  const base = { examId, category };
  switch (view) {
    case 'mine':
      return { ...base, status: 'active', assignedToMe: true };
    case 'overdue':
      return { ...base, status: 'active', overdue: true };
    case 'decided':
      return { ...base, status: 'resolved' };
    case 'all':
      return { ...base, status: 'all' };
    default:
      return { ...base, status: 'active' };
  }
}

/** Disputes as a scannable table: what is due first, about what, and who has it. */
export function DisputeTable({ rows, showExam, empty }: { rows: InboxRow[]; showExam: boolean; empty: ReactNode }) {
  const cols = showExam ? 7 : 6;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Candidate</TableHead>
          {showExam && <TableHead>Exam</TableHead>}
          <TableHead>Question</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Response due</TableHead>
          <TableHead>Reviewer</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={cols}>{empty}</TableEmpty>
        ) : (
          rows.map((r) => (
            <TableRow key={r.id} interactive className="relative">
              <TableCell className="max-w-72">
                <Link
                  href={`/disputes/${r.id}`}
                  className="font-semibold text-label outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-lg focus-visible:after:outline-[length:var(--focus-width)] focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                >
                  {r.candidate.label}
                </Link>
                <p className="mt-0.5 line-clamp-1 text-footnote text-label-secondary">{r.excerpt}</p>
              </TableCell>
              {showExam && (
                <TableCell className="whitespace-nowrap text-subheadline text-label-secondary">
                  {r.exam.code}
                </TableCell>
              )}
              <TableCell className="max-w-56">
                {r.question ? (
                  <span className="line-clamp-1 text-subheadline">
                    <span className="font-semibold">{r.question.label}</span> <span className="text-label-secondary">{r.question.title}</span>
                  </span>
                ) : (
                  <span className="text-subheadline text-label-tertiary">Whole attempt</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-subheadline">
                <span className="flex flex-col">
                  {CATEGORY_COPY[r.category].staffLabel}
                  {r.isAppeal && <span className="text-footnote text-label-secondary">Appeal</span>}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {r.outcome && r.outcomeLabel && r.status === 'resolved' ? <OutcomeBadge outcome={r.outcome} label={r.outcomeLabel} size="sm" /> : <StatusBadge status={r.status} label={r.statusLabel} size="sm" />}
              </TableCell>
              <TableCell className="whitespace-nowrap text-subheadline tabular-nums">
                <SlaText status={r.status} dueAt={r.dueAt} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-subheadline">
                <span className={cn('inline-flex items-center gap-1.5', !r.assignee && 'text-label-tertiary')}>
                  {r.assignee ? (r.assignee.isMe ? 'You' : r.assignee.name) : 'Unassigned'}
                  {r.conflict && (
                    <Tooltip content="You can’t decide this one: you graded the answer or decided the original">
                      <span className="relative z-10 inline-flex text-warning-text">
                        <ShieldAlert aria-label="Conflict of interest" className="size-3.5" />
                      </span>
                    </Tooltip>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

/** A segment label with its count set apart in a quieter tone. */
function Counted({ label, n }: { label: string; n: number | undefined }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {label}
      {n !== undefined && <span className="tabular-nums text-label-secondary">{n}</span>}
    </span>
  );
}

export function StaffInbox() {
  const [view, setView] = useState<View>('active');
  const [examId, setExamId] = useState<string | undefined>();
  const [category, setCategory] = useState<DisputeCategory | undefined>();
  const { data, isPending, error, refetch, isFetching } = useInbox(filtersFor(view, examId, category));
  const counts = data?.counts;

  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle={
          counts
            ? counts.active
              ? `${plural(counts.active, 'dispute')} waiting for a decision${counts.overdue ? `, ${counts.overdue} past the five-day deadline` : ''}${counts.unassigned ? `. ${counts.unassigned} unassigned` : ''}.`
              : 'Nothing is waiting for a decision.'
            : 'Candidates’ requests to review a mark or a question, with the evidence frozen at the time.'
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl<View>
          aria-label="Which disputes"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'active', label: <Counted label="Open" n={counts?.active} /> },
            { value: 'mine', label: <Counted label="Mine" n={counts?.mine} /> },
            { value: 'overdue', label: <Counted label="Overdue" n={counts?.overdue} /> },
            { value: 'decided', label: 'Decided' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Exam"
            size="sm"
            className="min-w-48"
            value={examId ?? ALL}
            onValueChange={(v) => setExamId(v === ALL ? undefined : v)}
            options={[{ value: ALL, label: 'All exams' }, ...(data?.exams ?? []).map((e) => ({ value: e.id, label: e.title, description: `${e.code}, ${plural(e.total, 'dispute')}` }))]}
          />
          <Select
            aria-label="Kind"
            size="sm"
            className="min-w-44"
            value={category ?? ALL}
            onValueChange={(v) => setCategory(v === ALL ? undefined : (v as DisputeCategory))}
            options={[{ value: ALL, label: 'All kinds' }, ...(Object.keys(CATEGORY_COPY) as DisputeCategory[]).map((c) => ({ value: c, label: CATEGORY_COPY[c].staffLabel }))]}
          />
        </div>
      </div>
      {isPending ? (
        <SkeletonRows rows={5} />
      ) : error ? (
        <EmptyState
          icon={<InboxIcon />}
          title="Couldn’t load disputes"
          description={errorMessage(error)}
          action={
            <Button variant="tinted" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className={cn('transition-opacity', isFetching && 'opacity-70')}>
          <DisputeTable
            rows={data.items}
            showExam={!examId}
            empty={
              <EmptyState
                surface={false}
                size="sm"
                icon={<Scale />}
                title={view === 'mine' ? 'Nothing assigned to you' : view === 'overdue' ? 'Nothing overdue' : view === 'decided' ? 'No decisions yet' : 'No open disputes'}
                description="Disputes arrive with the candidate’s answer, the marks and the rubric frozen at the moment they raised it."
              />
            }
          />
          {data.items.some((r) => r.conflict) && (
            <p className="mt-3 flex items-center gap-1.5 text-footnote text-label-secondary">
              <Badge tone="warning" size="sm">
                <ShieldAlert aria-hidden /> Conflict
              </Badge>
              You graded these answers or decided the original, so a colleague decides them.
            </p>
          )}
        </div>
      )}
    </>
  );
}
