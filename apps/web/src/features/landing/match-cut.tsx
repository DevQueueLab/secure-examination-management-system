'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import type { ResolvedImage } from './brand-assets';
import { BrandPicture } from './brand-picture';
import f from './fluted-glass.module.css';
import m from './exhibits.module.css';

/** Band width as a share of the stage (keep in step with --gw in fluted-glass.module.css), flute count, refraction. */
const GW = 0.24;
const GN = 10;
const REFRACT = 0.5;
const SIZES = '(max-width: 768px) 92vw, 46vw';

/**
 * Where everything sits for a progress p from 0 (band at the left edge, the object marble) to 1 (band at the
 * right edge, the object glass). The band never leaves the stage. Percentages only, so the resting state can
 * be rendered on the server.
 */
function layout(p: number) {
  const left = p * (1 - GW);
  const centre = left + GW / 2;
  const right = Math.min(100, Math.max(0, (1 - centre) * 100));
  return {
    band: `translate3d(${((left / GW) * 100).toFixed(3)}%,0,0)`,
    inner: (i: number) => {
      const shift = ((i - (GN - 1) / 2) * REFRACT * GW) / GN;
      return `translate3d(${((-(left + (i * GW) / GN) + shift) * 100).toFixed(3)}%,0,0) scale(1.06)`;
    },
    clip: `inset(0 ${right.toFixed(3)}% 0 0)`,
  };
}

/** The resting state, also what a reader without script or with reduced motion sees: half marble, half glass. */
const REST = layout(0.5);

/**
 * One exhibit's object. A panel of fluted glass crosses it as the page scrolls; behind the panel the marble
 * twin becomes the glass twin and the ground goes dark. Scrubbed by GSAP ScrollTrigger, loaded after hydration.
 */
export function MatchCut({ marble, glass, className }: { marble: ResolvedImage | null; glass: ResolvedImage | null; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const twin = Boolean(marble && glass);

  useEffect(() => {
    const stage = ref.current;
    if (!twin || !stage || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let revert: (() => void) | undefined;

    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const band = stage.querySelector<HTMLElement>('[data-band]');
      const glassLayer = stage.querySelector<HTMLElement>('[data-glass]');
      const inners = Array.from(stage.querySelectorAll<HTMLElement>('[data-inner]'));
      if (!band || !glassLayer) return;
      const state = { p: 0 };
      const apply = () => {
        const l = layout(state.p);
        band.style.transform = l.band;
        glassLayer.style.clipPath = l.clip;
        inners.forEach((n, i) => (n.style.transform = l.inner(i)));
      };
      const ctx = gsap.context(() => {
        gsap.fromTo(
          state,
          { p: 0 },
          {
            p: 1,
            ease: 'none',
            onUpdate: apply,
            scrollTrigger: { trigger: stage, start: 'top 78%', end: 'bottom 22%', scrub: 0.6 },
          },
        );
      });
      apply();
      revert = () => ctx.revert();
    });

    return () => {
      cancelled = true;
      revert?.();
    };
  }, [twin]);

  return (
    <div ref={ref} className={`${m.stage} ${className ?? ''}`}>
      {marble && (
        <div className={m.marbleLayer}>
          <BrandPicture image={marble} sizes={SIZES} />
        </div>
      )}
      {glass && (
        <div className={m.glassLayer} data-glass style={twin ? { clipPath: REST.clip } : undefined}>
          <BrandPicture image={glass} sizes={SIZES} decorative={twin} />
        </div>
      )}
      {twin && glass && (
        <div className={f.band} data-band style={{ transform: REST.band, '--gn': GN } as CSSProperties} aria-hidden>
          {Array.from({ length: GN }, (_, i) => (
            <div key={i} className={f.strip}>
              <div className={f.inner} data-inner style={{ transform: REST.inner(i) }}>
                <BrandPicture image={glass} sizes={SIZES} decorative />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
