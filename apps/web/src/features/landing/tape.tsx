'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import t from './tape.module.css';

/*
 * The tape: tamper-evident exam-paper security tape, winding down the page through the chapters' stops. The band
 * is drawn on as the page scrolls (stroke-dashoffset, scrubbed, so it runs backwards too) and its print is
 * stamped on phrase by phrase behind the head of the band. It enters at the top of the first chapter at 62% of
 * the width, where the hero's tape leaves the hero. On a phone it seals each handover with a straight length
 * instead. Under reduced motion it is drawn whole and still.
 */

const PHRASES = ['SEALED EXAM PAPER', 'DO NOT OPEN BEFORE THE EXAM'];
const SPACE = '\u2003\u2003\u2003\u2003';
const PRINT = `${PHRASES.join(SPACE)}${SPACE}`;
/** Space between two phrases of the print, along the band. */
const GAP = 64;
const BAND = 40;

type Pt = [number, number];

/** A smooth curve through every point (Catmull-Rom, written as cubic Béziers). */
function curve(p: Pt[]): string {
  const start = p[0];
  if (!start || p.length < 2) return '';
  let d = `M${start[0].toFixed(1)},${start[1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p1 = p[i];
    const p2 = p[i + 1];
    if (!p1 || !p2) continue;
    const p0 = p[i - 1] ?? p1;
    const p3 = p[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

interface Segment {
  d: string;
  /** Distance of the segment's middle from the top of the run, for the strips on a phone. */
  y: number;
  /** Rough length, for the number of repeats of the print. */
  length: number;
}

interface Geo {
  w: number;
  h: number;
  narrow: boolean;
  segments: Segment[];
}

export function TapeRun({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const printLayer = useRef<SVGSVGElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h) return;
      const chapters = Array.from(el.querySelectorAll<HTMLElement>('[data-chapter]'));
      if (w < 768) {
        // On a phone the column is too narrow for the tape to wind beside the text, so it seals each handover:
        // a straight length across the gap at the top of the run and between every two chapters.
        const ys = [56, ...chapters.slice(0, -1).map((c) => c.getBoundingClientRect().bottom - box.top), h - 56];
        const segments = ys.map((y, i) => {
          const tilt = (i % 2 === 0 ? -1 : 1) * Math.min(28, w * 0.07);
          return { d: `M-30,${(y - tilt).toFixed(1)} L${(w + 30).toFixed(1)},${(y + tilt).toFixed(1)}`, y, length: w + 60 };
        });
        setGeo({ w, h, narrow: true, segments });
        return;
      }
      const pts: Pt[] = [[w * 0.62, 0]];
      chapters.forEach((c, i) => {
        const stop = c.querySelector<HTMLElement>('[data-tape-stop]');
        const cb = c.getBoundingClientRect();
        if (stop) {
          const r = stop.getBoundingClientRect();
          pts.push([r.left - box.left + r.width / 2, r.top - box.top + r.height / 2]);
        }
        const next = chapters[i + 1]?.querySelector<HTMLElement>('[data-tape-stop]');
        if (stop && next) {
          // Between two stops the tape crosses the page in the gap where one chapter hands over to the next.
          const a = stop.getBoundingClientRect();
          const b = next.getBoundingClientRect();
          pts.push([(a.left + a.width / 2 + b.left + b.width / 2) / 2 - box.left, cb.bottom - box.top]);
        }
      });
      pts.push([w * 0.5, h]);
      let length = 0;
      pts.forEach((pt, i) => {
        const prev = pts[i - 1];
        if (prev) length += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
      });
      setGeo({ w, h, narrow: false, segments: [{ d: curve(pts), y: h / 2, length: length * 1.15 }] });
    };
    // The observer reports once as soon as it starts, so the first measure also runs on a frame of its own.
    const ro = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const el = root.current;
    const host = svg.current;
    if (!geo || !el || !host) return;
    // The print is set phrase by phrase along the band, each phrase its own small text, and a phrase is stamped
    // on once the head of the band has passed it. Nothing is laid out again while the page scrolls: the draw is a
    // stroke-dashoffset, and a phrase only changes its opacity.
    const prints = Array.from(printLayer.current?.querySelectorAll<SVGGElement>('[data-print]') ?? []);
    const parts = Array.from(host.querySelectorAll<SVGPathElement>('[data-band]')).map((path, index) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length} ${length}`;
      path.style.strokeDashoffset = '0';
      const phrases = Array.from(prints[index]?.querySelectorAll<SVGTextElement>('text') ?? []);
      const ends: number[] = [];
      let at = GAP / 2;
      for (const text of phrases) {
        const tp = text.querySelector('textPath');
        const w = text.getComputedTextLength();
        if (!tp || at + w > length) {
          text.style.display = 'none';
          ends.push(Infinity);
          continue;
        }
        tp.setAttribute('startOffset', at.toFixed(1));
        at += w;
        ends.push(at);
        at += GAP;
      }
      return { path, phrases, ends, length, y: Number(path.dataset.y) };
    });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let revert: (() => void) | undefined;
    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {
        for (const { path, phrases, ends, length, y } of parts) {
          if (!path || !length) continue;
          const stamp = (head: number) => {
            phrases.forEach((text, i) => {
              const on = (ends[i] ?? Infinity) <= head;
              if (on !== text.hasAttribute('data-on')) text.toggleAttribute('data-on', on);
            });
          };
          const scrollTrigger = geo.narrow
            ? { trigger: el, start: `top+=${Math.round(y)} 88%`, end: `top+=${Math.round(y)} 40%`, scrub: 0.5 }
            : { trigger: el, start: 'top 70%', end: 'bottom 70%', scrub: 0.5 };
          printLayer.current?.setAttribute('data-stamping', '');
          gsap.fromTo(
            path,
            { strokeDashoffset: length },
            {
              strokeDashoffset: 0,
              ease: 'none',
              scrollTrigger,
              onUpdate() {
                stamp(this.progress() * length);
              },
            },
          );
        }
      });
      revert = () => {
        ctx.revert();
        printLayer.current?.removeAttribute('data-stamping');
      };
    });
    return () => {
      cancelled = true;
      revert?.();
    };
  }, [geo]);

  return (
    <div ref={root} className={t.run}>
      {geo && (
        <>
          <svg ref={svg} className={t.svg} width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true" focusable="false">
            {geo.segments.map((seg, i) => (
              <path key={i} d={seg.d} data-band data-y={seg.y.toFixed(0)} className={t.band} fill="none" strokeWidth={geo.narrow ? 34 : BAND} />
            ))}
          </svg>
          {/* The print has a layer of its own, so redrawing the band never repaints the type. */}
          <svg
            ref={printLayer}
            className={`${t.svg} ${t.printLayer}`}
            width={geo.w}
            height={geo.h}
            viewBox={`0 0 ${geo.w} ${geo.h}`}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              {geo.segments.map((seg, i) => (
                <path key={i} id={`tape-print-${i}`} d={seg.d} />
              ))}
            </defs>
            {geo.segments.map((seg, i) => (
              <g key={i} data-print>
                {Array.from({ length: Math.max(2, Math.ceil(seg.length / 260)) }, (_, k) => (
                  <text key={k} className={t.print} dy="0.36em">
                    <textPath href={`#tape-print-${i}`} startOffset="0">
                      {PHRASES[k % PHRASES.length]}
                    </textPath>
                  </text>
                ))}
              </g>
            ))}
          </svg>
        </>
      )}
      {children}
    </div>
  );
}

/** A straight length of the same tape, for the footer. Its print crawls with the scroll (chapter-scenes.tsx). */
export function TapeStrip({ className }: { className?: string }) {
  return (
    <div className={`${t.strip} ${className ?? ''}`} aria-hidden="true">
      <span className={t.stripPrint} data-tape-crawl>
        {PRINT.repeat(8)}
      </span>
    </div>
  );
}
