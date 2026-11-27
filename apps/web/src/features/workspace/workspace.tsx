'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { BootScreen, ClosingScreen, ErrorScreen, LockScreen, ReceiptScreen } from './components/screens';
import { ExamShell } from './components/shell';
import { PreferencesProvider, readingVars, usePreferences } from './lib/preferences';
import { useAttemptSocket } from './lib/use-attempt-socket';
import { EngineContext, useAttemptEngine, useEngineSelector } from './lib/use-engine';

function ReadingRoot({ children }: { children: ReactNode }) {
  const { prefs } = usePreferences();
  // Keep the paper still when moving between short and long questions.
  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollbarGutter = 'stable';
    return () => {
      root.style.removeProperty('scrollbar-gutter');
    };
  }, []);
  return (
    <div className="min-h-dvh bg-bg text-label" style={readingVars(prefs) as CSSProperties}>
      {children}
    </div>
  );
}

function Phase() {
  const phase = useEngineSelector((s) => s.phase);
  switch (phase) {
    case 'booting':
      return <BootScreen />;
    case 'error':
      return <ErrorScreen />;
    case 'locked':
      return <LockScreen />;
    case 'submitted':
      return <ReceiptScreen />;
    case 'sealed':
    case 'finalizing':
      return <ClosingScreen />;
    default:
      return <ExamShell />;
  }
}

/**
 * The candidate's exam workspace. One engine per attempt and tab keeps the work: journaled on this device
 * first, synced in the background, timed by the server.
 */
export function Workspace({ attemptId }: { attemptId: string }) {
  const engine = useAttemptEngine(attemptId);
  const live = useEngineSelector((s) => s.phase === 'ready' || s.phase === 'sealed' || s.phase === 'finalizing', engine);
  const title = useEngineSelector((s) => s.view?.examTitle ?? null, engine);
  useAttemptSocket(engine, live);

  useEffect(() => {
    if (title) document.title = `${title} – Athena`;
  }, [title]);

  return (
    <EngineContext.Provider value={engine}>
      <PreferencesProvider>
        <ReadingRoot>
          <Phase />
        </ReadingRoot>
      </PreferencesProvider>
    </EngineContext.Provider>
  );
}

/** Puts a class on <html> while mounted, so portalled sheets and dialogs see the workspace font variables. */
export function HtmlClass({ className }: { className: string }) {
  useEffect(() => {
    const classes = className.split(/\s+/).filter(Boolean);
    document.documentElement.classList.add(...classes);
    return () => document.documentElement.classList.remove(...classes);
  }, [className]);
  return null;
}
