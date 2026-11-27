'use client';

import type { WorkspacePreferences } from '@athena/shared';
import { Eye, EyeOff, Timer as TimerIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MarksRule } from '@/components/ui/marks-rule';
import { Tooltip } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/cn';
import { formatClock } from '@/features/candidate/format';
import { useEngine, useEngineSelector, useRemainingMs } from '../lib/use-engine';

const WARNINGS = [
  { ms: 10 * 60_000, title: '10 minutes left', description: 'Check any flagged questions.' },
  { ms: 5 * 60_000, title: '5 minutes left', description: 'Your answers save as you go.' },
  { ms: 60_000, title: '1 minute left', description: 'Your answers are submitted automatically when time is up.' },
] as const;

type Level = 'calm' | 'soon' | 'low' | 'urgent';

function levelOf(ms: number | null): Level {
  if (ms === null) return 'calm';
  if (ms <= 60_000) return 'urgent';
  if (ms <= 5 * 60_000) return 'low';
  if (ms <= 10 * 60_000) return 'soon';
  return 'calm';
}

function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

function minutesText(ms: number): string {
  if (ms <= 60_000) return clockText(ms);
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

function spoken(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (m || h) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  if (!h && m < 5) parts.push(`${s % 60} seconds`);
  return parts.join(' ');
}

const tone: Record<Level, string> = {
  calm: 'bg-fill-secondary text-label',
  soon: 'bg-warning-tint/60 text-warning-text',
  low: 'bg-warning-tint text-warning-text',
  urgent: 'bg-danger-tint text-danger-text',
};

/**
 * Time left, from the server's clock: the device clock never decides it. Warns at 10, 5 and 1 minutes with a
 * notification and a screen-reader announcement, whatever the display mode.
 */
export function Timer({ mode, compact = false }: { mode: WorkspacePreferences['timer']; compact?: boolean }) {
  const engine = useEngine();
  const deadlineAt = useEngineSelector((s) => s.deadlineAt);
  const startedAt = useEngineSelector((s) => s.view?.startedAt ?? null);
  const estimated = useEngineSelector((s) => s.clockEstimated);
  const remaining = useRemainingMs(engine, deadlineAt);
  const level = levelOf(remaining);
  const [revealed, setRevealed] = useState(false);
  const [spokenWarning, setSpokenWarning] = useState('');
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (remaining === null) return;
    const prev = last.current;
    last.current = remaining;
    // The first reading only sets the baseline, so a reload never repeats a passed warning.
    if (prev === null) return;
    for (const w of WARNINGS) {
      if (prev > w.ms && remaining <= w.ms && remaining > 0) {
        toast.warning(w.title, { description: w.description, duration: 8_000 });
        setSpokenWarning(`${w.title}. ${w.description}`);
      }
    }
  }, [remaining]);

  const hiddenByMode = mode === 'last5' && !revealed && (remaining === null || remaining > 5 * 60_000);
  const text = remaining === null ? '––:––' : mode === 'minimal' ? minutesText(remaining) : clockText(remaining);
  const endsAt = deadlineAt ? formatClock(deadlineAt) : null;
  const label = remaining === null ? 'Time remaining: syncing with Athena' : `Time remaining: ${spoken(remaining)}`;
  // The whole sitting, so the rule beside the numerals drains from full to empty as time runs out.
  const totalMs = startedAt && deadlineAt ? Date.parse(deadlineAt) - Date.parse(startedAt) : 0;
  const share = remaining !== null && totalMs > 0 ? Math.max(0, Math.min(1, remaining / totalMs)) : null;

  const body = hiddenByMode ? (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className="flex h-9 items-center gap-1.5 rounded-full bg-fill-secondary px-3 text-subheadline font-medium text-label-secondary transition-colors hover:bg-fill hover:text-label"
      aria-label="Show the time remaining"
    >
      <Eye aria-hidden className="size-4" />
      {!compact && 'Show time'}
    </button>
  ) : (
    <div
      role="timer"
      aria-label={label}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-full px-3 transition-colors duration-300',
        tone[level],
      )}
    >
      {share !== null ? (
        // The timer's own label already speaks the time; the rule is for the eye.
        <span aria-hidden className="w-16 max-sm:hidden">
          <MarksRule size="sm" marker="fill" value={share * 100} max={100} label="Time left" className="min-w-0" />
        </span>
      ) : null}
      <TimerIcon aria-hidden className={cn('size-4 shrink-0', level === 'calm' && 'text-label-secondary', share !== null && 'sm:hidden')} />
      <span className="text-callout font-semibold tabular-nums" data-numeric>
        {estimated && remaining !== null ? '≈ ' : ''}
        {text}
      </span>
      {mode === 'last5' && revealed && (remaining ?? 0) > 5 * 60_000 && (
        <button
          type="button"
          onClick={() => setRevealed(false)}
          className="-mr-1 flex size-7 items-center justify-center rounded-full text-label-tertiary hover:text-label"
          aria-label="Hide the time remaining"
        >
          <EyeOff aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <>
      <Tooltip
        content={
          estimated
            ? 'Estimated from this device until Athena reconnects. Athena’s clock decides the deadline.'
            : endsAt
              ? `Ends at ${endsAt}. Kept by Athena’s clock, so a wrong device clock can’t change it.`
              : 'Syncing time with Athena'
        }
      >
        <div className="flex">{body}</div>
      </Tooltip>
      <p className="sr-only" aria-live={level === 'urgent' ? 'assertive' : 'polite'} aria-atomic>
        {spokenWarning}
      </p>
    </>
  );
}
