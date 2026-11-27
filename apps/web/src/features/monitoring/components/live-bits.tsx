'use client';

import { Info } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/motion';
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

/** Four ascending ticks, like the rule: how much of the connection is there. Words beside it carry the meaning. */
function SignalTicks({ level, warn }: { level: number; warn: boolean }) {
  return (
    <svg viewBox="0 0 13 11" className="h-[11px] w-[13px] shrink-0" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={i * 3.5}
          y={8 - i * 2.5}
          width={2}
          height={3 + i * 2.5}
          rx={0.5}
          className={i < level ? (warn ? 'fill-warning' : 'fill-label') : 'fill-label-tertiary opacity-50'}
        />
      ))}
    </svg>
  );
}

function signalLevel(state: ConnectionState, rtt: number | null): number {
  if (state === 'offline' || state === 'syncing') return 0;
  if (state === 'slow') return 1;
  if (rtt === null || rtt < 200) return 4;
  return rtt < 450 ? 3 : 2;
}

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
        <SignalTicks level={signalLevel(state, rtt)} warn={state === 'slow' || state === 'offline'} />
        <span className={cn(state === 'offline' ? 'font-medium text-warning-text' : 'text-label-secondary')}>{text}</span>
      </span>
    </Tooltip>
  );
}

/** Time left on the server deadline, or what happened instead. */
export function TimeLeft({ attempt, size = 'md' }: { attempt: LiveAttempt; size?: 'md' | 'lg' }) {
  const now = useServerNow();
  const reduced = useReducedMotion();
  // More time lands visibly: a "+10 min" flies down into the clock, and the clock ticks over to the new time.
  const ext = attempt.timeExtensionSeconds;
  const [seenExt, setSeenExt] = useState(ext);
  const [flight, setFlight] = useState<{ key: number; minutes: number } | null>(null);
  if (ext !== seenExt) {
    setSeenExt(ext);
    if (ext > seenExt && !reduced) setFlight({ key: ext, minutes: Math.max(1, Math.round((ext - seenExt) / 60)) });
  }
  if (attempt.status === 'submitted') {
    const reason = attempt.submitReason ? SUBMIT_REASON_LABEL[attempt.submitReason] : 'Submitted';
    return (
      <span className="flex flex-col leading-tight">
        <span className={cn('text-label-secondary', size === 'lg' ? 'text-headline' : 'text-subheadline')}>{reason}</span>
        {attempt.submittedAt && <span className="text-footnote text-label-secondary tabular-nums">{clockTime(attempt.submittedAt)}</span>}
      </span>
    );
  }
  if (attempt.status === 'awaiting_sync') return <span className="text-subheadline text-label-secondary">Waiting for sync</span>;
  const left = Date.parse(attempt.deadlineAt) - now;
  const tone = left <= 60_000 ? 'text-danger-text' : left <= 5 * 60_000 ? 'text-warning-text' : 'text-label';
  const extended = attempt.timeExtensionSeconds > 0;
  return (
    <span className="relative inline-flex items-center gap-1.5">
      <motion.time
        // A new deadline remounts the reading, which drops into place as the flying minutes arrive.
        key={attempt.deadlineAt}
        initial={flight ? { y: -8 } : false}
        animate={{ y: 0 }}
        transition={{ type: 'spring', bounce: 0.35, visualDuration: 0.3, delay: 0.14 }}
        dateTime={attempt.deadlineAt}
        className={cn('tabular-nums', tone, size === 'lg' ? 'numeral text-[2rem] leading-none' : 'text-callout font-medium')}
        aria-label={left > 0 ? `${formatDuration(left)} left, deadline ${clockTime(attempt.deadlineAt)}` : 'Time is up'}
      >
        {left > 0 ? countdown(left) : '0:00'}
      </motion.time>
      {flight && (
        <motion.span
          key={flight.key}
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-full left-0 whitespace-nowrap font-semibold text-accent-text tabular-nums',
            size === 'lg' ? 'text-headline' : 'text-caption',
          )}
          initial={{ opacity: 0, y: -6, scale: 1.1 }}
          animate={{ opacity: [0, 1, 1, 0], y: [-6, -2, 8, 16], scale: [1.1, 1, 0.9, 0.7] }}
          transition={{ duration: 0.42, times: [0, 0.25, 0.7, 1], ease: 'easeIn' }}
          onAnimationComplete={() => setFlight(null)}
        >
          +{flight.minutes} min
        </motion.span>
      )}
      {extended && (
        <Tooltip content={`Extended by ${formatDuration(attempt.timeExtensionSeconds * 1000)} in total`}>
          <span tabIndex={0} className="rounded-full bg-fill px-1.5 text-caption font-semibold leading-4 text-label-secondary tabular-nums">
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
    <p className={cn('flex items-start gap-2.5 border-y border-separator py-2.5 text-subheadline text-label-secondary', className)}>
      <Info aria-hidden className="mt-px size-4 shrink-0 text-label" />
      <span>{INDICATOR_NOTICE}</span>
    </p>
  );
}

/** "Connected" while the socket is up, "Polling" while the page falls back to refreshing, "Reconnecting" when refreshes fail. */
export function LiveIndicator({ connected, updatedAt, unreachable = false }: { connected: boolean; updatedAt: number; unreachable?: boolean }) {
  const now = useNow(); // dataUpdatedAt is a local timestamp, so the age is measured on the local clock
  const age = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  // Refreshing failed but the last data is still on screen: say how old it is rather than hiding it.
  const mode = unreachable ? 'reconnecting' : connected ? 'live' : 'polling';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-subheadline">
      {/* Only the mode change is announced; the ticking age below is not. */}
      <span role="status" className={cn('inline-flex items-center gap-2 font-medium', mode === 'reconnecting' ? 'text-warning-text' : 'text-label')}>
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            mode === 'live' ? 'bg-label' : mode === 'reconnecting' ? 'bg-warning' : 'ring-1 ring-inset ring-label-secondary',
          )}
        />
        {mode === 'live' ? 'Connected' : mode === 'reconnecting' ? 'Reconnecting' : 'Polling'}
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
