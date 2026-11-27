'use client';

import type { CandidateExamCard } from '@athena/shared';
import { CalendarClock, CircleCheck, Clock3, PlayCircle, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { givenName } from '@/components/ui/avatar';
import { Badge, PhaseBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { GroupedList, GroupedListItem } from '@/components/ui/grouped-list';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useCandidateExams, useServerNow } from './api';
import { actionOf, bucketOf, extraMinutes } from './exam-status';
import { formatCountdown, formatMinutes, formatWhen, plural } from './format';
import { Meta } from '@/features/workspace/components/meta';

function greeting(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function CandidateHome() {
  const { me } = useAuth();
  const exams = useCandidateExams();
  const now = useServerNow(1_000);

  const groups = useMemo(() => {
    const out = { available: [] as CandidateExamCard[], upcoming: [] as CandidateExamCard[], completed: [] as CandidateExamCard[] };
    for (const card of exams.data ?? []) out[bucketOf(card)].push(card);
    out.available.sort((a, b) => Number(!!b.attempt) - Number(!!a.attempt) || Date.parse(a.windowClosesAt) - Date.parse(b.windowClosesAt));
    out.upcoming.sort((a, b) => Date.parse(a.windowOpensAt) - Date.parse(b.windowOpensAt));
    out.completed.sort(
      (a, b) => Date.parse(b.attempt?.submittedAt ?? b.windowClosesAt) - Date.parse(a.attempt?.submittedAt ?? a.windowClosesAt),
    );
    return out;
  }, [exams.data]);

  const name = givenName(me?.user.name);
  const subtitle = (() => {
    if (!exams.data) return 'Everything assigned to you, in one place.';
    const live = groups.available.length;
    if (live === 1) return 'One exam is open for you now.';
    if (live > 1) return `${live} exams are open for you now.`;
    const next = groups.upcoming[0];
    if (next) return `Your next exam, ${next.title}, opens ${formatWhen(next.windowOpensAt, now)}.`;
    return 'Nothing is scheduled for you right now.';
  })();

  return (
    <>
      <PageHeader title="My exams" subtitle={`${greeting(new Date(now).getHours())}${name ? `, ${name}` : ''}. ${subtitle}`} />

      {exams.isError && !exams.data ? (
        <EmptyState
          icon={<WifiOff />}
          title="Your exams didn’t load"
          description={errorMessage(exams.error)}
          action={
            <Button variant="filled" onClick={() => void exams.refetch()} loading={exams.isFetching}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          <Section title="Available now">
            {exams.isPending ? (
              <LiveCardSkeleton />
            ) : groups.available.length ? (
              <div className="flex flex-col gap-4">
                {groups.available.map((card) => (
                  <LiveExamCard key={card.examId} card={card} now={now} />
                ))}
              </div>
            ) : (
              <EmptyState
                size="sm"
                icon={<PlayCircle />}
                title="Nothing to take right now"
                description={
                  groups.upcoming[0]
                    ? `${groups.upcoming[0].title} opens ${formatWhen(groups.upcoming[0].windowOpensAt, now)}. It appears here with a Start button when its window opens.`
                    : 'When an exam window opens, it appears here with a Start button.'
                }
              />
            )}
          </Section>

          <Section title="Upcoming" description={groups.upcoming.length ? 'Open one to read its instructions and check your device ahead of time.' : undefined}>
            {exams.isPending ? (
              <RowsSkeleton />
            ) : groups.upcoming.length ? (
              <GroupedList>
                {groups.upcoming.map((card) => (
                  <GroupedListItem
                    key={card.examId}
                    href={`/take/${card.examId}`}
                    title={card.title}
                    description={<Meta items={[card.code, `Opens ${formatWhen(card.windowOpensAt, now)}`, formatMinutes(card.timeLimitMinutes), plural(card.totalMarks, 'mark')]} />}
                    value={<span data-numeric>in {formatCountdown(Date.parse(card.windowOpensAt) - now)}</span>}
                  />
                ))}
              </GroupedList>
            ) : (
              <EmptyState size="sm" icon={<CalendarClock />} title="No upcoming exams" description="Scheduled exams appear here with a countdown to when they open." />
            )}
          </Section>

          <Section title="Completed">
            {exams.isPending ? (
              <RowsSkeleton />
            ) : groups.completed.length ? (
              <GroupedList>
                {groups.completed.map((card) => (
                  <CompletedRow key={card.examId} card={card} now={now} />
                ))}
              </GroupedList>
            ) : (
              <EmptyState
                size="sm"
                icon={<CircleCheck />}
                title="No completed exams yet"
                description="Submitted exams move here. You can open a result as soon as your examiner publishes it."
              />
            )}
          </Section>
        </div>
      )}
    </>
  );
}

function Fact({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-footnote text-label-secondary">{label}</dt>
      <dd className="text-headline text-label" data-numeric>
        {value}
      </dd>
      {hint && <dd className="text-footnote text-label-secondary">{hint}</dd>}
    </div>
  );
}

function LiveExamCard({ card, now }: { card: CandidateExamCard; now: number }) {
  const action = actionOf(card);
  const extra = extraMinutes(card);
  const attempt = card.attempt;
  const inProgress = attempt?.status === 'in_progress' || attempt?.status === 'awaiting_sync';
  const leftMs = attempt ? Date.parse(attempt.deadlineAt) - now : 0;
  const closesIn = Date.parse(card.windowClosesAt) - now;

  return (
    <Card padding="lg" className="flex flex-col gap-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-title-2 text-label">{card.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-subheadline text-label-secondary">
            <PhaseBadge phase={card.phase} />
            {inProgress && (
              <Badge tone="accent" dot>
                In progress
              </Badge>
            )}
            <Meta items={[card.code, card.organizationName]} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
          {action.kind === 'start' || action.kind === 'resume' ? (
            <Button asChild variant="filled" size="lg" className="sm:min-w-36">
              <Link href={action.href}>
                {action.label}
              </Link>
            </Button>
          ) : action.kind === 'none' ? (
            <p className="max-w-64 text-subheadline text-label-secondary sm:text-right">{action.reason}</p>
          ) : (
            <Button asChild variant="tinted" size="lg">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          )}
          {inProgress && leftMs > 0 && (
            <p className="flex items-center gap-1.5 text-footnote text-label-secondary sm:justify-end" data-numeric>
              <Clock3 aria-hidden className="size-3.5" />
              {formatCountdown(leftMs)} left, and your answers are saved
            </p>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 sm:grid-cols-4">
        <Fact
          label="Time limit"
          value={formatMinutes(card.timeLimitMinutes)}
          hint={extra > 0 ? `Includes ${formatMinutes(extra)} extra time` : 'Starts when you begin'}
        />
        <Fact label="Questions" value={card.questionCount} />
        <Fact label="Marks" value={card.totalMarks} />
        <Fact
          label="Window closes"
          value={formatWhen(card.windowClosesAt, now).replace(/^today at /, '')}
          hint={closesIn > 0 ? `in ${formatCountdown(closesIn)}` : 'Closed'}
        />
      </dl>
    </Card>
  );
}

function CompletedRow({ card, now }: { card: CandidateExamCard; now: number }) {
  const action = actionOf(card);
  const submittedAt = card.attempt?.submittedAt;
  const description = <Meta items={[card.code, submittedAt ? `Submitted ${formatWhen(submittedAt, now)}` : `Closed ${formatWhen(card.windowClosesAt, now)}`]} />;
  const badge =
    action.kind === 'result' ? (
      <Badge tone="success">Result published</Badge>
    ) : action.kind === 'awaiting' ? (
      <Badge tone="neutral">Awaiting results</Badge>
    ) : (
      <Badge tone="neutral">{action.kind === 'none' ? action.reason : 'Closed'}</Badge>
    );
  if (action.kind === 'result' || action.kind === 'awaiting') {
    return <GroupedListItem href={action.href} title={card.title} description={description} accessory={badge} />;
  }
  return <GroupedListItem title={card.title} description={description} accessory={badge} />;
}

function LiveCardSkeleton() {
  return (
    <div role="status" aria-label="Loading your exams" className="rounded-xl bg-surface p-6 sm:p-7">
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="mt-3 h-6 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/3" />
      <div className={cn('mt-6 grid grid-cols-2 gap-4 border-t pt-5 sm:grid-cols-4')}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div aria-hidden className="overflow-hidden rounded-xl bg-surface">
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
