'use client';

import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { probeIndexedDb } from '@/features/workspace/sync/journal';
import { measureServerClock } from './api';
import { formatOffset } from './format';

type State = 'checking' | 'ok' | 'warn' | 'fail';

interface Check {
  id: string;
  label: string;
  state: State;
  detail: string;
}

const icon: Record<State, React.ReactNode> = {
  checking: <Spinner size={16} label={null} className="text-label-tertiary" />,
  ok: <CircleCheck aria-hidden className="size-4 text-success" />,
  warn: <CircleAlert aria-hidden className="size-4 text-warning" />,
  fail: <CircleX aria-hidden className="size-4 text-danger" />,
};

const stateWord: Record<State, string> = { checking: 'Checking', ok: 'Ready', warn: 'Warning', fail: 'Problem' };

export interface SystemCheckResult {
  apiReachable: boolean;
  storage: boolean;
}

/** Device check before an exam: API round trip, local answer storage, full screen, and the device clock. */
export function SystemCheck({ requireFullscreen, onResult }: { requireFullscreen: boolean; onResult?: (r: SystemCheckResult) => void }) {
  const [checks, setChecks] = useState<Check[]>(() => initial(requireFullscreen));
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setChecks(initial(requireFullscreen));
    const update = (id: string, patch: Partial<Check>) => setChecks((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));

    const fullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;
    update('fullscreen', {
      state: fullscreen ? 'ok' : requireFullscreen ? 'warn' : 'ok',
      detail: fullscreen
        ? requireFullscreen
          ? 'This exam opens in full screen. Press Esc only if you need to leave it.'
          : 'Available if you want a distraction-free view'
        : requireFullscreen
          ? 'This browser can’t enter full screen. You can still take the exam; leaving full screen can’t be detected.'
          : 'Not available in this browser, and not required',
    });

    const [storage, clock] = await Promise.allSettled([probeIndexedDb(), measureServerClock(3)]);
    const storageOk = storage.status === 'fulfilled' && storage.value;
    update('storage', {
      state: storageOk ? 'ok' : 'warn',
      detail: storageOk
        ? 'Answers are kept on this device as you type, even offline'
        : 'This browser can’t keep answers offline (private window?). Answers still save while you’re connected.',
    });
    if (clock.status === 'fulfilled') {
      const rtt = Math.round(clock.value.rttMs);
      update('api', {
        state: rtt > 1500 ? 'warn' : 'ok',
        detail: rtt > 1500 ? `Slow connection (${rtt} ms). Your answers still save on this device first.` : `Connected, ${rtt} ms round trip`,
      });
      const deviceMinusServer = -clock.value.offsetMs;
      update('clock', {
        state: 'ok',
        detail:
          Math.abs(deviceMinusServer) < 1000
            ? 'Your device clock is in step with Athena. Your time is kept by the server either way.'
            : `Your device clock is ${formatOffset(deviceMinusServer)}. That’s fine: your device clock does not affect your time.`,
      });
    } else {
      update('api', { state: 'fail', detail: 'Can’t reach Athena. Check your connection before you start.' });
      update('clock', { state: 'warn', detail: 'Checked once you’re connected. Your device clock does not affect your time.' });
    }
    onResult?.({ apiReachable: clock.status === 'fulfilled', storage: storageOk });
    setRunning(false);
  }, [requireFullscreen, onResult]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-headline text-label">System check</h3>
        <Button variant="plain" size="sm" onClick={() => void run()} loading={running} disabled={running} aria-label="Run the system check again" className="max-md:h-11">
          Re-check
        </Button>
      </div>
      <ul className="flex flex-col gap-3" aria-live="polite">
        {checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">{icon[c.state]}</span>
            <div className="min-w-0">
              <p className="text-callout font-medium text-label">
                {c.label}
                <span className="sr-only">: {stateWord[c.state]}</span>
              </p>
              <p className="text-footnote text-label-secondary">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function initial(requireFullscreen: boolean): Check[] {
  return [
    { id: 'api', label: 'Connection to Athena', state: 'checking', detail: 'Measuring the round trip…' },
    { id: 'storage', label: 'Answers saved on this device', state: 'checking', detail: 'Checking local storage…' },
    { id: 'fullscreen', label: requireFullscreen ? 'Full screen (required)' : 'Full screen', state: 'checking', detail: 'Checking…' },
    { id: 'clock', label: 'Device clock', state: 'checking', detail: 'Comparing with Athena’s clock…' },
  ];
}
