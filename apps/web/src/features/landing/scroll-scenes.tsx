'use client';

import { useEffect } from 'react';

/**
 * The hero's exit, scrubbed by the scroll: the tape's back band pulls away from the bust as she leaves her frame
 * for the first chapter (her move belongs to protagonist.tsx). Only the travelling objects move; the copy scrolls
 * with the page. The front band stays, running on into the chapters' tape path. Tied to the scrollbar, so it runs
 * backwards too; under reduced motion nothing here runs.
 */
export function ScrollScenes() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let revert: (() => void) | undefined;

    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const one = (name: string) => document.querySelector<HTMLElement>(`[data-scene="${name}"]`);

      const ctx = gsap.context(() => {
        const hero = one('hero');
        if (!hero) return;
        const leave = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 },
        });
        // The back band pulls away up and out as the bust leaves (transform only, so the band is never repainted);
        // the front band stays and runs on into the chapters.
        const back = one('tape-back');
        if (back) leave.fromTo(back, { xPercent: 0, yPercent: 0 }, { xPercent: 70, yPercent: -55, ease: 'power1.in', duration: 0.8 }, 0.05);
      });
      revert = () => ctx.revert();
    });

    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return null;
}
