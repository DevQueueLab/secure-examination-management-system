'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/motion';

const DURATION = 640;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * A live reading that counts: up from zero when it first appears (after the page's own entrance, about 120 ms in), then
 * from its old value to the new one whenever it changes. Like the shared CountUp, the real text is always the final
 * value, which is what tests and screen readers read; while counting it is transparent and an aria-hidden copy on top
 * shows the running figure, removed the moment it would show the final one. Reduced motion shows the value at once.
 */
export function CountingNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const [run, setRun] = useState<{ from: number; to: number; delay: number } | null>(() => (value !== 0 ? { from: 0, to: value, delay: 120 } : null));
  const [target, setTarget] = useState(value);
  if (value !== target) {
    setTarget(value);
    setRun({ from: target, to: value, delay: 0 });
  }
  const ghost = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!run || reduced) return;
    const el = ghost.current;
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now + run.delay;
      const t = Math.min(1, Math.max(0, (now - start) / DURATION));
      const n = Math.round(run.from + (run.to - run.from) * easeOut(t));
      if (t >= 1 || n === run.to) {
        setRun(null);
        return;
      }
      if (el) el.textContent = String(n);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, reduced]);

  const counting = !!run && !reduced;
  return (
    <span className={cn('relative inline-block', className)}>
      <span className={counting ? 'opacity-0' : undefined}>{value}</span>
      {counting && (
        <span ref={ghost} aria-hidden className="absolute inset-0">
          {run.from}
        </span>
      )}
    </span>
  );
}
