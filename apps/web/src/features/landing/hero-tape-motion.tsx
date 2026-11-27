'use client';

import { useEffect } from 'react';

/**
 * Spaces the print on the hero's tape by one measured repeat once the font is in, so the repeats meet exactly.
 * It runs on load and on resize only: the print never moves per frame (re-laying out text along a path on every
 * scroll frame cost the hero its frame rate); the bands move as whole layers in the exit scene instead.
 */
export function TapeMotion() {
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>('[data-scene="hero"]');
    if (!hero) return;
    const bands = Array.from(hero.querySelectorAll<SVGGElement>('[data-tape-print]')).map((group) => {
      const paths = Array.from(group.querySelectorAll<SVGTextPathElement>('[data-tape-text]'));
      return { paths, repeat: 680 };
    });
    if (bands.length === 0) return;
    const place = () => {
      for (const band of bands) band.paths.forEach((p, i) => p.setAttribute('startOffset', (i * band.repeat).toFixed(1)));
    };
    const measure = () => {
      for (const band of bands) {
        const text = band.paths[0]?.parentElement as unknown as SVGTextContentElement | undefined;
        const length = text?.getComputedTextLength();
        if (length && length > 50) band.repeat = length;
      }
      place();
    };
    let cancelled = false;
    measure();
    void document.fonts?.ready.then(() => !cancelled && measure());
    window.addEventListener('resize', measure);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', measure);
    };
  }, []);
  return null;
}
