import Link from 'next/link';
import { ViewTransition } from 'react';
import { WrittenText } from '@/components/ui/written-text';
import type { HeroLoop, ResolvedImage } from './brand-assets';
import { HeroMedia } from './hero-media';
import { InkGradient } from './ink-gradient';
import Magnet from './bits/Magnet';
import s from './landing.module.css';

/** Annotations in the manner of a technical drawing: plain text, a leader line, a point on the object. */
const PINS = [
  { label: 'Server-side time', side: 'left', pin: [-16, 3], node: [44, 12] },
  { label: 'Tenant isolation', side: 'right', pin: [116, 3], node: [62, 26] },
  { label: 'Balanced papers', side: 'left', pin: [-12, 88], node: [30, 76] },
  { label: 'Tamper-evident ledger', side: 'right', pin: [112, 94], node: [69, 82] },
] as const;

/** A calibrated rule, 0 to 100 marks, ticks every 2 and a label every 10. Decoration only. */
function Ruler({ side }: { side: 'left' | 'right' }) {
  const ticks = Array.from({ length: 51 }, (_, i) => i * 2);
  const x0 = side === 'left' ? 0 : 56;
  const dir = side === 'left' ? 1 : -1;
  return (
    <div className={`${s.ruler} ${side === 'left' ? s.rulerLeft : s.rulerRight}`} aria-hidden data-scene="ruler">
      <svg viewBox="0 0 56 1000" preserveAspectRatio="none">
        {ticks.map((m) => {
          const y = 1000 - m * 10;
          const len = m % 10 === 0 ? 14 : m % 2 === 0 && m % 4 === 0 ? 8 : 5;
          return <line key={m} x1={x0} x2={x0 + dir * len} y1={y} y2={y} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <div className={s.rulerLabels}>
        {ticks
          .filter((m) => m % 10 === 0)
          .map((m) => (
            <span key={m} className={s.rulerLabel} style={{ bottom: `${m}%`, [side]: 20 }}>
              {m}
            </span>
          ))}
        <span className={s.rulerUnit} style={{ [side]: 20 }}>
          Marks
        </span>
      </div>
    </div>
  );
}

export function Hero({ figure, loop, signedIn }: { figure: ResolvedImage | null; loop: HeroLoop | null; signedIn: boolean }) {
  return (
    <header className={`${s.hero} ${s.night}`} id="top" data-scene="hero">
      <div className={s.heroRays} />

      <nav className={s.nav} aria-label="Primary">
        <Link href="/" className={s.navMark} aria-label="Athena, home">
          Athena
        </Link>
        <ul className={s.navLinks}>
          <li className={s.navHideSmall}>
            <a href="#exhibits" className={s.textLink}>
              Exhibits
            </a>
          </li>
          <li className={s.navHideSmall}>
            <a href="#draw" className={s.textLink}>
              Live draw
            </a>
          </li>
          <li className={s.navHideSmall}>
            <a href="#proof" className={s.textLink}>
              Proof
            </a>
          </li>
          <li>
            <Link href={signedIn ? '/dashboard' : '/sign-in'} className={`${s.textLink} ${s.navAction}`}>
              {signedIn ? 'Open Athena' : 'Sign in'}
            </Link>
          </li>
        </ul>
      </nav>

      <Ruler side="left" />
      <Ruler side="right" />

      <div className={s.heroStage}>
        <ViewTransition name="athena-wordmark" share="morph" default="none">
          <h1 className={s.heroTitle} data-fit="0.85" data-scene="hero-title">
            <WrittenText text="Athena" className={s.heroInk} delay={200} />
          </h1>
        </ViewTransition>
        <InkGradient />

        {/* Only the wordmark morphs to the sign-in page. A view-transition snapshot drops the bust's screen blend,
            so a morphing bust would cross the page as a black box. */}
        {(figure || loop) && (
          <div className={s.heroFigure} data-scene="hero-figure">
            <HeroMedia poster={figure} loop={loop} />
          </div>
        )}

        <div className={s.pinBox} aria-hidden data-scene="hero-pins">
          <div className={s.pins} data-pins>
            <svg className={s.pinLines} viewBox="0 0 100 125" preserveAspectRatio="none">
              {PINS.map((p) => (
                <line
                  key={p.label}
                  x1={p.pin[0]}
                  y1={p.pin[1] * 1.25}
                  x2={p.node[0]}
                  y2={p.node[1] * 1.25}
                  stroke="rgb(255 244 230 / 0.55)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {PINS.map((p) => (
              <span key={`n-${p.label}`} className={s.node} style={{ left: `${p.node[0]}%`, top: `${p.node[1]}%` }} />
            ))}
            {PINS.map((p) => (
              <span key={p.label} className={s.pin} data-side={p.side} style={{ left: `${p.pin[0]}%`, top: `${p.pin[1]}%` }}>
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={s.heroFoot}>
        <p className={s.heroLine}>The secure online examination platform</p>
        <div className={s.heroRow}>
          <span>Papers balanced to ±2%</span>
          <Magnet padding={80} wrapperClassName={s.magnet}>
            <Link href={signedIn ? '/dashboard' : '/sign-in'} className={`${s.button} ${s.buttonGold}`}>
              {signedIn ? 'Open Athena' : 'Try the live demo'}
            </Link>
          </Magnet>
          <span>No camera, no microphone</span>
        </div>
      </div>
    </header>
  );
}
