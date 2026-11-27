import type { HeroLoop, ResolvedImage } from './brand-assets';
import { GlassFigure } from './glass-figure';
import p from './protection.module.css';

/*
 * Protection, told beside the glass Athena (the marble hero's twin, played through once as it arrives) and as one picture: a field of identical answer sheets in which two light up carmine and are
 * joined by a line, the way Athena puts two sheets that agree too closely side by side for a person to review.
 * It is scrubbed by the scroll in chapter-scenes.tsx; the drawn state shows the pair lit and joined.
 */

const SHEETS = 48;
/* The pair, as indices into the field: 12 columns on wide screens, 6 on a phone. */
const PAIR: readonly [number, number] = [15, 32];
const centre = (i: number, cols: number, rows: number) => [((i % cols) + 0.5) * (100 / cols), (Math.floor(i / cols) + 0.5) * (100 / rows)] as const;

function Link({ cols, rows, className }: { cols: number; rows: number; className?: string }) {
  const a = centre(PAIR[0], cols, rows);
  const b = centre(PAIR[1], cols, rows);
  return (
    <svg className={className} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} pathLength={1} data-link vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Protection({ figure, clip }: { figure?: ResolvedImage | null; clip?: HeroLoop | null }) {
  return (
    <section id="proof" className={p.section} aria-labelledby="proof-title" data-scene="protection" data-nav-theme="dark">
      <div className={p.head}>
        <div className={p.text}>
          <h2 id="proof-title" className={p.title}>
            Copying leaves a trace.
          </h2>
          <p className={p.line}>
            Two answer sheets that agree too closely are set side by side for a person to review, and every copied question carries a hidden
            mark that names its paper.
          </p>
        </div>
        {figure && <GlassFigure image={figure} clip={clip} className={p.figure} sizes="(max-width: 767px) 92vw, 48vw" />}
      </div>
      <div className={p.field} aria-hidden="true">
        <Link cols={12} rows={4} className={p.linkWide} />
        <Link cols={6} rows={8} className={p.linkNarrow} />
        {Array.from({ length: SHEETS }, (_, i) => (
          <div key={i} className={p.sheet} data-pair={PAIR.includes(i) || undefined}>
            <span className={p.ink} data-ink={PAIR.includes(i) || undefined} />
            <i />
            <i />
            <i />
            <i />
          </div>
        ))}
      </div>
    </section>
  );
}
