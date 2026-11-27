'use client';

import { CircleAlert, CloudOff, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { SyncStatus } from '../sync/engine';
import { useEngine, useEngineSelector } from '../lib/use-engine';

/** performance.now(), refreshed on an interval. */
export function usePerfNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => (typeof performance === 'undefined' ? 0 : performance.now()));
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m} min ago`;
}

type Kind = 'saved' | 'saving' | 'offline' | 'reconnecting' | 'failed';

interface Display {
  kind: Kind;
  text: string;
  short: string;
  unstable: boolean;
}

export function describeSync(sync: SyncStatus, now: number, durable: boolean): Display {
  const waiting = sync.dirtyAnswers;
  const unstable = sync.unstable && sync.state !== 'offline';
  if (sync.state === 'offline' || !sync.online) {
    const where = durable ? 'saved on this device' : 'kept in this tab';
    return {
      kind: 'offline',
      text: waiting ? `Offline. ${waiting} ${waiting === 1 ? 'answer' : 'answers'} ${where}` : `Offline. Your work is ${where}`,
      short: 'Offline',
      unstable: false,
    };
  }
  if (sync.state === 'failed') {
    const secs = sync.retryAt ? Math.max(1, Math.ceil((sync.retryAt - now) / 1000)) : null;
    return { kind: 'failed', text: secs ? `Sync failed. Retrying in ${secs}s` : 'Sync failed. Retrying', short: 'Retrying', unstable };
  }
  if (sync.state === 'reconnecting') return { kind: 'reconnecting', text: 'Reconnecting…', short: 'Reconnecting', unstable };
  if (sync.sending || waiting > 0 || sync.dirtyPages > 0) return { kind: 'saving', text: 'Saving…', short: 'Saving', unstable };
  return {
    kind: 'saved',
    text: sync.lastSavedAt === null ? 'All changes saved' : `All changes saved ${ago(now - sync.lastSavedAt)}`,
    short: 'Saved',
    unstable,
  };
}

const dotTone: Record<Kind, string> = {
  saved: 'bg-success',
  saving: 'bg-accent',
  offline: 'bg-warning',
  reconnecting: 'bg-warning',
  failed: 'bg-danger',
};

/** Connection and save state. Pressing it saves now. */
export function SyncPill({ compact = false }: { compact?: boolean }) {
  const engine = useEngine();
  const sync = useEngineSelector((s) => s.sync);
  const durable = useEngineSelector((s) => s.durable);
  const now = usePerfNow(1_000);
  const d = describeSync(sync, now, durable);
  const rtt = sync.rttMs === null ? null : Math.round(sync.rttMs);

  const icon =
    d.kind === 'saving' || d.kind === 'reconnecting' ? (
      <Spinner size={14} label={null} className="text-label-secondary" />
    ) : d.kind === 'offline' ? (
      <CloudOff aria-hidden className="size-4 text-warning-text" />
    ) : d.kind === 'failed' ? (
      <CircleAlert aria-hidden className="size-3.5 text-danger-text" />
    ) : d.unstable ? (
      <TriangleAlert aria-hidden className="size-3.5 text-warning-text" />
    ) : (
      <span aria-hidden className={cn('size-2 rounded-full', dotTone[d.kind])} />
    );

  const details = [
    d.unstable ? 'The connection is unstable, but answers still save on this device first.' : null,
    rtt !== null ? `Round trip ${rtt} ms.` : null,
    sync.pendingEvents ? `${sync.pendingEvents} activity ${sync.pendingEvents === 1 ? 'record' : 'records'} waiting.` : null,
    durable ? 'Every change is stored on this device before it is sent.' : 'This browser can’t store answers offline, so stay connected.',
    'Press to save now.',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tooltip content={details}>
      <button
        type="button"
        onClick={() => void engine.flush('manual')}
        aria-label={`${d.text}${d.unstable ? '. Connection unstable' : ''}${rtt !== null ? `. Round trip ${rtt} milliseconds` : ''}. Save now`}
        className={cn(
          'flex h-9 min-w-9 items-center justify-center gap-2 rounded-full px-3 text-subheadline font-medium transition-colors',
          'hover:bg-fill-secondary focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-offset-2 focus-visible:outline-focus',
          d.kind === 'offline' && 'bg-warning-tint text-warning-text hover:bg-warning-tint',
          d.kind === 'failed' && 'bg-danger-tint text-danger-text hover:bg-danger-tint',
          (d.kind === 'saved' || d.kind === 'saving' || d.kind === 'reconnecting') && 'text-label-secondary',
          compact && 'px-0 max-sm:size-11 sm:px-3',
        )}
      >
        <span className="flex size-4 items-center justify-center">{icon}</span>
        <span className={cn('whitespace-nowrap', compact && 'sr-only sm:not-sr-only')} data-numeric>
          {compact ? d.short : d.text}
        </span>
        {!compact && d.unstable && d.kind !== 'failed' ? <span className="whitespace-nowrap text-warning-text">Connection unstable</span> : null}
        {!compact && rtt !== null && d.kind === 'saved' && !d.unstable ? (
          <span className="whitespace-nowrap text-label-tertiary max-xl:hidden" data-numeric>
            {rtt} ms
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}
