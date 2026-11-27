'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HeroLoop, ResolvedImage } from './brand-assets';
import { BrandPicture } from './brand-picture';
import g from './glass-figure.module.css';

interface NetworkInformation {
  saveData?: boolean;
}

/**
 * The glass Athena as a still that can move once. The still is always painted. When the figure comes within
 * 400px of the screen the clip is fetched; once half of it is in view the clip plays through a single time over
 * the still, and when it ends (the clip is a ping-pong, so it finishes on its first pose) the still takes over
 * again. It pauses while scrolled away. Under reduced motion or Save-Data only the still is shown.
 */
export function GlassFigure({ image, clip, className, sizes }: { image: ResolvedImage; clip?: HeroLoop | null; className?: string; sizes?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const inView = useRef(false);
  const done = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);

  const play = useCallback(() => {
    const v = video.current;
    if (v && inView.current && !done.current) void v.play().catch(() => {});
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!clip || !el) return;
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || connection?.saveData) return;

    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setMounted(true);
        near.disconnect();
      },
      { rootMargin: '400px 0px' },
    );
    const seen = new IntersectionObserver(
      ([entry]) => {
        inView.current = Boolean(entry?.isIntersecting);
        if (inView.current) play();
        else video.current?.pause();
      },
      { threshold: 0.5 },
    );
    near.observe(el);
    seen.observe(el);
    return () => {
      near.disconnect();
      seen.disconnect();
    };
  }, [clip, play]);

  return (
    <div ref={host} className={className ? `${g.figure} ${className}` : g.figure} data-playing={playing ? '' : undefined}>
      <BrandPicture image={image} sizes={sizes} className={g.still} />
      {clip && mounted && (
        <video
          ref={video}
          className={g.clip}
          width={image.width}
          height={image.height}
          muted
          playsInline
          preload="auto"
          aria-hidden
          onLoadedData={play}
          onPlaying={() => setPlaying(true)}
          onEnded={() => {
            done.current = true;
            setPlaying(false);
          }}
        >
          {clip.webm && <source src={clip.webm} type="video/webm" />}
          {clip.mp4 && <source src={clip.mp4} type="video/mp4" />}
        </video>
      )}
    </div>
  );
}
