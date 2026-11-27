'use client';

import type { ReactNode } from 'react';
import { ProgressBar } from '@/components/ui/progress';
import { cn } from '@/lib/cn';
import { useServerNow } from '../clock';
import { clockTime, dayTime, formatDuration, plural } from '../format';
import type { LiveMonitor } from '../types';

/** The exam window as a bar: how much of it has passed, and how long until it closes. */
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
      <ProgressBar
        className="w-24 shrink-0 sm:w-36"
        size="sm"
        value={elapsed}
        max={closes - opens}
        tone={now >= closes ? 'neutral' : closes - now < 15 * 60_000 ? 'warning' : 'info'}
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
}

interface KpiProps {
  counts: KpiCounts;
  active: KpiKey | null;
  onToggle: (key: KpiKey) => void;
}

/** Live counters. Each one doubles as a filter for the roster below (press again to clear). */
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
    <div role="group" aria-label="Live counts. Press one to filter the roster." className="flex divide-x divide-separator overflow-x-auto rounded-xl bg-surface scrollbar-none">
      {cells.map((c) => {
        const pressed = active === c.key;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(c.key)}
            className={cn(
              'group flex min-w-[9.5rem] flex-1 flex-col items-start px-4 py-3 text-left transition-colors duration-150 first:rounded-l-xl last:rounded-r-xl',
              'focus-visible:-outline-offset-2',
              pressed ? 'bg-accent-tint' : 'hover:bg-fill-secondary active:bg-fill',
            )}
          >
            <span className={cn('text-subheadline font-medium', pressed ? 'text-accent-text' : 'text-label-secondary')}>{c.label}</span>
            <span className="mt-0.5 text-title-2 tabular-nums text-label">{c.value}</span>
            <span className="text-footnote text-label-secondary">{c.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
