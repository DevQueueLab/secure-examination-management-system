'use client';

import { MessageSquareWarning, Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { SkeletonRows } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { useMyDisputes } from '../api';
import { fmtDate, isActive } from '../format';
import type { EligibleAttempt, MyDisputeRow } from '../types';
import { OutcomeBadge, ScoreChange, SlaBadge, StatusBadge } from './primitives';

function DisputeRow({ d }: { d: MyDisputeRow }) {
  const title = d.item ? `Question ${d.item.number}: ${d.item.title}` : d.categoryLabel;
  const moved = d.scoreBefore !== null && d.scoreAfter !== null && d.scoreBefore !== d.scoreAfter;
  return (
    <li>
      <Link
        href={`/my-disputes/${d.id}`}
        className="flex flex-col gap-3 px-4 py-3.5 outline-none transition-colors hover:bg-fill-secondary focus-visible:outline-[length:var(--focus-width)] focus-visible:-outline-offset-2 focus-visible:outline-focus sm:flex-row sm:items-center sm:gap-6"
      >
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-callout font-semibold text-label">{title}</span>
            {d.isAppeal && <span className="text-footnote font-medium text-label-secondary">Appeal</span>}
          </p>
          <p className="mt-0.5 text-footnote text-label-secondary">
            {d.categoryLabel} on {d.exam.title}, raised {fmtDate(d.createdAt)}
          </p>
          <p className="mt-1 line-clamp-1 text-subheadline text-label-secondary">{d.excerpt}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {d.outcome && d.outcomeLabel && !d.withdrawn ? <OutcomeBadge outcome={d.outcome} label={d.outcomeLabel} size="sm" /> : <StatusBadge status={d.status} label={d.statusLabel} size="sm" />}
          {isActive(d.status) && <SlaBadge status={d.status} dueAt={d.dueAt} size="sm" />}
          {moved && <ScoreChange before={d.scoreBefore} after={d.scoreAfter} max={d.maxScore} size="sm" />}
        </div>
      </Link>
    </li>
  );
}

function AttemptRow({ a }: { a: EligibleAttempt }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-callout font-semibold text-label">{a.exam.title}</p>
        <p className="mt-0.5 text-footnote text-label-secondary">
          {a.canRaise
            ? a.closesAt
              ? `${a.exam.code}. You can raise disputes until ${fmtDate(a.closesAt)}.`
              : a.exam.code
            : (a.message ?? 'Disputes are closed for this exam')}
        </p>
      </div>
      {a.canRaise && (
        <Button asChild variant="tinted" size="sm">
          <Link href={`/my-disputes/new?attemptId=${a.attemptId}`}>
            <Plus aria-hidden /> Raise a dispute
          </Link>
        </Button>
      )}
    </li>
  );
}

export function MyDisputesView() {
  const { data, isPending, error, refetch } = useMyDisputes();
  const items = data?.items ?? [];
  const open = items.filter((d) => isActive(d.status));
  const done = items.filter((d) => !isActive(d.status));
  const eligible = (data?.attempts ?? []).filter((a) => a.canRaise || a.message);

  return (
    <>
      <PageHeader
        title="My disputes"
        subtitle="Ask for a second look at a mark or a question. Every decision comes with a written reason, and any change to your marks is recorded in the grade ledger."
      />
      {isPending ? (
        <SkeletonRows rows={4} />
      ) : error ? (
        <EmptyState
          icon={<MessageSquareWarning />}
          title="Couldn’t load your disputes"
          description={errorMessage(error)}
          action={
            <Button variant="tinted" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {open.length > 0 && (
            <Section title="In progress" description="The exam team replies within five days. You’ll get a notification when anything changes.">
              <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
                {open.map((d) => (
                  <DisputeRow key={d.id} d={d} />
                ))}
              </ul>
            </Section>
          )}
          {eligible.length > 0 && (
            <Section title="Raise a dispute" description="From the day results are published. Technical problems during an exam can be raised as soon as you submit.">
              <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
                {eligible.map((a) => (
                  <AttemptRow key={a.attemptId} a={a} />
                ))}
              </ul>
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Decided and closed">
              <ul className="divide-y divide-separator overflow-hidden rounded-xl bg-surface">
                {done.map((d) => (
                  <DisputeRow key={d.id} d={d} />
                ))}
              </ul>
            </Section>
          )}
          {items.length === 0 && eligible.length === 0 && (
            <EmptyState
              icon={<MessageSquareWarning />}
              title="No disputes"
              description="If something in a published result looks wrong, open the result and choose Raise a dispute about this question."
              action={
                <Button asChild variant="gray">
                  <Link href="/results">View results</Link>
                </Button>
              }
            />
          )}
        </div>
      )}
    </>
  );
}
