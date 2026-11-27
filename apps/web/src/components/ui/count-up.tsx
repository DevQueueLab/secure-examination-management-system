'use client';

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';

export interface CountUpProps {
  /** The final value. It is the element's text from the first render (and on the server). */
  value: number;
  /** Decimal places. Default: 0 for whole numbers, 1 otherwise. */
  decimals?: number;
  /** Formats the number. Default en-US grouping with `decimals` places. */
  format?: (value: number) => string;
  /** Count length in ms. Default 800. */
  duration?: number;
  /** Wait before counting, in ms. Default 0. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
}

const formatters = new Map<number, Intl.NumberFormat>();
function defaultFormat(decimals: number) {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  return (n: number) => f.format(n);
}

function motionAllowed() {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.reduceMotion === 'true') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A numeral that counts up once, on mount, with tabular figures (pair it with `.numeral`).
 * The real text is always the final value: it is what the server renders, what tests and screen readers read,
 * and what lays out the box, so nothing shifts. While counting it is transparent and an aria-hidden copy on top
 * shows the running figure; that copy never shows the final string and is removed the moment it would.
 * Reduced motion shows the final value at once.
 */
export function CountUp({ value, decimals, format, duration = 800, delay = 0, className, style }: CountUpProps) {
  const places = decimals ?? (Number.isInteger(value) ? 0 : 1);
  const fmt = format ?? defaultFormat(places);
  const finalText = fmt(value);
  const real = useRef<HTMLSpanElement>(null);
  const ghost = useRef<HTMLSpanElement>(null);
  // The count reads the latest value and formatter, so a change mid-count lands on the new figure.
  const latest = useRef({ value, fmt, finalText });
  latest.current = { value, fmt, finalText };

  // Once, on mount, before paint. Driven straight on the DOM so no re-render can interrupt it.
  useLayoutEffect(() => {
    const realEl = real.current;
    const ghostEl = ghost.current;
    const target = latest.current.value;
    if (!realEl || !ghostEl || !motionAllowed() || !Number.isFinite(target) || target === 0) return;
    let raf = 0;
    let start = 0;
    const finish = () => {
      realEl.style.color = '';
      ghostEl.textContent = '';
    };
    // performance.now(), not the rAF timestamp: after a long mount the first frame's timestamp can predate the
    // effect by hundreds of ms, which would end the count before it is seen.
    const tick = () => {
      const now = performance.now();
      if (!start) start = now + delay;
      const { value: to, fmt: f, finalText: done } = latest.current;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const text = f(to * (1 - Math.pow(1 - t, 4)));
      if (t >= 1 || text === done) {
        finish();
        return;
      }
      ghostEl.textContent = text;
      raf = requestAnimationFrame(tick);
    };
    realEl.style.color = 'transparent';
    ghostEl.textContent = latest.current.fmt(0);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      finish();
    };
    // Mount only: later value changes simply show the new figure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className={cn('relative inline-block tabular-nums', className)} style={style}>
      <span ref={real}>{finalText}</span>
      <span ref={ghost} aria-hidden className="pointer-events-none absolute inset-0 whitespace-nowrap text-right" />
    </span>
  );
}
