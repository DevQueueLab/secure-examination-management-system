'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';

type Tag = 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';
type Phase = 'pending' | 'writing' | 'done';
interface Glyph {
  ch: string;
  x: number;
  y: number;
  /** Dash length: comfortably longer than the glyph's outline, so one dash draws all of it. */
  d: number;
}

export interface WrittenTextProps {
  text: string;
  as?: Tag;
  className?: string;
  style?: CSSProperties;
  /** Play only on the first visit this session under this key; afterwards render finished. */
  once?: string;
  /** Delay before the pen starts, in ms. */
  delay?: number;
  /** Total time for the whole word, in ms. Default grows with length (about 1.75 s for "Athena"). */
  duration?: number;
}

const STORAGE_PREFIX = 'athena:written:';

function shouldSkip(once?: string): boolean {
  const root = document.documentElement;
  if (root.dataset.reduceMotion === 'true') return true;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  // Arriving through a view transition (the / to /sign-in wordmark morph): the morph is the motion.
  try {
    if (root.matches(':active-view-transition')) return true;
  } catch {
    /* selector unsupported: no view transitions either */
  }
  if (once) {
    try {
      const key = STORAGE_PREFIX + once;
      if (sessionStorage.getItem(key) === '1') return true;
      sessionStorage.setItem(key, '1');
    } catch {
      /* storage blocked: play every time */
    }
  }
  return false;
}

/**
 * Text that writes itself: each glyph's outline is drawn with a hairline pen (carmine in light, gold in dark),
 * left to right, then the fill flows in behind the pen and the stroke settles away. The real text stays in the
 * DOM (selectable, read by screen readers, and the layout box); the drawing is an aria-hidden SVG laid over it,
 * positioned from the real glyph boxes, so any font works (Switzer now, Athens later) with no layout shift.
 * Static under reduced motion, after `once` has played, and when the element arrives through a view transition.
 */
export function WrittenText({ text, as = 'span', className, style, once, delay = 0, duration }: WrittenTextProps) {
  const Element = as;
  const hostRef = useRef<HTMLElement | null>(null);
  const realRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<Phase>('pending');
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const [timing, setTiming] = useState({ draw: 1000, stagger: 120, total: 1700 });

  useLayoutEffect(() => {
    if (shouldSkip(once)) {
      setPhase('done');
      return;
    }
    const host = hostRef.current;
    const real = realRef.current;
    const mark = markRef.current;
    const node = real ? Array.from(real.childNodes).find((n) => n.nodeType === Node.TEXT_NODE) : undefined;
    if (!host || !real || !mark || !node) {
      setPhase('done');
      return;
    }
    // One read pass, no writes in between: glyph boxes from a Range, the baseline from a zero-size marker.
    const hostBox = host.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(host).fontSize) || 16;
    const str = node.textContent ?? '';
    const range = document.createRange();
    const raw: { ch: string; x: number; top: number; w: number }[] = [];
    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);
      if (!ch.trim()) continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getBoundingClientRect();
      raw.push({ ch, x: r.left - hostBox.left, top: r.top - hostBox.top, w: r.width });
    }
    if (raw.length === 0) {
      setPhase('done');
      return;
    }
    const baseline = mark.getBoundingClientRect().top - hostBox.top - raw[0]!.top;
    const list = raw.map((g) => ({ ch: g.ch, x: g.x, y: g.top + baseline, d: Math.ceil(2.6 * (g.w + 0.8 * fontSize)) }));
    const total = duration ?? Math.min(2600, 1100 + list.length * 110);
    const draw = Math.round(total * 0.62);
    const stagger = list.length > 1 ? (total - draw) / (list.length - 1) : 0;
    setGlyphs(list);
    setTiming({ draw, stagger, total });
    setPhase('writing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing runs after the word is written: the SVG is removed and the real text shows.
  useLayoutEffect(() => {
    if (phase !== 'writing') return;
    const t = window.setTimeout(() => setPhase('done'), delay + timing.total + 60);
    return () => window.clearTimeout(t);
  }, [phase, delay, timing.total]);

  return (
    <Element
      ref={hostRef as never}
      data-written={phase}
      className={cn('relative', as === 'span' && 'inline-block', className)}
      style={style}
    >
      <span ref={realRef} className="written-real">
        <span ref={markRef} aria-hidden className="written-mark" />
        {text}
      </span>
      {phase === 'writing' && (
        <svg aria-hidden className="written-svg" width="100%" height="100%">
          {glyphs.map((g, i) => (
            <text
              key={i}
              x={g.x}
              y={g.y}
              className="written-glyph"
              style={
                {
                  '--d': `${g.d}px`,
                  animationDuration: `${timing.draw}ms`,
                  animationDelay: `${Math.round(delay + i * timing.stagger)}ms`,
                } as CSSProperties
              }
            >
              {g.ch}
            </text>
          ))}
        </svg>
      )}
    </Element>
  );
}
