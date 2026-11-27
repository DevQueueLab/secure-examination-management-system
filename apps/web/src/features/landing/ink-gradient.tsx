'use client';

import { useLayoutEffect, useRef } from 'react';
import s from './landing.module.css';

/**
 * The name's gold-to-wine ink for the pen's fill while the hero wordmark writes itself. It spans the written
 * text's own box in pixels, exactly as the finished text's CSS gradient does, so nothing shifts at the handover.
 */
export function InkGradient() {
  const ref = useRef<SVGLinearGradientElement>(null);

  useLayoutEffect(() => {
    const grad = ref.current;
    const host = document.querySelector<HTMLElement>('[data-scene="hero-title"] [data-written]');
    if (!grad || !host) return;
    const fit = () => grad.setAttribute('y2', String(host.offsetHeight || 1));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <svg className={s.inkDefs} aria-hidden width="0" height="0" focusable="false">
      <defs>
        <linearGradient ref={ref} id="athena-ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="300">
          <stop offset="12%" stopColor="#f2dfa7" />
          <stop offset="52%" stopColor="#e9a06e" />
          <stop offset="74%" stopColor="#e8432e" />
          <stop offset="100%" stopColor="#6e1a22" />
        </linearGradient>
      </defs>
    </svg>
  );
}
