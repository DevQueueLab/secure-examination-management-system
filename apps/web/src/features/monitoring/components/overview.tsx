'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useServerNow } from '../clock';
import { clockTime, dayTime, formatDuration, plural } from '../format';
import type { LiveMonitor } from '../types';
import { MarksRule } from '@/components/ui/marks-rule';

/** The one sheet on the monitor: marble in light themes, smoked glass in dark, with a fluted band along the top. */
export function InstrumentPanel({ status, children }: { status: ReactNode; children: ReactNode }) {
  return (
    <section
      aria-label="The exam at a glance"
      className={cn(
        'overflow-hidden rounded-2xl bg-surface ring-1 ring-separator',
        'dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.07)] dark:ring-white/[0.09] dark:backdrop-blur-xl',
      )}
    >
      <div
        className={cn(
          // The signature fluted glass from the shell, as the panel's header band.
          'fluted flex flex-col gap-2.5 border-b border-separator px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5',
        )}
      >
        {status}
      </div>
      {children}
    </section>
  );
}

/** The exam window on the rule: how much of it has passed, and how long until it closes. */
export function ExamWindow({ exam }: { exam: LiveMonitor['exam'] }) {
  const now = useServerNow();
  const opens = Date.parse(exam.windowOpensAt);
  const closes = Date.parse(exam.windowClosesAt);
  const elapsed = Math.min(Math.max(now - opens, 0), closes - opens);
  const status = now < opens ? `Opens in ${formatDuration(opens - now)}` : now < closes ? `${formatDuration(closes - now)} left` : `Closed ${clockTime(closes)}`;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-subheadline">
      <span className="whitespace-nowrap text-label-secondary">
        Window <span className="text-label tabular-nums">{dayTime(opens, now)}</span> – <span className="text-label tabular-nums">{dayTime(closes, now)}</span>
      </span>
      <MarksRule
        className="w-28 shrink-0 sm:w-40"
        size="sm"
        marker="both"
        value={elapsed}
        max={Math.max(1, closes - opens)}
        tone={now >= closes ? 'neutral' : 'accent'}
        label="Exam window elapsed"
        valueText={status}
      />
      <span className="whitespace-nowrap font-medium tabular-nums text-label">{status}</span>
    </div>
  );
}

export type KpiKey = 'in_progress' | 'submitted' | 'not_started' | 'online' | 'incidents';

export interface KpiCounts {
  enrolled: number;
  inProgress: number;
  submitted: number;
  autoSubmitted: number;
  notStarted: number;
  online: number;
  offline: number;
  openIncidents: number;
  candidatesWithOpen: number;
  /** Answers saved across the cohort, and how many the whole cohort will give when every paper is complete. */
  answered: number;
  capacity: number;
}

interface KpiProps {
  counts: KpiCounts;
  active: KpiKey | null;
  onToggle: (key: KpiKey) => void;
}

/** Live counters as instrument readings. Each one doubles as a filter for the roster below (press again to clear). */
export function KpiStrip({ counts, active, onToggle }: KpiProps) {
  const cells: { key: KpiKey; label: string; value: number; hint: ReactNode }[] = [
    { key: 'in_progress', label: 'In progress', value: counts.inProgress, hint: `of ${counts.enrolled} enrolled` },
    {
      key: 'submitted',
      label: 'Submitted',
      value: counts.submitted,
      hint: counts.autoSubmitted ? `${counts.autoSubmitted} at the deadline` : counts.submitted ? 'all by the candidate' : 'none yet',
    },
    { key: 'not_started', label: 'Not started', value: counts.notStarted, hint: `of ${counts.enrolled} enrolled` },
    {
      key: 'online',
      label: 'Online now',
      value: counts.online,
      hint: counts.offline ? <span className="font-medium text-warning-text">{counts.offline} offline</span> : counts.inProgress ? 'everyone connected' : 'nobody in progress',
    },
    {
      key: 'incidents',
      label: 'Open indicators',
      value: counts.openIncidents,
      hint: counts.openIncidents ? `across ${plural(counts.candidatesWithOpen, 'candidate')}` : 'nothing to review',
    },
  ];
  return (
    <div
      role="group"
      aria-label="Live counts. Press one to filter the roster."
      className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:divide-x lg:divide-separator"
    >
      {cells.map((c) => {
        const pressed = active === c.key;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(c.key)}
            className={cn(
              'group relative flex min-h-11 flex-1 flex-col items-start px-4 pb-3.5 pt-4 text-left transition-colors duration-150 sm:px-5 sm:pb-4 sm:pt-5',
              'focus-visible:-outline-offset-2',
              pressed ? 'bg-accent-tint/60' : 'hover:bg-fill-secondary active:bg-fill',
            )}
          >
            <span className="numeral text-[2.25rem] leading-none text-label sm:text-[2.75rem]">{c.value}</span>
            <span className={cn('mt-2.5 text-subheadline font-medium', pressed ? 'text-accent-text' : 'text-label')}>{c.label}</span>
            <span className="text-footnote text-label-secondary">{c.hint}</span>
            {/* The pressed reading carries the needle. */}
            <span aria-hidden className={cn('absolute inset-x-4 bottom-0 h-0.5 bg-accent transition-opacity sm:inset-x-5', pressed ? 'opacity-100' : 'opacity-0')} />
          </button>
        );
      })}
    </div>
  );
}

/** How far the whole room is through the paper, on the rule. Candidates who have not started count as nothing yet. */
export function CohortCompletion({ answered, capacity }: { answered: number; capacity: number }) {
  const share = capacity ? answered / capacity : 0;
  const pct = Math.round(share * 100);
  return (
    <div className="flex flex-col gap-3 border-t border-separator px-4 py-4 sm:px-5 md:flex-row md:items-center md:gap-6">
      <div className="flex items-baseline gap-2.5 md:w-60 md:shrink-0">
        <span className="numeral text-[1.75rem] leading-none text-label">
          {pct}
          <span className="text-label-secondary">%</span>
        </span>
        <span className="text-subheadline font-medium text-label">Cohort completion</span>
      </div>
      <MarksRule
        className="w-full min-w-0 md:w-auto md:flex-1"
        size="md"
        marker="both"
        value={pct}
        max={100}
        label="Cohort completion"
        valueText={`${pct}%, ${answered} of ${capacity} answers in`}
      />
      <span className="text-footnote tabular-nums text-label-secondary md:w-40 md:shrink-0 md:text-right">
        {answered} of {capacity} answers in
      </span>
    </div>
  );
}
