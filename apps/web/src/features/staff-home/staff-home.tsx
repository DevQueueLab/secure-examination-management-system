'use client';

import { WrittenText } from '@/components/ui/written-text';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { CalendarClock, Check, ClipboardPlus, FileUp, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ShellTitle } from '@/components/shell/shell-title';
import { givenName } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { MarksRule } from '@/components/ui/marks-rule';
import { Figure, numeral, SegmentRule } from '@/features/admin/components/instrument';
import { CountUp } from '@/components/ui/count-up';
import { ORG_TYPE_COPY, TenantTile } from '@/features/admin/components/pills';
import { TwinArt } from '@/features/admin/components/twin-art';
import { eventLabel, INDICATOR_NOTICE } from '@/features/monitoring/format';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { spring, useReducedMotion } from '@/lib/motion';
import { DayAtAGlance } from '@/features/admin/day-glance/day-at-a-glance';
import type { StaffDashboard } from './types';

const DASHBOARD_KEY = ['org', 'dashboard'] as const;

type LiveExam = StaffDashboard['live'][number];

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Re-renders on an interval so relative times stay true between refetches. */
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function until(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h ${mins % 60 ? `${mins % 60}m` : ''}`.trim();
  return `${Math.round(h / 24)} days`;
}

function ago(iso: string, now: number): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const dateTime = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const dayNum = new Intl.DateTimeFormat('en-GB', { day: 'numeric' });
const monthShort = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const n = new Intl.NumberFormat('en');

/** One sentence that says what needs attention, instead of a wall of numbers. */
function brief(d: StaffDashboard, now: number): string {
  const parts: string[] = [];
  if (d.live.length) {
    const writing = d.live.reduce((s, e) => s + e.inProgress, 0);
    parts.push(
      d.live.length === 1
        ? `${d.live[0]!.title} is live with ${n.format(writing)} writing`
        : `${d.live.length} exams are live with ${n.format(writing)} candidates writing`,
    );
  }
  if (d.grading?.pendingItems)
    parts.push(
      `${n.format(d.grading.pendingItems)} ${d.grading.pendingItems === 1 ? 'answer waits' : 'answers wait'} for grading`,
    );
  if (d.incidents?.unreviewed)
    parts.push(
      `${d.incidents.unreviewed} ${d.incidents.unreviewed === 1 ? 'incident needs' : 'incidents need'} a look`,
    );
  if (d.disputes?.open)
    parts.push(
      `${d.disputes.open} ${d.disputes.open === 1 ? 'dispute is' : 'disputes are'} open${d.disputes.overdue ? `, ${d.disputes.overdue} overdue` : ''}`,
    );
  if (parts.length === 0) {
    const next = d.upcoming[0];
    return next
      ? `Nothing needs you right now. Next up: ${next.title}, opening in ${until(next.opensAt, now)}.`
      : 'Nothing needs you right now.';
  }
  const last = parts.pop()!;
  return `${parts.length ? `${parts.join(', ')} and ${last}` : last}.`;
}

function cohort(exam: LiveExam) {
  const notStarted = Math.max(
    0,
    exam.enrolled - exam.inProgress - exam.awaitingSync - exam.submitted,
  );
  return {
    notStarted,
    label: `${exam.inProgress} writing, ${exam.submitted} submitted, ${exam.awaitingSync} syncing, ${notStarted} not started, of ${exam.enrolled} enrolled`,
    segments: [
      { key: 'writing', value: exam.inProgress, ink: 'carmine' as const },
      { key: 'submitted', value: exam.submitted, ink: 'graphite' as const },
      { key: 'sync', value: exam.awaitingSync, ink: 'wine' as const },
      { key: 'rest', value: notStarted, ink: 'rest' as const },
    ],
  };
}

/** The one exam that matters most right now, measured on the Marks rule. */
function LiveSheet({ exam, now }: { exam: LiveExam; now: number }) {
  const { notStarted, label, segments } = cohort(exam);
  const open = new Date(exam.opensAt).getTime();
  const close = new Date(exam.closesAt).getTime();
  const closingSoon = close - now < 30 * 60_000;
  return (
    <section
      aria-labelledby={`live-${exam.id}`}
      className="rounded-2xl border border-separator bg-surface p-5 sm:p-8"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id={`live-${exam.id}`}
            className="text-balance text-title-2 font-semibold tracking-[-0.02em] text-label sm:text-title-1"
          >
            {exam.title}
          </h2>
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-callout text-label-secondary">
            <span className="font-semibold text-accent-text">In progress</span>
            {exam.code && <span>{exam.code}</span>}
            <span>
              {n.format(exam.enrolled)} {exam.enrolled === 1 ? 'candidate' : 'candidates'}
            </span>
          </p>
        </div>
        <Button asChild variant="filled" size="lg" className="shrink-0 self-start">
          <Link href={`/exams/${exam.id}/monitor`}>Monitor exam</Link>
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-4 sm:gap-8">
        <Figure
          value={<CountUp value={exam.inProgress} delay={120} />}
          label="writing"
          ink="carmine"
        />
        <Figure
          value={<CountUp value={exam.submitted} delay={120} />}
          label="submitted"
          ink="graphite"
        />
        <Figure value={<CountUp value={notStarted} delay={120} />} label="not started" ink="rest" />
      </div>

      <SegmentRule
        className="mt-6"
        label={label}
        segments={segments}
        startLabel="0"
        endLabel={`${n.format(exam.enrolled)} enrolled`}
      />
      {exam.awaitingSync > 0 && (
        <p className="mt-3 flex items-center gap-2 text-footnote text-label-secondary">
          <span aria-hidden className="size-2 rounded-[2px] bg-data-4" />
          {n.format(exam.awaitingSync)} saved offline and syncing
        </p>
      )}

      <div className="mt-8 grid items-end gap-x-10 gap-y-4 border-t border-separator pt-6 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div>
          <p
            className={cn(
              numeral,
              'text-[2rem]/none',
              closingSoon ? 'text-accent-text' : 'text-label',
            )}
          >
            {until(exam.closesAt, now)}
          </p>
          <p className="mt-2 text-footnote text-label-secondary">until it closes</p>
        </div>
        <MarksRule
          label="Exam window"
          settle
          value={Math.min(Math.max(now, open), close)}
          min={open}
          max={close}
          marker="both"
          labels="ends"
          format={(v) => `${v === open ? 'Opened' : 'Closes'} ${dateTime.format(v)}`}
          valueText={`${until(exam.closesAt, now)} left`}
        />
      </div>
    </section>
  );
}

/** When nothing is open, the space the live exam would take says what comes next. */
function NothingLive({
  next,
  now,
  canCreate,
}: {
  next?: StaffDashboard['upcoming'][number];
  now: number;
  canCreate: boolean;
}) {
  return (
    <section
      aria-labelledby="nothing-live"
      className="flex flex-col items-start gap-6 border-y border-separator py-8 sm:flex-row sm:items-center sm:gap-8"
    >
      <TwinArt name={next ? 'owl' : 'helmet'} size={176} />
      <div className="min-w-0">
        <h2 id="nothing-live" className="text-title-2 font-semibold tracking-[-0.02em] text-label">
          {next ? 'No exam is open right now' : 'No exams on the calendar'}
        </h2>
        <p className="mt-2 max-w-[34rem] text-pretty text-callout text-label-secondary">
          {next
            ? `${next.title} opens ${dateTime.format(new Date(next.opensAt))}, in ${until(next.opensAt, now)}. When it opens, its cohort and clock take this space.`
            : canCreate
              ? 'Create an exam and schedule its window. While it runs, this space shows who is writing and how long is left.'
              : 'Exams you are staff on show here while they run, with who is writing and how long is left.'}
        </p>
        {next && (
          <Button asChild variant="gray" className="mt-5 max-sm:h-11">
            <Link href={`/exams/${next.id}`}>View exam</Link>
          </Button>
        )}
      </div>
    </section>
  );
}

function AlsoLive({ exams, now }: { exams: LiveExam[]; now: number }) {
  return (
    <section aria-labelledby="also-live">
      <h2 id="also-live" className="text-headline text-label">
        Also open
      </h2>
      <ul className="mt-2 divide-y divide-separator border-y border-separator">
        {exams.map((e) => {
          const { label, segments } = cohort(e);
          return (
            <li
              key={e.id}
              className="grid items-center gap-x-6 gap-y-3 py-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-label">{e.title}</p>
                <p className="text-footnote text-label-secondary">
                  {n.format(e.inProgress)} writing, closes in {until(e.closesAt, now)}
                </p>
              </div>
              <SegmentRule label={label} segments={segments} barClassName="h-2" />
              <Button asChild size="sm" variant="gray" className="justify-self-start max-sm:h-11">
                <Link href={`/exams/${e.id}/monitor`}>Monitor</Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Upcoming exams on a timeline: the day on the left, the rule down the middle. */
function Upcoming({
  items,
  now,
  canCreate,
  drafts,
}: {
  items: StaffDashboard['upcoming'];
  now: number;
  canCreate: boolean;
  drafts: number;
}) {
  return (
    <section aria-labelledby="upcoming-title">
      <div className="flex items-baseline justify-between gap-4 border-b border-separator pb-3">
        <h2 id="upcoming-title" className="text-title-3 font-semibold text-label">
          Upcoming
        </h2>
        <Link
          href="/exams"
          className="rounded-sm text-footnote font-medium text-accent-text hover:underline"
        >
          All exams
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="py-6">
          <p className="text-callout text-label-secondary">
            No exams scheduled.
            {canCreate
              ? ' Create one and it shows here until its window opens.'
              : ' Exams you are staff on appear here before they open.'}
          </p>
          {drafts > 0 && (
            <p className="mt-1 text-footnote text-label-tertiary">
              You have {drafts} {drafts === 1 ? 'draft' : 'drafts'} waiting to be scheduled.
            </p>
          )}
        </div>
      ) : (
        <ol className="relative">
          <span aria-hidden className="absolute inset-y-0 left-[4.25rem] w-px bg-separator" />
          {items.map((e) => {
            const when = new Date(e.opensAt);
            return (
              <li
                key={e.id}
                className="relative grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-6 py-4 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]"
              >
                <div className="text-right">
                  <p className="text-caption text-label-tertiary">{weekday.format(when)}</p>
                  <p className={cn(numeral, 'text-[1.75rem]/none text-label')}>
                    {dayNum.format(when)}
                  </p>
                  <p className="mt-0.5 text-caption text-label-tertiary">
                    {monthShort.format(when)}
                  </p>
                </div>
                <div className="relative min-w-0 pt-3">
                  <span
                    aria-hidden
                    className="absolute -left-3 top-[1.2rem] size-[7px] -translate-x-1/2 rounded-full border border-label-tertiary bg-bg"
                  />
                  <Link
                    href={`/exams/${e.id}`}
                    className="block truncate text-headline text-label hover:underline"
                  >
                    {e.title}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-footnote text-label-secondary">
                    <span>{clock.format(when)}</span>
                    <span>{e.durationMinutes} min</span>
                    <span>{n.format(e.enrolled)} enrolled</span>
                    <span className="sm:hidden">in {until(e.opensAt, now)}</span>
                  </p>
                </div>
                <p className="hidden pt-4 text-footnote tabular-nums text-label-tertiary sm:block">
                  in {until(e.opensAt, now)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Needs-you rows arrive from the inspector's edge, staggered, about 300 ms for the set. */
const ROW_IN = {
  hidden: { opacity: 0, x: 14 },
  show: { opacity: 1, x: 0, transition: spring.snappy },
} as const;

function NeedRow({
  count,
  label,
  detail,
  href,
  action,
  urgent,
  children,
}: {
  count: number;
  label: string;
  detail?: ReactNode;
  href: string;
  action: string;
  urgent?: boolean;
  children?: ReactNode;
}) {
  return (
    <motion.li variants={ROW_IN} className="group flex items-start gap-4 py-4">
      <p
        className={cn(
          numeral,
          'w-12 shrink-0 text-right text-[2.25rem]/none',
          count === 0 ? 'text-label-tertiary' : urgent ? 'text-accent-text' : 'text-label',
        )}
      >
        {n.format(count)}
      </p>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-callout font-medium text-label">{label}</p>
        {detail && <p className="mt-0.5 text-footnote text-label-secondary">{detail}</p>}
        {children}
      </div>
      <Link
        href={href}
        className="relative shrink-0 rounded-sm pt-0.5 text-callout font-semibold text-accent-text opacity-80 transition-[transform,opacity] duration-150 ease-out after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:underline group-hover:-translate-x-1 group-hover:opacity-100 focus-visible:-translate-x-1 focus-visible:opacity-100 motion-reduce:translate-x-0 motion-reduce:transition-none [:root[data-reduce-motion=true]_&]:translate-x-0 [:root[data-reduce-motion=true]_&]:transition-none"
      >
        {action}
      </Link>
    </motion.li>
  );
}

/** The inspector: what is waiting on this person, one action each. */
function NeedsYou({ d, now }: { d: StaffDashboard; now: number }) {
  const reduced = useReducedMotion();
  const g = d.grading;
  const inc = d.incidents;
  const dis = d.disputes;
  const firstGrading = g?.exams[0];
  return (
    <aside aria-labelledby="needs-you" className="lg:border-l lg:border-separator lg:pl-8">
      <h2 id="needs-you" className="text-title-3 font-semibold text-label">
        Needs you
      </h2>
      {g || inc || dis ? (
        <motion.ul
          initial={reduced ? false : 'hidden'}
          animate="show"
          variants={{ show: { transition: { delayChildren: 0.12, staggerChildren: 0.05 } } }}
          className="mt-3 divide-y divide-separator border-y border-separator"
        >
          {g && (
            <NeedRow
              count={g.pendingItems}
              label={g.pendingItems === 1 ? 'answer to grade' : 'answers to grade'}
              detail={
                firstGrading
                  ? `${n.format(firstGrading.pendingAttempts)} ${firstGrading.pendingAttempts === 1 ? 'script' : 'scripts'} in ${firstGrading.title}${g.exams.length > 1 ? `, and ${g.exams.length - 1} more ${g.exams.length === 2 ? 'exam' : 'exams'}` : ''}`
                  : 'Written answers land here as candidates submit.'
              }
              href={g.exams.length === 1 ? `/exams/${g.exams[0]!.id}/grading` : '/grading'}
              action={g.pendingItems ? 'Grade' : 'View'}
            />
          )}
          {inc && (
            <NeedRow
              count={inc.unreviewed}
              label={inc.unreviewed === 1 ? 'incident to review' : 'incidents to review'}
              detail={
                inc.items.length === 0
                  ? 'Nothing of medium or high severity in the last 24 hours.'
                  : undefined
              }
              href={inc.items[0] ? `/exams/${inc.items[0].examId}/integrity` : '/exams'}
              action={inc.unreviewed ? 'Review' : 'View'}
            >
              {inc.items.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1">
                  {inc.items.slice(0, 2).map((i) => (
                    <li key={i.id} className="text-footnote text-label-secondary">
                      <span
                        className={cn(
                          'font-medium',
                          i.severity === 'high' ? 'text-danger-text' : 'text-warning-text',
                        )}
                      >
                        {i.severity === 'high' ? 'High' : 'Medium'}
                      </span>{' '}
                      <span className="text-label">{i.candidateName}</span>,{' '}
                      {eventLabel(i.type).toLowerCase()}, {ago(i.createdAt, now)}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-caption text-label-tertiary">{INDICATOR_NOTICE}</p>
            </NeedRow>
          )}
          {dis && (
            <NeedRow
              count={dis.open}
              label={dis.open === 1 ? 'dispute open' : 'disputes open'}
              detail={
                dis.overdue
                  ? `${dis.overdue} past the response date`
                  : dis.open === 0
                    ? 'None waiting for a decision.'
                    : 'All within the response window.'
              }
              urgent={dis.overdue > 0}
              href="/disputes"
              action={dis.open ? 'Respond' : 'View'}
            />
          )}
        </motion.ul>
      ) : (
        <p className="mt-3 border-y border-separator py-5 text-callout text-label-secondary">
          Nothing is waiting on you.
        </p>
      )}

      <div className="mt-8 flex items-center gap-3">
        <TenantTile
          name={d.organization.name}
          type={d.organization.type}
          accent={d.organization.accentColor}
          size={28}
        />
        <div className="min-w-0">
          <p className="truncate text-footnote font-medium text-label">{d.organization.name}</p>
          <p className="truncate text-caption text-label-secondary">
            {d.organization.tagline || ORG_TYPE_COPY[d.organization.type].label}
          </p>
        </div>
      </div>
    </aside>
  );
}

const DISMISS_KEY = (userId: string) => `athena:getting-started:dismissed:${userId}`;

function GettingStarted({
  checklist,
  userId,
}: {
  checklist: NonNullable<StaffDashboard['checklist']>;
  userId: string;
}) {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY(userId)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [userId]);

  const org = checklist.scope === 'organization';
  const steps = [
    ...(checklist.people !== null
      ? [
          {
            done: !!checklist.people,
            title: 'Bring in your people',
            detail: 'Import staff and candidates from a spreadsheet.',
            href: '/people/import',
            action: 'Import people',
          },
        ]
      : []),
    {
      done: checklist.questions,
      title: org ? 'Fill the question bank' : 'Add your first questions',
      detail: 'Write them, or import a CSV or JSON file.',
      href: '/questions/import',
      action: 'Import questions',
    },
    {
      done: checklist.exam,
      title: 'Create an exam',
      detail: 'Set the window, duration and sections.',
      href: '/exams/new',
      action: 'New exam',
    },
    {
      done: checklist.candidates,
      title: 'Enroll candidates',
      detail: 'Add people one by one or a whole class.',
      href: '/exams',
      action: 'Open exams',
    },
    {
      done: checklist.published,
      title: 'Publish it',
      detail: 'Candidates see it when the window opens.',
      href: '/exams',
      action: 'Open exams',
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (dismissed || done === steps.length) return null;
  const next = steps.findIndex((s) => !s.done);

  return (
    <section
      aria-labelledby="getting-started"
      className="rounded-2xl border border-separator bg-surface p-5 sm:p-8"
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2
            id="getting-started"
            className="text-title-2 font-semibold tracking-[-0.02em] text-label"
          >
            {org ? 'Set up your organization' : 'Get your first exam out'}
          </h2>
          <p className="mt-1 text-callout text-label-secondary">
            {org
              ? 'Five steps from an empty workspace to a live exam.'
              : 'Four steps from a blank page to candidates writing.'}
          </p>
        </div>
        <p
          className={cn(numeral, 'text-[2.5rem]/none text-label')}
          aria-label={`${done} of ${steps.length} done`}
        >
          {done}
          <span className="text-label-tertiary">/{steps.length}</span>
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide this checklist"
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem(DISMISS_KEY(userId), '1');
            } catch {
              /* private mode: hidden for this visit only */
            }
          }}
        >
          <X aria-hidden />
        </Button>
      </div>
      <ol className="mt-6 flex flex-col divide-y divide-separator border-t border-separator">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="flex items-center gap-4 py-3.5 last:pb-0"
            aria-current={i === next ? 'step' : undefined}
          >
            <span
              className={cn(
                'inline-flex size-5 shrink-0 items-center justify-center rounded-full',
                s.done
                  ? 'bg-gold text-on-gold'
                  : i === next
                    ? 'border-2 border-accent'
                    : 'border border-separator-strong',
              )}
            >
              {s.done && <Check aria-label="Done" className="size-3" strokeWidth={3} />}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-callout font-medium',
                  s.done
                    ? 'text-label-tertiary line-through decoration-label-quaternary'
                    : 'text-label',
                )}
              >
                {s.title}
              </p>
              {!s.done && <p className="text-footnote text-label-secondary">{s.detail}</p>}
            </div>
            {!s.done && (
              <Button
                asChild
                variant={i === next ? 'filled' : 'gray'}
                size="sm"
                className="shrink-0 max-sm:h-11"
              >
                <Link href={s.href}>{s.action}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading your home" className="flex flex-col gap-8 pt-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-14 w-[26rem] max-w-full" />
        <Skeleton className="h-5 w-[32rem] max-w-full" />
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Skeleton className="h-80 rounded-2xl" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-56" />
        </div>
      </div>
    </div>
  );
}

/** Home for staff: the live exam first, what is waiting on them beside it, and what comes next. */
export function StaffHome() {
  const { me, can } = useAuth();
  const now = useNow();
  const dashboard = useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: () => api.get<StaffDashboard>('/org/dashboard'),
    refetchInterval: 30_000,
    enabled: !!me?.organization,
  });

  if (!me) return null;
  if (dashboard.isPending) return <HomeSkeleton />;
  if (dashboard.isError) {
    return (
      <>
        <PageHeader title={`${greeting()}, ${givenName(me.user.name)}`} />
        <EmptyState
          icon={<CalendarClock />}
          title="Couldn’t load your home"
          description={errorMessage(dashboard.error)}
          action={
            <Button variant="gray" onClick={() => void dashboard.refetch()}>
              Try again
            </Button>
          }
        />
      </>
    );
  }

  const d = dashboard.data;
  const title = `${greeting()}, ${givenName(me.user.name)}`;
  const [lead, ...others] = d.live;
  const quick = [
    can('exams.create') && {
      href: '/exams/new',
      label: 'New exam',
      icon: <ClipboardPlus aria-hidden />,
    },
    can('questions.manage') && {
      href: '/questions/import',
      label: 'Import questions',
      icon: <FileUp aria-hidden />,
    },
    can('users.manage') && {
      href: '/people/import',
      label: 'Onboard people',
      icon: <UserPlus aria-hidden />,
    },
  ].filter(Boolean) as { href: string; label: string; icon: ReactNode }[];

  return (
    <>
      <header className="flex flex-col gap-6 pb-10 pt-2 sm:pt-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance font-display text-[clamp(2.6rem,7vw,4.5rem)] font-medium leading-[0.98] tracking-[-0.035em] text-label">
            <WrittenText text={title} once="home-greeting" />
          </h1>
          <p className="mt-4 max-w-[44rem] text-pretty text-title-3 font-normal text-label-secondary">
            {brief(d, now)}
          </p>
          <ShellTitle title={title} />
        </div>
        {quick.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {quick.map((q, i) => (
              <Button
                key={q.href}
                asChild
                variant={!lead && i === 0 ? 'filled' : 'gray'}
                className="max-sm:h-11"
              >
                <Link href={q.href}>
                  {q.icon} {q.label}
                </Link>
              </Button>
            ))}
          </div>
        )}
      </header>

      <div className="grid items-start gap-x-10 gap-y-12 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-10">
          {lead ? (
            <LiveSheet exam={lead} now={now} />
          ) : (
            <NothingLive next={d.upcoming[0]} now={now} canCreate={can('exams.create')} />
          )}
          {others.length > 0 && <AlsoLive exams={others} now={now} />}
          {d.checklist && <GettingStarted checklist={d.checklist} userId={me.user.id} />}
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <NeedsYou d={d} now={now} />
        </div>

        {(lead || d.upcoming.length > 0) && (
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <Upcoming
              items={d.upcoming}
              now={now}
              canCreate={can('exams.create')}
              drafts={d.drafts}
            />
          </div>
        )}
      </div>
      {can('audit.view') && <DayAtAGlance scope="org" className="mt-16" />}
    </>
  );
}

export default StaffHome;
