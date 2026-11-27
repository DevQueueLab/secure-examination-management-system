'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AttemptEngine, type EngineSnapshot } from '../sync/engine';
import { openJournal } from '../sync/journal';
import { createTransport } from './transport';

/**
 * One engine per attempt per tab. Mounts retain it and unmounts release it after a short delay, so React's
 * StrictMode remount (and a fast route change back) reuses the same engine instead of booting twice.
 */
interface Entry {
  engine: AttemptEngine;
  refs: number;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

const registry = new Map<string, Entry>();

function scheduleDispose(attemptId: string, entry: Entry, ms: number) {
  if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
  entry.disposeTimer = setTimeout(() => {
    if (entry.refs > 0) return;
    entry.engine.dispose();
    if (registry.get(attemptId) === entry) registry.delete(attemptId);
  }, ms);
}

function getEngine(attemptId: string): AttemptEngine {
  let entry = registry.get(attemptId);
  if (!entry || entry.engine.isDisposed) {
    entry = {
      engine: new AttemptEngine({ attemptId, transport: createTransport(), openJournal, browser: true }),
      refs: 0,
      disposeTimer: null,
    };
    registry.set(attemptId, entry);
    // A render that never commits must not leave an engine running.
    scheduleDispose(attemptId, entry, 5_000);
  }
  return entry.engine;
}

/** The attempt engine for this tab, started on mount. */
export function useAttemptEngine(attemptId: string): AttemptEngine {
  const [engine, setEngine] = useState(() => getEngine(attemptId));
  useEffect(() => {
    let current = engine;
    if (current.isDisposed || current.attemptId !== attemptId) {
      current = getEngine(attemptId);
      setEngine(current);
    }
    const entry = registry.get(attemptId);
    if (!entry) return;
    entry.refs += 1;
    if (entry.disposeTimer) {
      clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    void current.start();
    return () => {
      entry.refs -= 1;
      if (entry.refs <= 0) scheduleDispose(attemptId, entry, 1_500);
    };
  }, [attemptId, engine]);
  return engine;
}

export const EngineContext = createContext<AttemptEngine | null>(null);

export function useEngine(): AttemptEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine must be used inside the exam workspace');
  return engine;
}

/** Subscribes to a slice of the engine snapshot. Selectors must return primitives or existing references. */
export function useEngineSelector<T>(selector: (snapshot: EngineSnapshot) => T, engineArg?: AttemptEngine): T {
  const fromContext = useContext(EngineContext);
  const engine = engineArg ?? fromContext;
  if (!engine) throw new Error('useEngineSelector needs an engine');
  return useSyncExternalStore(
    engine.subscribe,
    () => selector(engine.getSnapshot()),
    () => selector(engine.getSnapshot()),
  );
}

/** Server-time milliseconds left, re-rendering on each whole-second boundary. Null until the clock is anchored. */
export function useRemainingMs(engine: AttemptEngine, deadlineAt: string | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(() => engine.clock.remainingMs(deadlineAt));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      const value = engine.clock.remainingMs(deadlineAt);
      setRemaining(value);
      // Wake just after the next whole second so the display never lags a second behind.
      const delay = value === null ? 500 : ((value % 1000) + 1000) % 1000 || 1000;
      timer = setTimeout(loop, Math.min(1000, delay + 8));
    };
    loop();
    return () => clearTimeout(timer);
  }, [engine, deadlineAt]);
  return remaining;
}
