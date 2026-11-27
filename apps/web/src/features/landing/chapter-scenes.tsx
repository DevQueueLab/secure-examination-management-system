'use client';

import { useEffect } from 'react';

/**
 * The scrubbed motion below the hero, besides the tape itself (tape.tsx). The chapters' text and products are
 * drawn in their final places and never move with the scroll. At the protection chapter the marble is drawn back
 * off the dark glass, two answer sheets take on carmine ink and a line joins them; in the footer the two lengths
 * of tape crawl in opposite directions. All of it is tied to the scrollbar, so it runs backwards too, and
 * reduced motion skips it.
 */
export function ChapterScenes() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let revert: (() => void) | undefined;

    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);

      const ctx = gsap.context(() => {
        const protection = document.querySelector<HTMLElement>('[data-scene="protection"]');
        if (protection) {
          const plate = protection.querySelector('[data-plate]');
          if (plate) {
            gsap.fromTo(
              plate,
              { x: 0, xPercent: 0 },
              {
                x: 0,
                xPercent: 101,
                ease: 'none',
                // The marble only covers the glass once the scroll reaches it, so the drawn page stays dark.
                immediateRender: false,
                scrollTrigger: { trigger: protection, start: 'top bottom', end: 'top 35%', scrub: 0.6 },
              },
            );
          }
          const [first, second] = Array.from(protection.querySelectorAll<HTMLElement>('[data-ink]'));
          const links = Array.from(protection.querySelectorAll<SVGLineElement>('[data-link]'));
          const field = first?.closest<HTMLElement>('[aria-hidden]');
          if (field && first) {
            const tl = gsap.timeline({
              defaults: { ease: 'none' },
              scrollTrigger: { trigger: field, start: 'top 80%', end: 'center 45%', scrub: 0.6 },
            });
            tl.fromTo(first, { opacity: 0 }, { opacity: 1, duration: 0.35 }, 0);
            if (second) tl.fromTo(second, { opacity: 0 }, { opacity: 1, duration: 0.35 }, 0.3);
            if (links.length) tl.fromTo(links, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4 }, 0.6);
          }
        }

        const footer = document.querySelector<HTMLElement>('[data-scene="footer"]');
        if (footer) {
          footer.querySelectorAll<HTMLElement>('[data-tape-crawl]').forEach((band, i) => {
            const way = i % 2 === 0 ? -1 : 1;
            gsap.fromTo(
              band,
              { xPercent: way < 0 ? 0 : -12 },
              { xPercent: way < 0 ? -12 : 0, ease: 'none', scrollTrigger: { trigger: footer, start: 'top bottom', end: 'bottom bottom', scrub: 0.6 } },
            );
          });
        }
      });
      revert = () => ctx.revert();
      ScrollTrigger.refresh();
    });

    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return null;
}
