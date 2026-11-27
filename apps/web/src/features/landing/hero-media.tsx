'use client';

import { useEffect, useRef, useState } from 'react';
import type { HeroLoop, ResolvedImage } from './brand-assets';
import { BrandPicture } from './brand-picture';
import h from './hero.module.css';

interface NetworkInformation {
  saveData?: boolean;
}

/**
 * The bust. The still is painted first and is the page's largest paint. When a loop is given, it starts once
 * the browser is idle and the bust is on screen, then crosses over the still slowly; under reduced motion or
 * Save-Data the still stays. The marble hero passes no loop.
 */
export function HeroMedia({ poster, loop }: { poster: ResolvedImage | null; loop: HeroLoop | null }) {
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!loop || !el) return;
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || connection?.saveData) return;

    let idle = false;
    let visible = false;
    const maybeStart = () => idle && visible && setMounted(true);
    const io = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      maybeStart();
      const v = video.current;
      if (v) {
        if (visible) void v.play().catch(() => {});
        else v.pause();
      }
    });
    io.observe(el);
    const ric = window.requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined;
    const handle = ric ? ric(() => ((idle = true), maybeStart()), { timeout: 2500 }) : window.setTimeout(() => ((idle = true), maybeStart()), 1200);
    return () => {
      io.disconnect();
      if (ric) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [loop]);

  return (
    <div ref={host} className={h.media} data-playing={playing ? '' : undefined}>
      {poster && <BrandPicture image={poster} priority sizes="(max-width: 767px) 112vw, 70vw" className={h.poster} />}
      {loop && mounted && (
        <video
          ref={video}
          className={h.video}
          width={poster?.width ?? 1280}
          height={poster?.height ?? 1600}
          muted
          playsInline
          loop
          autoPlay
          preload="metadata"
          poster={poster?.src}
          aria-hidden
          onPlaying={() => setPlaying(true)}
        >
          {loop.webm && <source src={loop.webm} type="video/webm" />}
          {loop.mp4 && <source src={loop.mp4} type="video/mp4" />}
        </video>
      )}
    </div>
  );
}
