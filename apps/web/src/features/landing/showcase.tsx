'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import SpotlightCard from './bits/SpotlightCard';
import c from './showcase.module.css';
import s from './landing.module.css';

export interface Step {
  id: string;
  line: string;
  detail: string;
  fragment: ReactNode;
}

/**
 * One exam, start to finish. On wide screens the five stages are a staircase of lines held beside the
 * product; the stage whose fragment is in view is lit. On narrow screens each stage sits above its fragment.
 */
export function Showcase({ steps, aside }: { steps: Step[]; aside?: ReactNode }) {
  const [active, setActive] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-step]'));
    const seen = new Map<Element, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
        let best = -1;
        let bestRatio = 0;
        items.forEach((el, i) => {
          const r = seen.get(el) ?? 0;
          if (r > bestRatio) {
            best = i;
            bestRatio = r;
          }
        });
        if (best >= 0) setActive(best);
      },
      { rootMargin: '-35% 0px -35% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className={c.layout} data-active={active === null ? undefined : active}>
      <div className={c.side}>
        <ol className={c.stairs} aria-hidden>
          {steps.map((st, i) => (
            <li key={st.id} className={c.stair} style={{ '--i': i } as CSSProperties} data-on={active === null || active === i ? '' : undefined}>
              <span className={c.node} />
              {st.line}
            </li>
          ))}
        </ol>
        {aside && <div className={c.column}>{aside}</div>}
      </div>
      <div className={c.track} ref={list}>
        {steps.map((st) => (
          <section key={st.id} className={c.step} data-step aria-labelledby={`step-${st.id}`}>
            <h3 id={`step-${st.id}`} className={c.stepLine}>
              {st.line}
            </h3>
            <SpotlightCard className="max-w-[460px] rounded-[15px] p-0" surfaceColor="transparent" spotlightSize={300} intensity={0.14}>
              {st.fragment}
            </SpotlightCard>
            <p className={`${s.body} ${c.detail}`}>{st.detail}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
