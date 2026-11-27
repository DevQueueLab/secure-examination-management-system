'use client';

import { useEffect } from 'react';

/**
 * Scroll-scrubbed motion that carries the story between the hero and the close. Leaving the hero, the glass bust
 * comes forward through her name while the name recedes and the gauges slide. Arriving at the close, the temple
 * rises into place and the laurel turns shut around the glass A. Every move is tied to the scrollbar, so it runs
 * backwards too. Under reduced motion nothing here runs and the page stays as it is drawn.
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
      const all = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-scene="${name}"]`));

      const ctx = gsap.context(() => {
        const hero = one('hero');
        if (hero) {
          const leave = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 },
          });
          const figure = one('hero-figure');
          const title = one('hero-title');
          const pins = one('hero-pins');
          if (figure) leave.fromTo(figure, { scale: 1, yPercent: 0 }, { scale: 1.34, yPercent: 14 }, 0);
          if (title) leave.fromTo(title, { scale: 1, yPercent: 0 }, { scale: 0.86, yPercent: -34 }, 0);
          if (pins) leave.fromTo(pins, { opacity: 1 }, { opacity: 0, duration: 0.45 }, 0);
          for (const ruler of all('ruler')) leave.fromTo(ruler, { yPercent: 0 }, { yPercent: -16 }, 0);
        }

        const closing = one('closing');
        if (closing) {
          const arrive = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: { trigger: closing, start: 'top bottom', end: 'center center', scrub: 0.6 },
          });
          const temple = one('temple');
          const laurel = one('laurel');
          if (temple) arrive.fromTo(temple, { yPercent: 14, scale: 0.9 }, { yPercent: 0, scale: 1 }, 0);
          if (laurel) arrive.fromTo(laurel, { rotation: -32, scale: 0.78 }, { rotation: 0, scale: 1 }, 0);
        }
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
