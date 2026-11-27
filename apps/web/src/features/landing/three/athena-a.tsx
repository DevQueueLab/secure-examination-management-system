'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useWebGLGate } from '../webgl-gate';
import { stillIn, watchScroll } from './scroll-quiet';

const AthenaACanvas = dynamic(() => import('./athena-a-canvas'), { ssr: false });

/** Stills of the scene at rest, rendered from the canvas itself, so the hand-over to the live canvas cannot jump. */
const POSTER = '/brand/three/athena-a';
const POSTER_SRCSET = `${POSTER}-320.webp 320w, ${POSTER}-480.webp 480w, ${POSTER}-720.webp 720w`;

/** How long the poster and the canvas take to cross. */
const FADE_MS = 700;

type Phase = 'poster' | 'fading' | 'live';

/** True once the page has stopped scrolling while `active`; the canvas waits for it before mounting. */
function useStill(active: boolean): boolean {
  const [still, setStill] = useState(false);
  if (!active && still) setStill(false);
  useEffect(() => watchScroll(), []);
  useEffect(() => {
    if (!active) return;
    let t = 0;
    const check = () => {
      const wait = stillIn();
      if (wait > 0) t = window.setTimeout(check, wait);
      else setStill(true);
    };
    t = window.setTimeout(check, 0);
    return () => window.clearTimeout(t);
  }, [active]);
  return active && still;
}

/**
 * The Athena mark's A in glass, lit from inside. Square; size and place it with `className`.
 *
 * The still shows at once (nothing shifts, and the canvas is never the LCP element). The live canvas mounts
 * behind the WebGL gate and fades in over the still after its first frame; the two cross with plus-lighter
 * inside an isolated group, so the sum stays constant and the glow never dips. It mounts only once the page has
 * stopped scrolling, so scrolling into the section stays smooth. Reduced motion and weak devices keep the still
 * as the final state. The sealed point sits at (50%, 58%) of the square at rest and in motion.
 */
export function AthenaA({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const { mount, paused } = useWebGLGate(host);
  const still = useStill(mount);
  const [phase, setPhase] = useState<Phase>('poster');

  // When the gate takes the canvas away, the still comes back at once.
  const [mounted, setMounted] = useState(mount);
  if (mount !== mounted) {
    setMounted(mount);
    if (!mount) setPhase('poster');
  }

  const onReady = useCallback(() => setPhase((p) => (p === 'poster' ? 'fading' : p)), []);

  useEffect(() => {
    if (phase !== 'fading') return;
    const t = window.setTimeout(() => setPhase('live'), FADE_MS + 120);
    return () => window.clearTimeout(t);
  }, [phase]);

  const crossing = phase !== 'live';
  const layer = cn('absolute inset-0 size-full transition-opacity duration-700 ease-out', crossing && 'mix-blend-plus-lighter');

  return (
    <div ref={host} aria-hidden className={cn('relative aspect-square', crossing && 'isolate', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized stills of the canvas, picked by width */}
      <img
        src={`${POSTER}-480.webp`}
        srcSet={POSTER_SRCSET}
        sizes="auto, 240px"
        width={720}
        height={720}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn(layer, 'select-none object-contain', phase === 'poster' ? 'opacity-100' : 'opacity-0', phase === 'live' && 'invisible')}
      />
      {mount && still && (
        <div className={cn(layer, phase === 'poster' ? 'opacity-0' : 'opacity-100')}>
          <AthenaACanvas paused={paused} onReady={onReady} />
        </div>
      )}
    </div>
  );
}
