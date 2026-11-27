import Link from 'next/link';
import type { HeroLoop, ResolvedImage } from './brand-assets';
import { resolveBrandImage } from './brand-assets.server';
import Magnet from './bits/Magnet';
import { HeroParallax } from './hero-parallax';
import { Loader } from './loader';
import { Protagonist } from './protagonist';
import { HeroTape } from './hero-tape';
import { TapeMotion } from './hero-tape-motion';
import h from './hero.module.css';

/* Both bands in the bust frame's coordinates (800 by 1000). The back band rises behind her from the lower left;
   the front band crosses her shoulder and leaves the hero heading straight down at about 62% of the width, where
   the chapters' tape path picks it up. */
const BACK = 'M -300 960 C -80 680, 150 420, 520 170 S 980 -90, 1220 -180';
const FRONT = 'M 276 1060 C 276 880, 330 700, 600 540 S 900 330, 1130 236';

/**
 * The first screen, Ayaz's hierarchy: the offer in huge type on the left, everything else small, and one
 * oversized object centre-right, cropped by the fold: the marble Athena, sealed in carmine exam-paper tape. The
 * bust is the page's protagonist and leaves the hero for the first chapter; the front band runs on down the page.
 */
export function Hero({ signedIn }: { figure?: ResolvedImage | null; loop?: HeroLoop | null; signedIn: boolean }) {
  const bust = resolveBrandImage('athenaMarbleCut');
  return (
    <header className={h.hero} id="top" data-scene="hero" data-nav-theme="light">
      <div className={h.copy} data-scene="hero-intro">
        <h1 className={h.headline}>Turn exams into trusted results.</h1>
        <div className={h.aside}>
          <p className={h.subline}>
            Athena gives every candidate a fair paper of their own, keeps answers safe through a dropped connection, and seals every result so
            anyone can check it.
          </p>
          <div className={h.actions}>
            <Magnet padding={60} wrapperClassName={h.magnet}>
              <Link href={signedIn ? '/dashboard' : '/sign-in'} className={`${h.button} ${h.carmine}`}>
                {signedIn ? 'Open Athena' : 'Try the live demo'}
              </Link>
            </Magnet>
            {!signedIn && (
              <Link href="/sign-in" className={h.textLink}>
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className={h.frame} data-protagonist-slot>
        <div className={h.tapeBack} data-depth="10">
          <HeroTape
            id="tape-back"
            d={BACK}
            scene="tape-back"
            className={h.tapeSvg}
            bandClassName={h.band}
            edgeClassName={h.edge}
            textClassName={h.print}
          />
        </div>
        {bust && <Protagonist poster={bust} loop={null} />}
        <div className={h.tapeFront} data-depth="22">
          <HeroTape
            id="tape-front"
            d={FRONT}
            scene="tape-front"
            className={h.tapeSvg}
            bandClassName={h.band}
            edgeClassName={h.edge}
            textClassName={h.print}
          />
        </div>
      </div>
      <TapeMotion />
      <HeroParallax />
      <Loader />
    </header>
  );
}
