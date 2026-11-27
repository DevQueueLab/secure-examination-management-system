'use client';

import type { CandidateExamCard } from '@athena/shared';
import { CalendarClock, CircleCheck, PlayCircle, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { givenName } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCandidateExams, useServerNow } from './api';
import { actionOf, bucketOf, extraMinutes } from './exam-status';
import { formatCountdown, formatMinutes, formatWhen, plural } from './format';
import { Seal } from './seal';
import { Duration, TimeRule } from './time-rule';
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
                  <AdmissionSlip key={card.examId} card={card} now={now} candidate={me?.user.name} />
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
              <Ledger>
                {groups.upcoming.map((card) => (
                  <LedgerRow
                    key={card.examId}
                    href={`/take/${card.examId}`}
                    title={card.title}
                    meta={<Meta items={[card.code, `Opens ${formatWhen(card.windowOpensAt, now)}`, formatMinutes(card.timeLimitMinutes), plural(card.totalMarks, 'mark')]} />}
                    end={<span className="tabular-nums">in {formatCountdown(Date.parse(card.windowOpensAt) - now)}</span>}
                  />
                ))}
              </Ledger>
            ) : (
              <EmptyState size="sm" icon={<CalendarClock />} title="No upcoming exams" description="Scheduled exams appear here with a countdown to when they open." />
            )}
          </Section>

          <Section title="Completed">
            {exams.isPending ? (
              <RowsSkeleton />
            ) : groups.completed.length ? (
              <Ledger>
                {groups.completed.map((card) => (
                  <CompletedRow key={card.examId} card={card} now={now} />
                ))}
              </Ledger>
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

/** One field of the slip: the figure first to the eye, the label first to a screen reader. */
function Figure({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 pl-4 first:pl-0 sm:pl-7">
      <dt className="order-2 text-footnote text-label-secondary">{label}</dt>
      <dd className="numeral order-1 whitespace-nowrap text-[2.25rem] leading-none text-label sm:text-[3.25rem]">{value}</dd>
      {hint && <dd className="order-3 text-footnote text-label-tertiary">{hint}</dd>}
    </div>
  );
}

/**
 * The admission slip for a sitting: the one raised sheet on the page. Title, who it admits, the paper's
 * limits as light numerals, the window on the Marks rule, and Start as the only filled action.
 */
function AdmissionSlip({ card, now, candidate }: { card: CandidateExamCard; now: number; candidate?: string }) {
  const action = actionOf(card);
  const extra = extraMinutes(card);
  const attempt = card.attempt;
  const inProgress = attempt?.status === 'in_progress' || attempt?.status === 'awaiting_sync';
  const titleId = `slip-${card.examId}`;

  return (
    <article
      aria-labelledby={titleId}
      className="rounded-2xl bg-surface-raised p-5 text-label shadow-[0_1px_2px_rgb(20_24_31/0.05),0_18px_40px_-22px_rgb(20_24_31/0.28)] dark:shadow-[inset_0_0.5px_0_rgb(255_255_255/0.09)] sm:p-8"
    >
      <div className="min-w-0">
          <h3
            id={titleId}
            className="text-balance text-[1.5rem] font-semibold leading-[1.18] tracking-[-0.02em] text-label sm:text-[2.25rem] sm:leading-[1.1] sm:tracking-[-0.026em]"
          >
            {card.title}
          </h3>
          <Meta
            className="mt-2.5 text-subheadline text-label-secondary"
            items={[
              card.code,
              card.organizationName,
              candidate ? (
                <>
                  Candidate <span className="font-medium text-label">{candidate}</span>
                </>
              ) : null,
            ]}
          />
      </div>

      <dl className="mt-6 grid grid-cols-3 divide-x divide-separator py-5 hairline-t hairline-b sm:mt-8 sm:py-6">
        <Figure label="Time limit" value={<Duration minutes={card.timeLimitMinutes} />} hint={extra > 0 ? `Includes ${formatMinutes(extra)} extra` : undefined} />
        <Figure label="Questions" value={card.questionCount} />
        <Figure label="Marks" value={card.totalMarks} />
      </dl>

      <div className="mt-5 flex flex-col gap-5 sm:mt-6 sm:flex-row sm:items-center sm:gap-10">
        <div className="min-w-0 flex-1">
          <TimeRule card={card} now={now} />
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {action.kind === 'start' || action.kind === 'resume' ? (
            <Button asChild variant="filled" size="lg" className="max-sm:h-12 sm:min-w-40">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : action.kind === 'none' ? (
            <p className="max-w-64 text-subheadline text-label-secondary sm:text-right">{action.reason}</p>
          ) : (
            <Button asChild variant="tinted" size="lg" className="max-sm:h-12">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          )}
          {inProgress && <p className="text-footnote text-label-secondary sm:text-right">In progress. Your answers are saved.</p>}
        </div>
      </div>
    </article>
  );
}

/** Edge-to-edge rows on the ground, separated by hairlines. */
function Ledger({ children }: { children: ReactNode }) {
  return <ul className="hairline-t">{children}</ul>;
}

function LedgerRow({ href, title, meta, end }: { href?: string; title: ReactNode; meta: ReactNode; end?: ReactNode }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body font-medium text-label">{title}</span>
        <span className="text-footnote text-label-secondary">{meta}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-subheadline text-label-secondary">{end}</span>
    </>
  );
  return (
    <li className="py-1 hairline-b">
      {href ? (
        <Link
          href={href}
          className="-mx-3 flex min-h-14 items-center gap-4 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-fill-secondary focus-visible:focus-ring active:bg-fill"
        >
          {body}
        </Link>
      ) : (
        <div className="flex min-h-14 items-center gap-4 py-2.5">{body}</div>
      )}
    </li>
  );
}

function CompletedRow({ card, now }: { card: CandidateExamCard; now: number }) {
  const action = actionOf(card);
  const submittedAt = card.attempt?.submittedAt;
  const meta = <Meta items={[card.code, submittedAt ? `Submitted ${formatWhen(submittedAt, now)}` : `Closed ${formatWhen(card.windowClosesAt, now)}`]} />;
  const end =
    action.kind === 'result' ? (
      <span className="inline-flex items-center gap-1.5 font-medium text-gold-text">
        <Seal className="size-[1.125rem]" />
        Result published
      </span>
    ) : action.kind === 'awaiting' ? (
      'Awaiting results'
    ) : action.kind === 'none' ? (
      action.reason
    ) : (
      'Closed'
    );
  const href = action.kind === 'result' || action.kind === 'awaiting' ? action.href : undefined;
  return <LedgerRow href={href} title={card.title} meta={meta} end={end} />;
}

function LiveCardSkeleton() {
  return (
    <div role="status" aria-label="Loading your exams" className="rounded-2xl bg-surface-raised p-5 sm:p-8">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="mt-3 h-4 w-1/3" />
      <div className="mt-8 grid grid-cols-3 gap-6 py-6 hairline-t hairline-b">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-10 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-6 h-6 w-full" />
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div aria-hidden className="hairline-t">
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex min-h-16 items-center gap-3 py-3 hairline-b">
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
