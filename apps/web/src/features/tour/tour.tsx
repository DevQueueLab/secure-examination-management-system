'use client';

import { animate, motion, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { MarksRule } from '@/components/ui/marks-rule';
import { useAuth } from '@/lib/auth';
import { spring, useReducedMotion } from '@/lib/motion';
import { tourFor, type TourContext, type TourStep } from './tours';

type Rect = { x: number; y: number; w: number; h: number };

interface TourApi {
  /** Start the signed-in person's tour, from the step for the current page when there is one. */
  start: () => void;
  stop: () => void;
  active: boolean;
}

const TourCtx = createContext<TourApi | null>(null);

export function useTour(): TourApi {
  return useContext(TourCtx) ?? { start: () => {}, stop: () => {}, active: false };
}

const storeKey = (userId: string) => `athena.tour.${userId}`;
function markDone(userId: string) {
  try {
    window.localStorage.setItem(storeKey(userId), 'done');
  } catch {
    /* storage blocked: the welcome card simply returns next visit */
  }
}
function isDone(userId: string): boolean {
  try {
    return window.localStorage.getItem(storeKey(userId)) !== null;
  } catch {
    return true;
  }
}

/** Pages where nothing may interrupt: an exam in progress. */
const QUIET_PATHS = /^\/(take|attempt)(\/|$)/;
const PAD = 8;
const WAIT_MS = 4000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isVisible(el: Element) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function findTarget(selectors: string[]): Element | null {
  for (const s of selectors) {
    let list: NodeListOf<Element>;
    try {
      list = document.querySelectorAll(s);
    } catch {
      continue;
    }
    for (const el of list) if (isVisible(el) && !el.closest('[data-tour-ui]')) return el;
  }
  return null;
}

/** Resolve once a selector matches, or with null after the timeout. */
function waitForTarget(
  selectors: string[],
  signal: { cancelled: boolean },
  ms = WAIT_MS,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const hit = findTarget(selectors);
    if (hit) return resolve(hit);
    const finish = (el: Element | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    };
    const observer = new MutationObserver(() => {
      if (signal.cancelled) return finish(null);
      const el = findTarget(selectors);
      if (el) finish(el);
    });
    const timer = setTimeout(() => finish(findTarget(selectors)), ms);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}

async function waitForPath(path: string, signal: { cancelled: boolean }) {
  const until = Date.now() + WAIT_MS;
  while (!signal.cancelled && window.location.pathname !== path && Date.now() < until)
    await sleep(50);
  // Let the new page render its first frame before looking for targets on it.
  await sleep(120);
}

/** Card position beside the spotlight, kept inside the viewport. */
function placeCard(rect: Rect | null, card: { w: number; h: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 16;
  const gap = 14;
  if (!rect) return { x: (vw - card.w) / 2, y: Math.max(m, (vh - card.h) / 2) };
  const below = rect.y + rect.h + gap;
  const above = rect.y - gap - card.h;
  let x = rect.x;
  let y: number;
  if (below + card.h <= vh - m) y = below;
  else if (above >= m) y = above;
  else {
    const right = rect.x + rect.w + gap;
    const left = rect.x - gap - card.w;
    x = right + card.w <= vw - m ? right : left >= m ? left : (vw - card.w) / 2;
    y = rect.y + rect.h / 2 - card.h / 2;
  }
  return {
    x: Math.min(vw - m - card.w, Math.max(m, x)),
    y: Math.min(vh - m - card.h, Math.max(m, y)),
  };
}

function useSpringTo(reduced: boolean) {
  return useCallback(
    (mv: MotionValue<number>, to: number) => {
      if (reduced) mv.set(to);
      else animate(mv, to, spring.sheet);
    },
    [reduced],
  );
}

function TourOverlay({
  step,
  index,
  count,
  rect,
  onNext,
  onBack,
  onStop,
}: {
  step: TourStep;
  index: number;
  count: number;
  rect: Rect | null;
  onNext: () => void;
  onBack: () => void;
  onStop: () => void;
}) {
  const reduced = useReducedMotion();
  const to = useSpringTo(reduced);
  const sx = useMotionValue(0);
  const sy = useMotionValue(0);
  const sw = useMotionValue(0);
  const sh = useMotionValue(0);
  const ring = useMotionValue(0);
  // Springs overshoot; a rect may never be drawn with a negative size.
  const cw = useTransform(sw, (v) => Math.max(0, v));
  const ch = useTransform(sh, (v) => Math.max(0, v));
  const cx = useMotionValue(0);
  const cy = useMotionValue(0);
  const card = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const placed = useRef(false);
  const last = index === count - 1;

  // The cut-out springs from target to target; with no target it closes to the centre.
  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect) {
      const top = Math.max(PAD, rect.y - PAD);
      const bottom = Math.min(vh - PAD, rect.y + rect.h + PAD);
      to(sx, Math.max(PAD, rect.x - PAD));
      to(sy, top);
      to(sw, Math.min(vw - 2 * PAD, rect.w + 2 * PAD));
      to(sh, Math.max(0, bottom - top));
      to(ring, 1);
    } else {
      to(sx, vw / 2);
      to(sy, vh / 2);
      to(sw, 0);
      to(sh, 0);
      to(ring, 0);
    }
  }, [rect, to, sx, sy, sw, sh, ring]);

  // The card springs to its new place; the first placement is immediate.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const p = placeCard(rect, { w: el.offsetWidth, h: el.offsetHeight });
    if (!placed.current || reduced) {
      cx.set(p.x);
      cy.set(p.y);
      placed.current = true;
    } else {
      to(cx, p.x);
      to(cy, p.y);
    }
  }, [rect, index, reduced, to, cx, cy]);

  // Focus moves into the card on every step, and comes back whenever something else takes it: a closing
  // menu or palette restores focus to its trigger a moment after the tour has opened.
  useEffect(() => {
    if (!card.current?.contains(document.activeElement))
      title.current?.focus({ preventScroll: true });
  }, [index]);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const to = e.target as Element | null;
      if (!card.current || !to || card.current.contains(to)) return;
      // Never fight another dialog for focus: it holds its own focus trap.
      if (to.closest?.('[role="dialog"],[role="alertdialog"]')) return;
      title.current?.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  return (
    <div data-tour-ui className="fixed inset-0 z-[1000]">
      <svg aria-hidden className="absolute inset-0 h-full w-full">
        <defs>
          <mask id="athena-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <motion.rect x={sx} y={sy} width={cw} height={ch} rx={12} fill="black" />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgb(14 15 18 / 0.58)"
          mask="url(#athena-tour-mask)"
        />
        <motion.rect
          x={sx}
          y={sy}
          width={cw}
          height={ch}
          rx={12}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          style={{ opacity: ring }}
        />
      </svg>

      <motion.div
        ref={card}
        role="dialog"
        aria-modal="true"
        data-tour-step={step.id}
        aria-labelledby="athena-tour-title"
        aria-describedby="athena-tour-body"
        className="absolute left-0 top-0 w-[min(22.5rem,calc(100vw-2rem))] rounded-2xl p-5 text-label shadow-xl ring-1 ring-(--chip-ring)"
        style={{
          x: cx,
          y: cy,
          background: 'radial-gradient(140% 120% at 12% 0%, var(--marble-a), var(--marble-b))',
        }}
        initial={reduced ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring.smooth}
      >
        <motion.div
          key={step.id}
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.snappy}
        >
          <h2
            ref={title}
            id="athena-tour-title"
            tabIndex={-1}
            className="text-headline font-semibold tracking-[-0.01em] text-label outline-none"
          >
            {step.title}
          </h2>
          <p id="athena-tour-body" className="mt-1.5 text-pretty text-callout text-label-secondary">
            {step.body}
          </p>
        </motion.div>
        <MarksRule
          size="sm"
          label="Tour progress"
          value={index + 1}
          min={0}
          max={count}
          ticks={{ major: 1, minor: 1 }}
          settle={false}
          valueText={`${index + 1} of ${count}`}
          className="mt-5"
        />
        <div className="mt-4 flex items-center justify-between gap-2">
          {last ? (
            <span />
          ) : (
            <Button variant="plain" size="sm" className="-ml-2 max-sm:h-11" onClick={onStop}>
              Skip tour
            </Button>
          )}
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="gray" size="sm" className="max-sm:h-11" onClick={onBack}>
                Back
              </Button>
            )}
            <Button
              variant="filled"
              size="sm"
              className="max-sm:h-11"
              onClick={last ? onStop : onNext}
            >
              {last ? 'Finish' : 'Next'}
            </Button>
          </div>
        </div>
      </motion.div>
      <p className="sr-only" aria-live="polite">
        {`Tour, ${index + 1} of ${count}: ${step.title}. ${step.body}`}
      </p>
    </div>
  );
}

/** First signed-in visit: a small card in the corner. No backdrop, and it never takes focus. */
function TourWelcome({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      data-tour-ui
      role="region"
      aria-label="Tour"
      className="fixed bottom-4 left-4 z-[900] w-[min(21rem,calc(100vw-2rem))] rounded-2xl p-4 shadow-lg ring-1 ring-(--chip-ring) max-md:bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:left-[calc(264px+1rem)]"
      style={{
        background: 'radial-gradient(140% 120% at 12% 0%, var(--marble-a), var(--marble-b))',
      }}
      initial={reduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.sheet, delay: 0.4 }}
    >
      <p className="text-callout font-semibold text-label">New to Athena?</p>
      <p className="mt-0.5 text-footnote text-label-secondary">
        Take a 60-second tour of what you can do here.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="filled" size="sm" className="max-sm:h-11" onClick={onStart}>
          Start the tour
        </Button>
        <Button variant="plain" size="sm" className="max-sm:h-11" onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </motion.div>
  );
}

/** Holds the tour for the signed-in person: the welcome card, the spotlight and the keyboard. */
export function TourProvider({ children }: { children: ReactNode }) {
  const { me, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [welcome, setWelcome] = useState(false);
  const target = useRef<Element | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The auth value changes identity on every refetch; the tour only changes with who is signed in and
  // what they may do, so steps key on that and the latest context is read from a ref.
  const ctxRef = useRef<TourContext | null>(null);
  ctxRef.current = me ? { me, can } : null;
  const key = me ? `${me.user.id}|${me.organization?.id ?? ''}|${me.permissions.join(',')}` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on identity and permissions, see above
  const steps = useMemo(() => (ctxRef.current ? tourFor(ctxRef.current) : []), [key]);
  const userId = me?.user.id ?? null;

  // The welcome card: once per person per browser, never in an exam, never under automation.
  useEffect(() => {
    if (!userId || active) return;
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    if (QUIET_PATHS.test(pathname ?? '')) {
      setWelcome(false);
      return;
    }
    setWelcome(!isDone(userId));
  }, [userId, pathname, active]);

  const stop = useCallback(() => {
    setActive(false);
    setWelcome(false);
    setRect(null);
    target.current = null;
    if (userId) markDone(userId);
  }, [userId]);

  const start = useCallback(
    (fromHome = false) => {
      if (!steps.length) return;
      const here = window.location.pathname;
      // Never pull anyone out of an exam in progress, whatever launched the tour.
      if (QUIET_PATHS.test(here)) return;
      const at = fromHome ? -1 : steps.findIndex((s) => s.route === here);
      setWelcome(false);
      setIndex(at >= 0 ? at : 0);
      setRect(null);
      setActive(true);
    },
    [steps],
  );

  const next = useCallback(
    () => setIndex((i) => Math.min(steps.length - 1, i + 1)),
    [steps.length],
  );
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const measure = useCallback(() => {
    const el = target.current;
    if (!el || !el.isConnected) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, []);

  // Open a step: go to its page, wait for its target, bring it into view, then measure.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!active || !ctx) return;
    const step = steps[index];
    if (!step) return;
    const signal = { cancelled: false };
    void (async () => {
      const path = typeof step.route === 'function' ? await step.route(ctx) : (step.route ?? null);
      if (signal.cancelled) return;
      const navigated = !!path && path !== window.location.pathname;
      if (navigated) {
        router.push(path);
        await waitForPath(path, signal);
      }
      // A target on a page that is already here shows up fast; a new page gets the full wait.
      // A step whose page could not be resolved (no live exam, say) is shown centred, never on a stand-in.
      const unresolved = typeof step.route === 'function' && path === null;
      const el =
        step.target && !unresolved
          ? await waitForTarget(step.target, signal, navigated ? WAIT_MS : 1500)
          : null;
      if (signal.cancelled) return;
      target.current = el;
      // Start the spotlight moving at once; the scroll listener keeps it on target while the page scrolls.
      measure();
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        await sleep(reduced ? 30 : 360);
        if (signal.cancelled) return;
      }
      measure();
      // Page entrances can still be settling; measure once more when they are done.
      await sleep(420);
      if (!signal.cancelled) measure();
    })();
    return () => {
      signal.cancelled = true;
    };
  }, [active, index, steps, router, reduced, measure]);

  // Keep the spotlight on its target as the page scrolls or resizes.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const onChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, { capture: true });
    };
  }, [active, measure]);

  // Keyboard: right arrow or Enter for next, left arrow for back, Esc ends the tour at once.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // The palette (Ctrl K) and the shortcuts sheet (?) take over: the tour ends and lets the key through.
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || e.key === '?') {
        stop();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stop();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (
          e.key === 'Enter' &&
          (e.target as HTMLElement | null)?.closest('button, a, input, textarea, select')
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        if (index === steps.length - 1) stop();
        else next();
      } else if (e.key === 'Tab') {
        // Keep keyboard focus inside the card while the tour is open.
        const card = document.querySelector<HTMLElement>('[aria-labelledby="athena-tour-title"]');
        const items = card
          ? Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'))
          : [];
        if (!card || items.length === 0) return;
        const first = items[0]!;
        const lastItem = items[items.length - 1]!;
        const inside = card.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && (document.activeElement === lastItem || !inside)) {
          e.preventDefault();
          first.focus();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        back();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [active, index, steps.length, next, back, stop]);

  const api = useMemo<TourApi>(
    () => ({ start: () => start(false), stop, active }),
    [start, stop, active],
  );
  const step = active ? steps[index] : undefined;

  return (
    <TourCtx.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <>
            {step && (
              <TourOverlay
                step={step}
                index={index}
                count={steps.length}
                rect={rect}
                onNext={next}
                onBack={back}
                onStop={stop}
              />
            )}
            {welcome && !active && steps.length > 0 && (
              <TourWelcome onStart={() => start(true)} onDismiss={stop} />
            )}
          </>,
          document.body,
        )}
    </TourCtx.Provider>
  );
}
