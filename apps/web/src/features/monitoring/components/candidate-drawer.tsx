'use client';

import { AlarmClockPlus, Ban, Megaphone } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useTimeline } from '../api';
import { useServerNow } from '../clock';
import { SEVERITY_TONE, clockTime, eventDetail, eventLabel, plural } from '../format';
import type { LiveAttempt, MonitorEvent, RosterEntry } from '../types';
import { IndicatorRow } from './indicator-review';
import { ConnectionStatus, IndicatorNotice, PriorityPill, TimeLeft } from './live-bits';
import { CountRule } from './rule';
import { SessionChart } from './session-chart';

export interface DrawerActions {
  onExtend: (a: LiveAttempt) => void;
  onForceSubmit: (a: LiveAttempt) => void;
  onMessage: (target: { userId: string; name: string }) => void;
}

// Order matters: Edge also says Chrome, and Chrome also says Safari.
const BROWSERS: [RegExp, string][] = [
  [/Edg\/(\d+)/, 'Edge'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+).*Safari/, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** "Chrome 131 on Windows" from a user agent, without a parsing library. */
function deviceSummary(ua: string | null, platform: string | null): string | null {
  if (!ua) return platform;
  let browser = 'A browser';
  for (const [re, name] of BROWSERS) {
    const m = ua.match(re);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? platform;
  return os ? `${browser} on ${os}` : browser;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5 first:pl-0">
      <span className="text-footnote text-label-secondary">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function DrawerSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-headline text-label">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function AttemptBody({ examId, attempt, canIntervene, actions }: { examId: string; attempt: LiveAttempt; canIntervene: boolean; actions: DrawerActions }) {
  const timeline = useTimeline(examId, attempt.attemptId);
  const now = useServerNow();
  const [showAll, setShowAll] = useState(false);
  const live = attempt.status === 'in_progress';

  const focusIndicator = (e: MonitorEvent) => {
    const el = document.getElementById(`indicator-${e.id}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  };

  const events = timeline.data?.events ?? [];
  const indicators = events.filter((e) => e.severity !== 'info');
  const open = indicators.filter((e) => !e.review || e.review.status === 'open').length;
  const activity = showAll ? events : events.slice(-12);
  const device = timeline.data?.attempt.device;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 divide-x divide-separator">
        <Fact label={live ? 'Time left' : 'Status'}>
          <TimeLeft attempt={attempt} size={live ? 'lg' : 'md'} />
        </Fact>
        <Fact label="Answered">
          <span className="numeral text-[2rem] leading-none text-label">
            {attempt.answeredCount}
            <span className="text-callout font-normal tracking-normal text-label-secondary">/{attempt.itemCount}</span>
          </span>
          <CountRule className="mt-2.5" count={attempt.answeredCount} total={attempt.itemCount} muted={attempt.status === 'submitted'} label="Questions answered" />
          {attempt.flaggedCount > 0 && <span className="mt-1 block text-footnote text-label-secondary">{plural(attempt.flaggedCount, 'flagged')}</span>}
        </Fact>
        <Fact label="Connection">
          <ConnectionStatus attempt={attempt} />
          <span className="mt-1 block text-footnote text-label-secondary tabular-nums">Started {clockTime(attempt.startedAt)}</span>
        </Fact>
      </div>

      {canIntervene && attempt.status !== 'submitted' && (
        <div className="flex flex-wrap gap-2">
          {/* Neutral on purpose: with a red-family accent, a tinted button would look like the destructive one beside it. */}
          <Button variant="gray" onClick={() => actions.onExtend(attempt)}>
            <AlarmClockPlus aria-hidden />
            Extend time
          </Button>
          <Button variant="gray" onClick={() => actions.onMessage({ userId: attempt.candidate.userId, name: attempt.candidate.name })}>
            <Megaphone aria-hidden />
            Message
          </Button>
          <Button variant="destructive-tinted" className="ml-auto" onClick={() => actions.onForceSubmit(attempt)}>
            <Ban aria-hidden />
            Force submit
          </Button>
        </div>
      )}

      {timeline.isPending ? (
        <div className="flex flex-col gap-3 border-t pt-5" role="status" aria-label="Loading timeline">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-2.5 w-full rounded-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : timeline.isLoadingError ? (
        <EmptyState size="sm" surface={false} title="Couldn’t load the timeline" description={errorMessage(timeline.error)} action={<Button onClick={() => timeline.refetch()}>Try again</Button>} />
      ) : (
        <>
          <DrawerSection title="Session">
            <SessionChart timeline={timeline.data} now={now} onSelectEvent={focusIndicator} />
          </DrawerSection>

          <DrawerSection
            title="Indicators"
            aside={
              <span className="flex items-center gap-2 text-footnote text-label-secondary">
                {indicators.length ? `${open} to review of ${indicators.length}` : 'None'}
                <PriorityPill priority={attempt.reviewPriority} />
              </span>
            }
          >
            <IndicatorNotice />
            {indicators.length > 0 && (
              <ul className="-mt-1 divide-y divide-separator">
                {/* Rows already here when the drawer opens stay put; only live arrivals land. */}
                <AnimatePresence initial={false}>
                  {indicators.map((e) => (
                    <IndicatorRow key={e.id} id={`indicator-${e.id}`} examId={examId} event={e} canReview={canIntervene} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </DrawerSection>

          <DrawerSection
            title="Activity"
            aside={
              events.length > 12 && (
                <Button variant="plain" size="sm" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show recent' : `Show all ${events.length}`}
                </Button>
              )
            }
          >
            <ol className="flex flex-col">
              {activity.map((e) => {
                const detail = eventDetail(e);
                return (
                  <li key={e.id} className="grid grid-cols-[4.75rem_0.75rem_minmax(0,1fr)] items-baseline gap-x-2 py-1 text-subheadline">
                    <time dateTime={e.createdAt} className="text-footnote tabular-nums text-label-secondary">
                      {clockTime(e.createdAt, true)}
                    </time>
                    <StatusDot tone={e.severity === 'info' ? 'neutral' : SEVERITY_TONE[e.severity]} className="self-center" />
                    <span className={cn('flex flex-wrap gap-x-2', e.severity === 'info' ? 'text-label-secondary' : 'text-label')}>
                      <span>{eventLabel(e.type)}</span>
                      {detail && <span className="text-label-secondary">{detail}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </DrawerSection>

          {device && (deviceSummary(device.userAgent, device.platform) || device.screen || device.timezone) && (
            <DrawerSection title="Device">
              <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-subheadline">
                {deviceSummary(device.userAgent, device.platform) && (
                  <>
                    <dt className="text-label-secondary">Browser</dt>
                    <dd className="text-label" title={device.userAgent ?? undefined}>
                      {deviceSummary(device.userAgent, device.platform)}
                    </dd>
                  </>
                )}
                {device.screen && (
                  <>
                    <dt className="text-label-secondary">Screen</dt>
                    <dd className="text-label tabular-nums">{device.screen}</dd>
                  </>
                )}
                {device.timezone && (
                  <>
                    <dt className="text-label-secondary">Time zone</dt>
                    <dd className="text-label">{device.timezone}</dd>
                  </>
                )}
                {attempt.deviceSwitches > 0 && (
                  <>
                    <dt className="text-label-secondary">Devices</dt>
                    <dd className="text-label">Moved to another device {attempt.deviceSwitches === 1 ? 'once' : `${attempt.deviceSwitches} times`}</dd>
                  </>
                )}
              </dl>
            </DrawerSection>
          )}
        </>
      )}
    </div>
  );
}

/** Everything about one candidate: live facts, interventions, the session timeline and indicator review. */
export function CandidateDrawer({
  examId,
  entry,
  open,
  onOpenChange,
  canIntervene,
  actions,
}: {
  examId: string;
  entry: RosterEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canIntervene: boolean;
  actions: DrawerActions;
}) {
  const candidate = entry ? (entry.kind === 'attempt' ? entry.attempt.candidate : entry.candidate) : null;
  const email = entry ? (entry.kind === 'attempt' ? entry.attempt.email : entry.candidate.email) : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="md:w-[min(36rem,calc(100vw-1rem))]"
        title={candidate?.name ?? 'Candidate'}
        description={[candidate?.rollNumber, email].filter(Boolean).join(', ') || undefined}
      >
        {entry?.kind === 'attempt' ? (
          <AttemptBody examId={examId} attempt={entry.attempt} canIntervene={canIntervene} actions={actions} />
        ) : entry ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Badge>Not started</Badge>
              {entry.candidate.cohort && <span className="text-subheadline text-label-secondary">{entry.candidate.cohort}</span>}
            </div>
            <p className="text-callout text-label-secondary">
              {entry.candidate.accommodation
                ? `Has an accommodation: ${entry.candidate.accommodation.timeMultiplier !== 1 ? `${entry.candidate.accommodation.timeMultiplier}× time` : ''}${
                    entry.candidate.accommodation.timeMultiplier !== 1 && entry.candidate.accommodation.extraMinutes ? ' plus ' : ''
                  }${entry.candidate.accommodation.extraMinutes ? `${entry.candidate.accommodation.extraMinutes} extra minutes` : ''}. It applies automatically when they start.`
                : 'Their timer starts when they begin. Nothing to review yet.'}
            </p>
            {canIntervene && (
              <Button variant="gray" className="self-start" onClick={() => actions.onMessage({ userId: entry.candidate.userId, name: entry.candidate.name })}>
                <Megaphone aria-hidden />
                Message {entry.candidate.name.split(' ')[0]}
              </Button>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
