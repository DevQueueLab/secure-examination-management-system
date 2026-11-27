'use client';

import { Info } from 'lucide-react';
import { Badge, StatusDot, type Tone } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useNow, useServerNow } from '../clock';
import { INDICATOR_NOTICE, PRIORITY_LABEL, PRIORITY_TONE, SILENT_AFTER_MS, SUBMIT_REASON_LABEL, clockTime, countdown, formatDuration } from '../format';
import type { LiveAttempt, ReviewPriority } from '../types';

/** A browser counts as online while its heartbeat is fresh, re-checked every second between pushes. */
export function isLive(a: Pick<LiveAttempt, 'status' | 'online' | 'lastSeenAt'>, now: number): boolean {
  if (a.status !== 'in_progress' || !a.online || !a.lastSeenAt) return false;
  return now - Date.parse(a.lastSeenAt) < SILENT_AFTER_MS;
}

/** Slow enough that the candidate will feel it when saving. */
const SLOW_RTT_MS = 800;

export type ConnectionState = 'online' | 'slow' | 'offline' | 'idle' | 'syncing';

export function connectionOf(a: LiveAttempt, now: number): ConnectionState {
  if (a.status === 'awaiting_sync') return 'syncing';
  if (a.status !== 'in_progress') return 'idle';
  if (!isLive(a, now)) return 'offline';
  return a.rttMs !== null && a.rttMs > SLOW_RTT_MS ? 'slow' : 'online';
}

const CONNECTION_TONE: Record<ConnectionState, Tone> = { online: 'success', slow: 'warning', offline: 'warning', idle: 'neutral', syncing: 'info' };

/** Status dot plus words: "84 ms", "Slow, 1.2 s", "Offline 3 min". Colour is never the only signal. */
export function ConnectionStatus({ attempt, compact = false }: { attempt: LiveAttempt; compact?: boolean }) {
  const now = useServerNow();
  const state = connectionOf(attempt, now);
  if (state === 'idle') return <span className="text-label-tertiary">—</span>;
  const rtt = attempt.rttMs;
  const silentFor = attempt.lastSeenAt ? now - Date.parse(attempt.lastSeenAt) : null;
  const text =
    state === 'online'
      ? rtt !== null
        ? `${rtt} ms`
        : 'Online'
      : state === 'slow'
        ? `Slow, ${(rtt! / 1000).toFixed(1)} s`
        : state === 'syncing'
          ? 'Syncing'
          : silentFor !== null
            ? `Offline ${formatDuration(silentFor)}`
            : 'Not connected';
  const hint =
    state === 'online'
      ? 'Connected. Round trip of the last save.'
      : state === 'slow'
        ? 'Connected, but saves take a while. Answers still save and queue offline if needed.'
        : state === 'syncing'
          ? 'The deadline passed while offline. Answers saved offline are held for review.'
          : `No heartbeat since ${attempt.lastSeenAt ? clockTime(attempt.lastSeenAt, true) : 'the start'}. Answers keep saving on the device.`;
  return (
    <Tooltip content={hint}>
      <span tabIndex={0} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm tabular-nums', compact ? 'text-footnote' : 'text-subheadline')}>
        <StatusDot tone={CONNECTION_TONE[state]} />
        <span className={cn(state === 'offline' ? 'font-medium text-warning-text' : 'text-label-secondary')}>{text}</span>
      </span>
    </Tooltip>
  );
}

/** Time left on the server deadline, or what happened instead. */
export function TimeLeft({ attempt, size = 'md' }: { attempt: LiveAttempt; size?: 'md' | 'lg' }) {
  const now = useServerNow();
  if (attempt.status === 'submitted') {
    const reason = attempt.submitReason ? SUBMIT_REASON_LABEL[attempt.submitReason] : 'Submitted';
    return (
      <span className="flex flex-col leading-tight">
        <span className={cn('text-label-secondary', size === 'lg' ? 'text-headline' : 'text-subheadline')}>{reason}</span>
        {attempt.submittedAt && <span className="text-footnote text-label-secondary tabular-nums">{clockTime(attempt.submittedAt)}</span>}
      </span>
    );
  }
  if (attempt.status === 'awaiting_sync') return <span className="text-subheadline text-info-text">Waiting for sync</span>;
  const left = Date.parse(attempt.deadlineAt) - now;
  const tone = left <= 60_000 ? 'text-danger-text' : left <= 5 * 60_000 ? 'text-warning-text' : 'text-label';
  const extended = attempt.timeExtensionSeconds > 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      <time
        dateTime={attempt.deadlineAt}
        className={cn('font-semibold tabular-nums', tone, size === 'lg' ? 'text-title-2' : 'text-callout')}
        aria-label={left > 0 ? `${formatDuration(left)} left, deadline ${clockTime(attempt.deadlineAt)}` : 'Time is up'}
      >
        {left > 0 ? countdown(left) : '0:00'}
      </time>
      {extended && (
        <Tooltip content={`Extended by ${formatDuration(attempt.timeExtensionSeconds * 1000)} in total`}>
          <span tabIndex={0} className="rounded-full bg-info-tint px-1.5 text-caption font-semibold leading-4 text-info-text tabular-nums">
            +{Math.round(attempt.timeExtensionSeconds / 60)}m
          </span>
        </Tooltip>
      )}
    </span>
  );
}

export function PriorityPill({ priority, size = 'sm' }: { priority: ReviewPriority; size?: 'sm' | 'md' }) {
  if (priority === 'none') return <span className="text-label-tertiary">—</span>;
  return (
    <Badge tone={PRIORITY_TONE[priority]} size={size}>
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

/** The fixed framing for every place indicators appear. */
export function IndicatorNotice({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-start gap-2.5 rounded-xl bg-info-tint px-3.5 py-2.5 text-subheadline text-info-text', className)}>
      <Info aria-hidden className="mt-px size-4 shrink-0" />
      <span>{INDICATOR_NOTICE}</span>
    </p>
  );
}

/** "Live" while the socket is connected, "Polling" while the page falls back to refreshing. */
export function LiveIndicator({ connected, updatedAt, unreachable = false }: { connected: boolean; updatedAt: number; unreachable?: boolean }) {
  const now = useNow(); // dataUpdatedAt is a local timestamp, so the age is measured on the local clock
  const age = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  // Refreshing failed but the last data is still on screen: say how old it is rather than hiding it.
  const mode = unreachable ? 'reconnecting' : connected ? 'live' : 'polling';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-subheadline">
      {/* Only the mode change is announced; the ticking age below is not. */}
      <span role="status">
        <Badge tone={mode === 'live' ? 'success' : mode === 'reconnecting' ? 'warning' : 'neutral'} dot>
          {mode === 'live' ? 'Live' : mode === 'reconnecting' ? 'Reconnecting' : 'Polling'}
        </Badge>
      </span>
      {mode === 'reconnecting' ? (
        <span className="text-warning-text tabular-nums">Can’t reach the server. Showing data from {clockTime(updatedAt, true)}.</span>
      ) : (
        <>
          <span className="text-label-secondary">{mode === 'live' ? 'Updates arrive as they happen' : 'Refreshing every 10 s'}</span>
          {age !== null && age > 2 && (
            <span className="hidden text-label-secondary tabular-nums sm:inline">Updated {age < 60 ? `${age} s` : `${Math.round(age / 60)} min`} ago</span>
          )}
        </>
      )}
    </div>
  );
}
