'use client';

/**
 * Gated WebGL backgrounds. Each wrapper renders its positioned container right away (server HTML
 * included) and mounts the background only when useWebGLGate says so. The background's code loads
 * through next/dynamic, so none of it is in the page bundle; only types are imported here.
 *
 * The container stays empty on the server, under prefers-reduced-motion and on weak devices, so give
 * the section a flat colour of its own behind it.
 */
import dynamic from 'next/dynamic';
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useWebGLGate } from '../webgl-gate';
import type { LightRaysProps } from './LightRays';
import type { ThreadsProps } from './Threads';

const LightRays = dynamic(() => import('./LightRays'), { ssr: false });
const Threads = dynamic(() => import('./Threads'), { ssr: false });

interface GateShellProps {
  /** Classes for the container; merged over `pointer-events-none absolute inset-0 overflow-hidden`. */
  className?: string;
  style?: CSSProperties;
  /** Fade-in once the first frame is drawn, in ms. */
  fadeMs?: number;
}

const SHELL = 'pointer-events-none absolute inset-0 overflow-hidden';
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Holds its own "first frame drawn" state, so it starts over each time the gate remounts the layer. */
function FadeIn({ fadeMs, children }: { fadeMs: number; children: (onReady: () => void) => ReactNode }) {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <div
      className="absolute inset-0"
      style={{ opacity: ready ? 1 : 0, transition: `opacity ${fadeMs}ms ${EASE_OUT}` }}
    >
      {children(onReady)}
    </div>
  );
}

export type GatedLightRaysProps = Omit<LightRaysProps, 'paused' | 'onReady' | 'className' | 'style'> & GateShellProps;

/** LightRays behind a WebGL gate. Place it inside a `relative` section. */
export function GatedLightRays({ className, style, fadeMs = 1200, ...props }: GatedLightRaysProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { mount, paused } = useWebGLGate(ref);
  return (
    <div ref={ref} aria-hidden="true" className={cn(SHELL, className)} style={style}>
      {mount ? <FadeIn fadeMs={fadeMs}>{onReady => <LightRays {...props} paused={paused} onReady={onReady} />}</FadeIn> : null}
    </div>
  );
}

export type GatedThreadsProps = Omit<ThreadsProps, 'paused' | 'onReady' | 'className' | 'style'> & GateShellProps;

/** Threads behind a WebGL gate. Place it inside a `relative` section. */
export function GatedThreads({ className, style, fadeMs = 1200, ...props }: GatedThreadsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { mount, paused } = useWebGLGate(ref);
  return (
    <div ref={ref} aria-hidden="true" className={cn(SHELL, className)} style={style}>
      {mount ? <FadeIn fadeMs={fadeMs}>{onReady => <Threads {...props} paused={paused} onReady={onReady} />}</FadeIn> : null}
    </div>
  );
}
