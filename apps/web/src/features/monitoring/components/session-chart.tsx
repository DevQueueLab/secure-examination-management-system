'use client';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { clockTime, eventDetail, eventLabel, formatDuration } from '../format';
import type { AttemptTimeline, ConnectivitySegment, MonitorEvent } from '../types';

const SEVERITY_FILL: Record<string, string> = { low: 'bg-label-secondary', medium: 'bg-warning', high: 'bg-danger' };

const SEGMENT_FILL: Record<string, string> = {
  'online:reported': 'bg-label-tertiary',
  'offline:reported': 'bg-warning',
  'offline:heartbeat': 'bg-warning/45',
};

function segmentLabel(s: ConnectivitySegment): string {
  const span = `${clockTime(s.from, true)} to ${clockTime(s.to, true)} (${formatDuration(Date.parse(s.to) - Date.parse(s.from))})`;
  if (s.state === 'online') return `Online ${span}`;
  return s.source === 'heartbeat' ? `No heartbeat ${span}` : `Offline ${span}`;
}

/**
 * The attempt on one time axis: answered questions (step line), connection (bar) and indicators (marks).
 * Shapes are positioned in percent of the session, so the chart reflows with the drawer.
 */
export function SessionChart({ timeline, now, onSelectEvent }: { timeline: AttemptTimeline; now: number; onSelectEvent?: (e: MonitorEvent) => void }) {
  const { attempt, connectivity, progress, events } = timeline;
  const start = Date.parse(attempt.startedAt);
  const lastSegment = connectivity.at(-1);
  const end = Math.max(
    attempt.submittedAt ? Date.parse(attempt.submittedAt) : Date.parse(attempt.deadlineAt),
    lastSegment ? Date.parse(lastSegment.to) : start + 60_000,
    start + 60_000,
  );
  const span = end - start;
  const x = (t: string | number) => Math.min(100, Math.max(0, ((typeof t === 'number' ? t : Date.parse(t)) - start) / span) * 100);
  const live = attempt.status !== 'submitted' && now < end;
  const total = Math.max(1, attempt.itemCount);

  // Step line: hold each count until the next answer.
  let d = '';
  progress.forEach((p, i) => {
    const px = x(p.at) * 10;
    const py = 100 - (Math.min(p.answered, total) / total) * 92;
    if (i === 0) d += `M${px},${py}`;
    else d += `H${px}V${py}`;
  });
  const endPct = live ? x(now) : 100;
  const lastX = endPct * 10;
  d += `H${lastX}`;
  const lastPoint = progress.at(-1);
  const endY = lastPoint ? 100 - (Math.min(lastPoint.answered, total) / total) * 92 : 100;
  const area = `${d}V100H${(x(progress[0]?.at ?? start) * 10).toFixed(1)}Z`;
  const indicators = events.filter((e) => e.severity !== 'info');
  const offline = connectivity.filter((s) => s.state === 'offline');
  const offlineMs = offline.reduce((sum, s) => sum + Date.parse(s.to) - Date.parse(s.from), 0);
  const connectionSummary = offline.length
    ? `Offline ${offline.length === 1 ? 'once' : `${offline.length} times`}, ${formatDuration(offlineMs)} in total`
    : 'Connected throughout';

  return (
    <figure className="flex flex-col gap-2" aria-label="Session timeline">
      <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-footnote text-label-secondary">
        <span>Answered</span>
        <div className="relative h-12">
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            <path d={area} className="fill-accent/10" />
            <path d={d} className="fill-none stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {/* The count sits at the end of the line; once the line nears the right edge it moves to the corner. */}
          <span
            className="absolute rounded bg-surface-raised/80 px-1 text-caption font-semibold tabular-nums text-label"
            style={
              endPct <= 80
                ? { left: `calc(${endPct}% + 0.375rem)`, top: `clamp(0rem, calc(${endY}% - 0.5rem), calc(100% - 1rem))` }
                : { right: 0, top: '-0.125rem' }
            }
          >
            {attempt.answeredCount}/{attempt.itemCount}
          </span>
        </div>

        <span>Connection</span>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-fill">
          {connectivity.map((s) => (
            <Tooltip key={`${s.from}-${s.state}`} content={segmentLabel(s)}>
              <span
                tabIndex={-1}
                className={cn('absolute inset-y-0', SEGMENT_FILL[`${s.state}:${s.source}`] ?? 'bg-label-tertiary')}
                style={{ left: `${x(s.from)}%`, width: `${Math.max(0.4, x(s.to) - x(s.from))}%` }}
              />
            </Tooltip>
          ))}
        </div>

        <span>Indicators</span>
        <div className="relative h-4">
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-separator" />
          {indicators.length === 0 && <span className="absolute inset-0 flex items-center pl-1 text-caption text-label-secondary">None</span>}
          {indicators.map((e) => {
            const detail = eventDetail(e);
            const text = `${eventLabel(e.type)}${detail ? `, ${detail}` : ''} at ${clockTime(e.createdAt, true)}`;
            return (
              <Tooltip key={e.id} content={text}>
                <button
                  type="button"
                  aria-label={text}
                  onClick={() => onSelectEvent?.(e)}
                  className={cn(
                    'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-raised transition-transform hover:scale-150 focus-visible:scale-150',
                    SEVERITY_FILL[e.severity],
                    e.review && e.review.status !== 'open' && 'opacity-40',
                  )}
                  style={{ left: `${x(e.createdAt)}%` }}
                />
              </Tooltip>
            );
          })}
        </div>

        <span />
        {/* Near either end the "now" label takes that end's place; the facts above still give the start and the time left. */}
        <div className="relative h-4 text-caption tabular-nums text-label-secondary">
          {(!live || x(now) > 25) && <span className="absolute left-0">{clockTime(start)}</span>}
          {live && (
            <span className="absolute -translate-x-1/2 font-semibold text-label" style={{ left: `${Math.min(94, Math.max(6, x(now)))}%` }}>
              now
            </span>
          )}
          {(!live || x(now) < 75) && <span className="absolute right-0">{clockTime(end)}</span>}
        </div>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 pl-[5.5rem] text-caption text-label-secondary">
        <span className={cn('basis-full text-footnote', offline.length ? 'text-warning-text' : 'text-label-secondary')}>{connectionSummary}</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-label-tertiary" />
          Online
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-warning" />
          Reported offline
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-warning/45" />
          No heartbeat
        </span>
      </figcaption>
    </figure>
  );
}
