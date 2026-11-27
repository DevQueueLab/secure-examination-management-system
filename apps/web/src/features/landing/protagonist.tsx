'use client';

import { useEffect, useRef } from 'react';
import type { HeroLoop, ResolvedImage } from './brand-assets';
import { HeroMedia } from './hero-media';
import h from './hero.module.css';

interface Stop {
  x: number;
  y: number;
  w: number;
  h: number;
  tilt: number;
  /** The scroll position at which this slot's centre sits at the viewport's centre. */
  rest: number;
}

const ASPECT = 4 / 5;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Layout position in the document, ignoring any transform a scroll scene has applied on the way. */
function layoutRect(el: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/**
 * The glass Athena, the page's one protagonist. She is drawn parked in the hero's frame, so the first paint is
 * complete without script. Once the page is interactive she lifts to a fixed layer and travels: she rests in each
 * `[data-protagonist-slot]` while its centre crosses the middle of the screen and eases to the next one in
 * between, coming forward and turning slightly on the way. Everything is a function of the scroll position, so
 * it runs backwards too. Under reduced motion she stays in the hero.
 */
export function Protagonist({ poster, loop }: { poster: ResolvedImage | null; loop: HeroLoop | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let stops: Stop[] = [];
    let baseW = 0;
    let baseH = 0;
    let smooth = window.scrollY;
    let frame = 0;
    let measureFrame = 0;

    const measure = () => {
      const vh = window.innerHeight;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
      const next: Stop[] = [];
      for (const node of document.querySelectorAll<HTMLElement>('[data-protagonist-slot]')) {
        if (node.getClientRects().length === 0) continue;
        const r = layoutRect(node);
        if (r.w < 2 || r.h < 2) continue;
        let w = r.w;
        let hh = w / ASPECT;
        if (hh > r.h) {
          hh = r.h;
          w = hh * ASPECT;
        }
        const y = r.y + (r.h - hh) / 2;
        const prev = next[next.length - 1];
        let rest = Math.min(maxScroll, Math.max(0, y + hh / 2 - vh / 2));
        if (prev && rest <= prev.rest) rest = prev.rest + 1;
        next.push({ x: r.x + (r.w - w) / 2, y, w, h: hh, tilt: Number(node.dataset.protagonistTilt) || 0, rest });
      }
      stops = next;
      const first = next[0];
      if (first && (first.w !== baseW || first.h !== baseH)) {
        baseW = first.w;
        baseH = first.h;
        el.style.width = `${baseW}px`;
        el.style.height = `${baseH}px`;
      }
    };

    const render = () => {
      frame = 0;
      if (stops.length === 0 || !baseW) return;
      const y = window.scrollY;
      // The travel eases after the scrollbar a little, like a scrubbed scene; resting positions do not lag.
      smooth += (y - smooth) * 0.14;
      if (Math.abs(y - smooth) < 0.5) smooth = y;
      else frame = requestAnimationFrame(render);

      let i = 0;
      while (i < stops.length - 1 && smooth >= stops[i + 1]!.rest) i++;
      const a = stops[i]!;
      const b = stops[Math.min(i + 1, stops.length - 1)]!;
      const t = b === a || smooth <= a.rest ? 0 : Math.min(1, (smooth - a.rest) / (b.rest - a.rest));
      const e = easeInOut(t);
      const sx = window.scrollX;
      const acx = a.x - sx + a.w / 2;
      const acy = a.y - y + a.h / 2;
      const bcx = b.x - sx + b.w / 2;
      const bcy = b.y - y + b.h / 2;
      const cx = acx + (bcx - acx) * e;
      const cy = acy + (bcy - acy) * e;
      const lift = Math.sin(Math.PI * t);
      const scale = ((a.w + (b.w - a.w) * e) / baseW) * (1 + 0.14 * lift);
      const turn = a.tilt + (b.tilt - a.tilt) * e + lift * 4 * (i % 2 === 0 ? 1 : -1);
      el.style.transform = `translate3d(${(cx - baseW / 2).toFixed(1)}px, ${(cy - baseH / 2).toFixed(1)}px, 0) scale(${scale.toFixed(4)}) rotate(${turn.toFixed(2)}deg)`;
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    const remeasure = () => {
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => {
        measure();
        schedule();
      });
    };

    measure();
    if (stops.length === 0) return;
    el.setAttribute('data-lifted', '');
    render();

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', remeasure);
    window.addEventListener('load', remeasure);
    const ro = new ResizeObserver(remeasure);
    ro.observe(document.body);

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measureFrame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('load', remeasure);
      ro.disconnect();
      el.removeAttribute('data-lifted');
      el.style.transform = '';
      el.style.width = '';
      el.style.height = '';
    };
  }, []);

  return (
    <div ref={ref} className={h.figure} data-scene="hero-figure">
      <div className={h.tilt} data-depth="8">
        <HeroMedia poster={poster} loop={loop} />
      </div>
    </div>
  );
}
