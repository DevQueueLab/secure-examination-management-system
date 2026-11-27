'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { MarksRule } from '@/components/ui/marks-rule';
import { WrittenText } from '@/components/ui/written-text';
import l from './loader.module.css';

/* Read by loader.tsx on the server; keep the two names in step. */
const LOADER_COOKIE = 'athena_intro';
const STORAGE_KEY = 'athena:loader';
/** The loader never holds the page for less than this, or longer than MAX (both from navigation start). */
const MIN_MS = 1100;
const MAX_MS = 2400;
const WRITE_DELAY = 100;
const WRITE_MS = 1050;
const EXIT_MS = 640;

/* One verdict per page lifetime: StrictMode's second effect run must not read its own storage write as a repeat
   visit, and a later client-side return to the landing must not play it again. */
let verdict: 'show' | 'skip' | null = null;

function decide(): 'show' | 'skip' {
  if (verdict) return verdict;
  verdict = 'show';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) verdict = 'skip';
  try {
    // Arriving through the wordmark morph from /sign-in: the morph is the motion.
    if (document.documentElement.matches(':active-view-transition')) verdict = 'skip';
  } catch {
    /* selector unsupported: no view transitions either */
  }
  try {
    // The session began on another page and reached the landing inside the app.
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && new URL(nav.name).pathname !== '/') verdict = 'skip';
  } catch {
    /* no navigation timing: play */
  }
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') verdict = 'skip';
    else if (verdict === 'show') sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* storage blocked: play every time */
  }
  return verdict;
}

const PRINT = Array.from({ length: 16 }, (_, i) => i);

function Sheet({ className, progress }: { className?: string; progress: number }) {
  return (
    <div className={`${l.half} ${className ?? ''}`}>
      <div className={l.content}>
        <WrittenText text="Athena" className={l.word} delay={WRITE_DELAY} duration={WRITE_MS} />
        <div className={l.rule} data-theme="light">
          <MarksRule value={progress} label="Loading" valueText={`${Math.round(progress)}%`} settle={false} />
        </div>
      </div>
    </div>
  );
}

/**
 * The loader itself: the name writes itself on the marble ground while a Marks rule's needle follows the page's
 * own loading (the fonts, then the hero image decoded). Then a band of carmine exam-paper tape seals across the
 * screen and the sheet splits along it, revealing the hero beneath, which was painted all along. Decorative:
 * hidden from assistive technology, never focusable, never in the way of a click. Any key, click or wheel ends it
 * early. Without script a CSS animation clears it by 2.6 s.
 */
export function LoaderClient() {
  const root = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(6);
  const [gone, setGone] = useState(false);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (decide() === 'skip') {
      el.style.display = 'none';
      const id = window.setTimeout(() => setGone(true), 0);
      return () => window.clearTimeout(id);
    }

    el.setAttribute('data-js', '');
    try {
      document.cookie = `${LOADER_COOKIE}=1; path=/; SameSite=Lax`;
    } catch {
      /* cookies blocked: the server keeps sending the loader, and the session check still skips it */
    }

    const mountAt = performance.now();
    const timers: number[] = [];
    let readyAt = Number.POSITIVE_INFINITY;
    let exited = false;
    let cancelled = false;

    const exit = () => {
      if (exited || cancelled) return;
      exited = true;
      setProgress(100);
      el.setAttribute('data-phase', 'exit');
      timers.push(
        window.setTimeout(() => {
          verdict = 'skip';
          setGone(true);
        }, EXIT_MS + 60),
      );
    };
    const scheduleExit = () => {
      const at = Math.min(MAX_MS, Math.max(MIN_MS, mountAt + WRITE_DELAY + WRITE_MS + 120, readyAt + 380));
      timers.push(window.setTimeout(exit, Math.max(0, at - performance.now())));
    };

    timers.push(window.setTimeout(exit, Math.max(0, MAX_MS - mountAt)));
    const first = requestAnimationFrame(() => !exited && setProgress(24));

    const fonts: Promise<unknown> = document.fonts?.ready ?? Promise.resolve();
    void fonts
      .then(() => {
        if (!cancelled && !exited) setProgress(62);
        const img = document.querySelector<HTMLImageElement>('[data-scene="hero"] img');
        return img ? img.decode().catch(() => undefined) : undefined;
      })
      .then(() => {
        if (cancelled || exited) return;
        readyAt = performance.now();
        setProgress(100);
        scheduleExit();
      });

    const early = () => exit();
    window.addEventListener('keydown', early);
    window.addEventListener('pointerdown', early);
    window.addEventListener('wheel', early, { passive: true });
    window.addEventListener('touchmove', early, { passive: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
      for (const id of timers) window.clearTimeout(id);
      window.removeEventListener('keydown', early);
      window.removeEventListener('pointerdown', early);
      window.removeEventListener('wheel', early);
      window.removeEventListener('touchmove', early);
    };
  }, []);

  if (gone) return null;
  return (
    <div ref={root} className={l.loader} aria-hidden="true">
      <Sheet className={l.halfA} progress={progress} />
      <Sheet className={l.halfB} progress={progress} />
      <div className={l.tape}>
        <div className={l.print}>
          {PRINT.map((i) => (
            <span key={i}>SEALED EXAM PAPER</span>
          ))}
        </div>
      </div>
    </div>
  );
}
