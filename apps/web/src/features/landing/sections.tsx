import Link from 'next/link';
import type { ResolvedImage } from './brand-assets';
import { BrandPicture } from './brand-picture';
import Magnet from './bits/Magnet';
import { TapeStrip } from './tape';
import x from './sections.module.css';
import s from './landing.module.css';

/* ---------- Closing: the invitation, beside the glass Parthenon on night ---------- */

export function Closing({ signedIn, figure }: { signedIn: boolean; figure?: ResolvedImage | null }) {
  return (
    <section id="start" className={x.closing} aria-labelledby="closing-title" data-scene="closing" data-nav-theme="dark">
      <div className={x.closingText}>
        <h2 id="closing-title" className={x.closingLine}>
          Run your exams on Athena.
        </h2>
        <p className={x.closingBody}>Sit a sample paper as a candidate, grade it as the examiner and check the receipt it leaves behind.</p>
        <div className={x.closingActions}>
          <Magnet padding={80} wrapperClassName={s.magnet}>
            <Link href={signedIn ? '/dashboard' : '/sign-in'} className={`${s.button} ${s.buttonCarmine} ${x.closingButton}`}>
              {signedIn ? 'Open Athena' : 'Try the live demo'}
            </Link>
          </Magnet>
        </div>
      </div>
      {figure && <BrandPicture image={figure} className={x.closingFigure} imgClassName={x.closingImage} sizes="(max-width: 1023px) 140vw, 92vw" />}
    </section>
  );
}

/* ---------- Footer: the name, sealed with two lengths of tape ---------- */

export function Footer({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className={x.footer} data-scene="footer">
      <div className={x.sealed} aria-hidden="true">
        <p className={x.wordmark}>Athena</p>
        <TapeStrip className={x.tapeA} />
        <TapeStrip className={x.tapeB} />
      </div>
      <div className={x.footerRow}>
        <nav aria-label="Footer" className={x.footerNav}>
          <a href="#exam" className={s.textLink}>
            The exam
          </a>
          <a href="#proof" className={s.textLink}>
            Integrity
          </a>
          <a href="#draw" className={s.textLink}>
            Live draw
          </a>
          <Link href={signedIn ? '/dashboard' : '/sign-in'} className={s.textLink}>
            {signedIn ? 'Open Athena' : 'Sign in'}
          </Link>
        </nav>
        <p className={x.footerText}>
          athena.devqueue.co. Set in Athens by La Rosna and Switzer by Indian Type Foundry. Built for Technoverse 5.0 Web-e-Thon.
        </p>
      </div>
    </footer>
  );
}
