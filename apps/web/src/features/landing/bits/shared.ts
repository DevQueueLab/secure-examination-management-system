import { useEffect, useLayoutEffect } from 'react';

/** Layout effect in the browser, plain effect on the server (no SSR warning). */
export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Read at call time, never at module load. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * A canvas made inside the effect and removed in its cleanup, so a Strict Mode re-run gets a fresh
 * canvas (and a fresh context) instead of the one whose context the first cleanup released.
 */
export function createLayerCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';
  container.appendChild(canvas);
  return canvas;
}

/** Give the GPU context back now rather than at garbage collection, then drop the canvas. */
export function releaseContext(gl: WebGLRenderingContext | WebGL2RenderingContext | null, canvas: HTMLCanvasElement): void {
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();
}
