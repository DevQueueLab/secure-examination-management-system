'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import t from './tape.module.css';

/*
 * The tape: tamper-evident exam-paper security tape, one length from the hero to the dark chapter. It picks up
 * the hero's front band exactly where that band leaves the hero (same line, angle, width and print), winds down
 * the page beneath each chapter's product and runs off the left edge above the dark chapter. Its first length
 * passes in front of the marble Athena, as the hero's band does, and hands over to the length behind her well
 * to the left of where she ever flies, so the tape never changes depth across her. Its print reads the way the
 * hero's does along the whole length and no phrase is ever cut by an edge. It is still: nothing is drawn or laid
 * out while the page scrolls. On a phone it seals each handover with a straight length instead.
 */

const PHRASES = ['SEALED EXAM PAPER', 'DO NOT OPEN BEFORE THE EXAM'];
const SPACE = '    ';
const PRINT = `${PHRASES.join(SPACE)}${SPACE}`;
/** Space between two phrases of the print, along the band. */
const GAP = 72;

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

interface Geo {
  w: number;
  h: number;
  narrow: boolean;
  /** Each band, top to bottom (one on a wide screen, one strip per handover on a phone). */
  bands: string[];
  /** The same bands backwards: the print runs this way so it reads like the hero's. */
  prints: string[];
  band: number;
  edge: number;
  font: number;
  /** Phrases per band. */
  count: number;
  /** On a phone, the first strip carries on from the hero's band, in front of Athena. */
  lead: boolean;
}

/** Where the hero's front band crosses the top of the run, with a few of its points above and below. */
function heroLead(box: DOMRect): { pts: Pt[]; scale: number } | null {
  const front = document.getElementById('tape-front');
  if (!(front instanceof SVGPathElement)) return null;
  const m = front.getScreenCTM();
  if (!m) return null;
  const total = front.getTotalLength();
  const at = (l: number): Pt => {
    const p = front.getPointAtLength(l);
    return [m.a * p.x + m.c * p.y + m.e - box.left, m.b * p.x + m.d * p.y + m.f - box.top];
  };
  // The hero's band runs from below the fold upward, so walk it from its start until it rises above the run.
  const step = 6;
  let cross = -1;
  for (let l = 0; l <= total; l += step) {
    if (at(l)[1] < 0) {
      cross = l;
      break;
    }
  }
  if (cross < 0) return null;
  const pts: Pt[] = [];
  // Above the run (hidden under the hero's own band), then down through the crossing and on along its line.
  for (const dl of [150, 100, 50]) pts.push(at(Math.min(total, cross + dl)));
  pts.push(at(cross));
  for (const dl of [60, 120]) if (cross - dl >= 0) pts.push(at(cross - dl));
  return { pts, scale: Math.hypot(m.a, m.b) };
}

export function TapeRun({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const bridge = useRef<SVGSVGElement>(null);
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
        const strips = ys.map((y, i) => {
          const tilt = (i % 2 === 0 ? -1 : 1) * Math.min(28, w * 0.07);
          return `M-30,${(y - tilt).toFixed(1)} L${(w + 30).toFixed(1)},${(y + tilt).toFixed(1)}`;
        });
        const prints = [...strips];
        // The first strip is the hero's band carried on down and off the left edge.
        const lead = heroLead(box);
        const seam = lead?.pts[3];
        if (lead && seam) {
          const pts = lead.pts.slice(0, 4);
          pts.push([seam[0] * 0.62, seam[1] + 50], [seam[0] * 0.2, seam[1] + 88], [-60, seam[1] + 112]);
          strips[0] = curve(pts);
          prints[0] = curve([...pts].reverse());
        }
        const scale = lead?.scale ?? 0.6;
        setGeo({
          w,
          h,
          narrow: true,
          bands: strips,
          prints,
          band: lead ? 58 * scale : 34,
          edge: lead ? 62 * scale : 37,
          font: lead ? 21 * scale : 12,
          count: Math.ceil((w + 60) / 150) + 2,
          lead: Boolean(lead),
        });
        return;
      }
      const lead = heroLead(box);
      const pts: Pt[] = lead ? [...lead.pts] : [[w * 0.62, -40], [w * 0.6, 0]];
      // Carry on down the hero band's line, clear of the marble Athena, before the first stop.
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      if (a && b && b[1] > a[1]) {
        const slope = (b[0] - a[0]) / (b[1] - a[1]);
        const y = Math.max(b[1] + 120, 360);
        pts.push([b[0] + slope * (y - b[1]), y]);
      }
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
          const s1 = stop.getBoundingClientRect();
          const s2 = next.getBoundingClientRect();
          pts.push([(s1.left + s1.width / 2 + s2.left + s2.width / 2) / 2 - box.left, cb.bottom - box.top]);
        }
      });
      // And off the left edge of the page above the dark chapter.
      pts.push([w * 0.4, h - 120], [-w * 0.16, h - 10]);
      let length = 0;
      pts.forEach((pt, i) => {
        const prev = pts[i - 1];
        if (prev) length += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
      });
      const scale = lead?.scale ?? 1;
      setGeo({
        w,
        h,
        narrow: false,
        bands: [curve(pts)],
        prints: [curve([...pts].reverse())],
        band: 42 * scale,
        edge: 46 * scale,
        font: 15 * scale,
        count: Math.ceil((length * 1.1) / 300) + 2,
        lead: Boolean(lead),
      });
    };
    // The observer reports once as soon as it starts, so the first measure also runs on a frame of its own.
    const ro = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    const remeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    void document.fonts?.ready.then(remeasure);
    window.addEventListener('load', remeasure);
    // The hero's band is sized by the window's height, so a change of height alone moves where it leaves.
    window.addEventListener('resize', remeasure);
    return () => {
      ro.disconnect();
      window.removeEventListener('load', remeasure);
      window.removeEventListener('resize', remeasure);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const host = svg.current;
    if (!geo || !host) return;
    // Set the print phrase by phrase along each band, a gap between phrases, so no phrase meets an edge. On a
    // wide screen the first length (in front of Athena) and the rest (behind her) meet in a gap of the print.
    const bands = Array.from(host.querySelectorAll<SVGPathElement>('[data-band]'));
    bands.forEach((path, index) => {
      const total = path.getTotalLength();
      const own = Array.from(host.querySelectorAll<SVGTextElement>(`[data-print="${index}"] text`));
      const front = Array.from(bridge.current?.querySelectorAll<SVGTextElement>(`[data-print="${index}"] text`) ?? []);
      // The length that leaves the hero is set backwards and starts in front of Athena; phone strips are not.
      const leads = !geo.narrow || (geo.lead && index === 0);
      let hand = 0;
      let from = leads ? 0 : GAP / 2;
      if (leads) {
        // The print starts just below the top of the run, where the hero's band leaves the hero.
        for (let l = 0; l < total; l += 4) {
          const p = path.getPointAtLength(l);
          if (p.y > 0 && !from) from = l + 28;
          if (!geo.narrow && p.y > 0 && p.x < geo.w * 0.5) {
            hand = l;
            break;
          }
        }
        if (geo.narrow) hand = total;
      }
      // A phrase hidden by the last layout measures nothing, so every phrase is shown again before it is measured.
      for (const text of [...own, ...front]) text.style.display = '';
      let at = from;
      own.forEach((text, k) => {
        const width = text.getComputedTextLength();
        const mate = front[k];
        const start = at;
        const end = at + width;
        const fits = end <= total - 24;
        if (fits && hand && start < hand && end > hand) hand = end + GAP / 2;
        const inFront = fits && leads && end <= hand;
        // The print runs along the band backwards, so a phrase starts where it ends on the band.
        const offset = (leads ? total - end : start).toFixed(1);
        text.querySelector('textPath')?.setAttribute('startOffset', offset);
        text.style.display = fits && !inFront ? '' : 'none';
        if (mate) {
          mate.querySelector('textPath')?.setAttribute('startOffset', offset);
          mate.style.display = inFront ? '' : 'none';
        }
        at = end + GAP;
      });
      if (leads && index === 0 && bridge.current) {
        for (const p of Array.from(bridge.current.querySelectorAll<SVGPathElement>('[data-bridge]'))) {
          p.style.strokeDasharray = `${hand.toFixed(1)} ${(total + 100).toFixed(1)}`;
        }
      }
    });
  }, [geo]);

  const print = (scope: string) =>
    geo?.prints.map((d, i) => (
      <g key={i} data-print={i} style={{ fontSize: `${geo.font.toFixed(2)}px` }}>
        {Array.from({ length: geo.count }, (_, k) => (
          <text key={k} className={t.print} dy="0.36em">
            <textPath href={`#${scope}-${i}`} startOffset="0">
              {PHRASES[(k + 1) % PHRASES.length]}
            </textPath>
          </text>
        ))}
      </g>
    ));

  return (
    <div className={t.wrap}>
      {geo && (!geo.narrow || geo.lead) && (
        // The first length, in front of the marble Athena like the hero's band, up to the handover.
        <svg ref={bridge} className={`${t.svg} ${t.bridge}`} width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true" focusable="false">
          <defs>
            <path id="tape-bridge-0" d={geo.prints[0]} />
          </defs>
          <path d={geo.bands[0]} data-bridge className={t.edge} fill="none" strokeWidth={geo.edge} />
          <path d={geo.bands[0]} data-bridge className={t.band} fill="none" strokeWidth={geo.band} />
          {print('tape-bridge')?.slice(0, 1)}
        </svg>
      )}
      <div ref={root} className={t.run}>
        {geo && (
          <svg ref={svg} className={t.svg} width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} aria-hidden="true" focusable="false">
            <defs>
              {geo.prints.map((d, i) => (
                <path key={i} id={`tape-print-${i}`} d={d} />
              ))}
            </defs>
            {geo.bands.map((d, i) => (
              <g key={i}>
                <path d={d} className={t.edge} fill="none" strokeWidth={geo.edge} />
                <path d={d} data-band className={t.band} fill="none" strokeWidth={geo.band} />
              </g>
            ))}
            {print('tape-print')}
          </svg>
        )}
        {children}
      </div>
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
