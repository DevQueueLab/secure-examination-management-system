'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  Check,
  CircleCheck,
  ClipboardPlus,
  FileUp,
  Library,
  NotebookPen,
  PenLine,
  Radio,
  Scale,
  ShieldAlert,
  UserPlus,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { givenName } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ProgressRing } from '@/components/ui/progress';
import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
import { ORG_TYPE_COPY, TenantTile } from '@/features/admin/components/pills';
import { eventLabel, INDICATOR_NOTICE } from '@/features/monitoring/format';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import type { StaffDashboard } from './types';

const DASHBOARD_KEY = ['org', 'dashboard'] as const;

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

const opens = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
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

function Card({
  title,
  icon,
  count,
  href,
  linkLabel,
  children,
  className,
}: {
  title: string;
  icon: ReactNode;
  count?: ReactNode;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col rounded-xl bg-surface', className)} aria-label={title}>
      <header className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <span aria-hidden className="text-label-tertiary [&_svg]:size-4">
          {icon}
        </span>
        <h2 className="text-headline text-label">{title}</h2>
        {count}
        {href && (
          <Link
            href={href}
            className="ml-auto rounded-md text-footnote font-medium text-accent-text hover:underline"
          >
            {linkLabel ?? 'See all'}
          </Link>
        )}
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  );
}

function LiveExam({ exam, now }: { exam: StaffDashboard['live'][number]; now: number }) {
  const notStarted = Math.max(
    0,
    exam.enrolled - exam.inProgress - exam.awaitingSync - exam.submitted,
  );
  const total = Math.max(1, exam.enrolled);
  const segments = [
    { key: 'submitted', value: exam.submitted, label: 'submitted', className: 'bg-success' },
    { key: 'writing', value: exam.inProgress, label: 'writing', className: 'bg-accent' },
    { key: 'sync', value: exam.awaitingSync, label: 'syncing', className: 'bg-warning' },
  ].filter((s) => s.value > 0);
  const closingSoon = new Date(exam.closesAt).getTime() - now < 30 * 60_000;
  return (
    <Link
      href={`/exams/${exam.id}/monitor`}
      className="group flex flex-col gap-3 rounded-xl bg-surface p-4 transition-colors hover:bg-fill-secondary"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-headline text-label">{exam.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote">
            <span className="inline-flex items-center gap-1.5 font-semibold text-success-text">
              <span aria-hidden className="size-2 rounded-full bg-success" />
              Live
            </span>
            <span
              className={closingSoon ? 'font-medium text-warning-text' : 'text-label-secondary'}
            >
              Closes in {until(exam.closesAt, now)}
            </span>
            {exam.code && <span className="text-label-tertiary">{exam.code}</span>}
          </p>
        </div>
        <span className="text-footnote font-medium text-accent-text group-hover:underline">
          Monitor
        </span>
      </div>
      <div
        role="img"
        aria-label={`${exam.submitted} submitted, ${exam.inProgress} writing, ${exam.awaitingSync} syncing, ${notStarted} not started, of ${exam.enrolled} enrolled`}
        className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-fill"
      >
        {segments.map((s) => (
          <span
            key={s.key}
            className={cn('h-full first:rounded-l-full last:rounded-r-full', s.className)}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-footnote text-label-secondary" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-accent" />
          <span className="font-semibold tabular-nums text-label">{exam.inProgress}</span> writing
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-success" />
          <span className="font-semibold tabular-nums text-label">{exam.submitted}</span> submitted
        </span>
        {exam.awaitingSync > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-warning" />
            <span className="font-semibold tabular-nums text-label">{exam.awaitingSync}</span>{' '}
            syncing
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-fill-strong" />
          <span className="font-semibold tabular-nums text-label">{notStarted}</span> not started
        </span>
      </p>
    </Link>
  );
}

function Row({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fill-secondary"
      >
        {children}
      </Link>
    </li>
  );
}

function SideRow({
  href,
  icon,
  title,
  detail,
  value,
  urgent,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  detail: string;
  value: ReactNode;
  urgent?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-fill-secondary"
      >
        <span aria-hidden className="text-label-tertiary [&_svg]:size-4">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-callout font-medium text-label">{title}</p>
          <p
            className={cn(
              'truncate text-footnote',
              urgent ? 'font-medium text-danger-text' : 'text-label-secondary',
            )}
          >
            {detail}
          </p>
        </div>
        <span className="text-title-3 tabular-nums text-label">{value}</span>
      </Link>
    </li>
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
      className="flex flex-col gap-4 rounded-xl bg-surface p-5"
    >
      <div className="flex items-start gap-4">
        <ProgressRing value={done} max={steps.length} size={44} label="Setup progress">
          <span className="text-footnote font-semibold tabular-nums text-label">
            {done}/{steps.length}
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <h2 id="getting-started" className="text-title-3 text-label">
            {org ? 'Set up your organization' : 'Get your first exam out'}
          </h2>
          <p className="text-callout text-label-secondary">
            {org
              ? 'Five steps from an empty workspace to a live exam.'
              : 'Four steps from a blank page to candidates writing.'}
          </p>
        </div>
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
      <ol className="flex flex-col divide-y divide-separator border-t border-separator">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="flex items-center gap-3 py-3 last:pb-0"
            aria-current={i === next ? 'step' : undefined}
          >
            <span
              className={cn(
                'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-footnote font-semibold tabular-nums',
                s.done
                  ? 'bg-success text-white'
                  : i === next
                    ? 'bg-accent text-on-accent'
                    : 'bg-fill text-label-secondary',
              )}
            >
              {s.done ? <Check aria-label="Done" className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-callout font-medium',
                  s.done
                    ? 'text-label-secondary line-through decoration-label-tertiary'
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
                className="shrink-0"
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
    <div role="status" aria-label="Loading your home" className="flex flex-col gap-6">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-5 w-[28rem] max-w-full" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

const SEVERITY_TONE = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
  info: 'neutral',
} as const;

/** Home for staff: what's live, what needs grading or review, and what's next. */
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
  const quick = [
    can('exams.create') && {
      href: '/exams/new',
      label: 'New exam',
      icon: <ClipboardPlus aria-hidden />,
      primary: true,
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
  ].filter(Boolean) as { href: string; label: string; icon: ReactNode; primary?: boolean }[];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${givenName(me.user.name)}`}
        subtitle={brief(d, now)}
        actions={
          quick.length ? (
            <>
              {quick.map((q) => (
                <Button key={q.href} asChild variant={q.primary ? 'filled' : 'gray'}>
                  <Link href={q.href}>
                    {q.icon} {q.label}
                  </Link>
                </Button>
              ))}
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-8">
        {d.checklist && <GettingStarted checklist={d.checklist} userId={me.user.id} />}

        {d.live.length > 0 && (
          <Section
            title="Live now"
            description={`${d.live.length === 1 ? 'One exam is' : `${d.live.length} exams are`} open. Updates every 30 seconds.`}
          >
            <div className={cn('grid gap-3', d.live.length > 1 && 'md:grid-cols-2')}>
              {d.live.map((e) => (
                <LiveExam key={e.id} exam={e} now={now} />
              ))}
            </div>
          </Section>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {d.grading && (
              <Card
                title="Needs grading"
                icon={<PenLine />}
                count={
                  d.grading.pendingItems > 0 ? (
                    <Badge size="sm" tone="accent">
                      {n.format(d.grading.pendingItems)}
                    </Badge>
                  ) : undefined
                }
                href="/grading"
              >
                {d.grading.exams.length === 0 ? (
                  <div className="flex items-center gap-3 px-4 pb-4 pt-1 text-callout text-label-secondary">
                    <CircleCheck aria-hidden className="size-5 text-success-text" /> All caught up.
                    Written answers land here as candidates submit.
                  </div>
                ) : (
                  <ul className="flex flex-col pb-2">
                    {d.grading.exams.map((e) => (
                      <Row key={e.id} href={`/exams/${e.id}/grading`}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-callout font-medium text-label">{e.title}</p>
                          <p className="text-footnote text-label-secondary">
                            {n.format(e.pendingAttempts)}{' '}
                            {e.pendingAttempts === 1 ? 'script' : 'scripts'} waiting
                          </p>
                        </div>
                        <span className="text-right">
                          <span className="block text-title-3 tabular-nums text-label">
                            {n.format(e.pendingItems)}
                          </span>
                          <span className="block text-caption text-label-tertiary">
                            {e.pendingItems === 1 ? 'answer' : 'answers'}
                          </span>
                        </span>
                      </Row>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            <Card title="Upcoming" icon={<CalendarClock />} href="/exams" linkLabel="All exams">
              {d.upcoming.length === 0 ? (
                <div className="px-4 pb-4 pt-1">
                  <p className="text-callout text-label-secondary">
                    No exams scheduled.
                    {can('exams.create')
                      ? ' Create one and it shows here until its window opens.'
                      : ' Exams you are staff on appear here before they open.'}
                  </p>
                  {d.drafts > 0 && (
                    <p className="mt-1 text-footnote text-label-tertiary">
                      You have {d.drafts} {d.drafts === 1 ? 'draft' : 'drafts'} waiting to be
                      scheduled.
                    </p>
                  )}
                </div>
              ) : (
                <ul className="flex flex-col pb-2">
                  {d.upcoming.map((e) => {
                    const when = new Date(e.opensAt);
                    return (
                      <Row key={e.id} href={`/exams/${e.id}`}>
                        <span
                          aria-hidden
                          className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-fill-secondary py-1"
                        >
                          <span className="text-caption font-semibold uppercase text-danger-text">
                            {monthShort.format(when)}
                          </span>
                          <span className="text-headline tabular-nums leading-tight text-label">
                            {dayNum.format(when)}
                          </span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-callout font-medium text-label">{e.title}</p>
                          <p className="flex min-w-0 gap-x-3 text-footnote text-label-secondary">
                            <span className="shrink-0">{opens.format(when)}</span>
                            <span className="shrink-0">{e.durationMinutes} min</span>
                            <span className="truncate">{n.format(e.enrolled)} enrolled</span>
                          </p>
                        </div>
                        <span className="hidden text-footnote text-label-tertiary sm:block">
                          in {until(e.opensAt, now)}
                        </span>
                      </Row>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            {d.incidents && (
              <Card
                title="Incidents"
                icon={<ShieldAlert />}
                count={
                  d.incidents.unreviewed > 0 ? (
                    <Badge size="sm" tone="warning">
                      {d.incidents.unreviewed} to review
                    </Badge>
                  ) : undefined
                }
              >
                {d.incidents.items.length === 0 ? (
                  <p className="px-4 pb-4 pt-1 text-callout text-label-secondary">
                    Nothing of medium or high severity in the last 24 hours.
                  </p>
                ) : (
                  <ul className="flex flex-col">
                    {d.incidents.items.slice(0, 5).map((i) => (
                      <Row key={i.id} href={`/exams/${i.examId}/integrity`}>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-callout text-label">
                            <Badge size="sm" tone={SEVERITY_TONE[i.severity]}>
                              {i.severity === 'high' ? 'High' : 'Medium'}
                            </Badge>
                            <span className="truncate font-medium">{i.candidateName}</span>
                          </p>
                          <p className="truncate text-footnote text-label-secondary">
                            {eventLabel(i.type)}, {ago(i.createdAt, now)}
                          </p>
                        </div>
                      </Row>
                    ))}
                  </ul>
                )}
                <p className="border-t px-4 py-2.5 text-caption text-label-tertiary">
                  {d.incidents.last24h} in the last 24 hours. {INDICATOR_NOTICE}
                </p>
              </Card>
            )}

            <section
              aria-labelledby="home-organization"
              className="overflow-hidden rounded-xl bg-surface"
            >
              <div className="flex items-center gap-3 px-4 py-3.5">
                <TenantTile
                  name={d.organization.name}
                  type={d.organization.type}
                  accent={d.organization.accentColor}
                  size={36}
                />
                <div className="min-w-0">
                  <h2 id="home-organization" className="line-clamp-2 text-headline text-label">
                    {d.organization.name}
                  </h2>
                  <p className="truncate text-footnote text-label-secondary">
                    {d.organization.tagline || ORG_TYPE_COPY[d.organization.type].label}
                  </p>
                </div>
              </div>
              {(d.disputes || d.questionBank || d.drafts > 0) && (
                <ul className="flex flex-col divide-y divide-separator border-t border-separator">
                  {d.disputes && (
                    <SideRow
                      href="/disputes"
                      icon={<Scale />}
                      title="Disputes"
                      detail={
                        d.disputes.open === 0
                          ? 'None open'
                          : `${d.disputes.open} open${d.disputes.overdue ? `, ${d.disputes.overdue} past due` : ''}`
                      }
                      urgent={!!d.disputes.overdue}
                      value={d.disputes.open}
                    />
                  )}
                  {d.questionBank && (
                    <SideRow
                      href="/questions"
                      icon={<Library />}
                      title="Question bank"
                      detail="Active questions ready to use"
                      value={n.format(d.questionBank.active)}
                    />
                  )}
                  {d.drafts > 0 && (
                    <SideRow
                      href="/exams"
                      icon={<NotebookPen />}
                      title="Drafts"
                      detail="Exams you’re still building"
                      value={d.drafts}
                    />
                  )}
                </ul>
              )}
            </section>
          </div>
        </div>

        {d.live.length === 0 &&
          !d.checklist &&
          d.upcoming.length === 0 &&
          !d.grading?.pendingItems && (
            <p className="flex items-center gap-2 text-footnote text-label-secondary">
              <Radio aria-hidden className="size-3.5" /> When an exam opens, it appears at the top
              of this page with live progress.
            </p>
          )}
      </div>
    </>
  );
}

export default StaffHome;
