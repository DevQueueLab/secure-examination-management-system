import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ResolvedImage } from './brand-assets';
import { BrandPicture } from './brand-picture';
import Magnet from './bits/Magnet';
import x from './sections.module.css';
import s from './landing.module.css';

/* ---------- Comparison, set as text ---------- */

const COMPARE: { topic: string; athena: string; usual: string }[] = [
  {
    topic: 'Timing',
    athena: 'The server fixes the deadline when the attempt starts. The browser only shows it.',
    usual: 'The countdown runs in the browser, where a reload or a changed clock can upset it.',
  },
  {
    topic: 'A lost connection',
    athena: 'Answers stay on the device and are sent when the connection returns.',
    usual: 'Work since the last save is lost, and the candidate asks for a resit.',
  },
  {
    topic: 'Randomized papers',
    athena: 'Each candidate gets different questions, balanced to within 2% of the same expected score.',
    usual: 'Questions are shuffled by chance, so one paper can be much harder than another.',
  },
  {
    topic: 'Leaked papers',
    athena: 'Every copied question carries an invisible mark that names its paper.',
    usual: 'A leaked screenshot rarely says whose paper it came from.',
  },
  {
    topic: 'Integrity',
    athena: 'Indicators send a session to a person for review. They never trigger a penalty on their own.',
    usual: 'Webcam software records the candidate’s room and flags them automatically.',
  },
  {
    topic: 'Grade changes',
    athena: 'Every change goes into an append-only ledger with its reason.',
    usual: 'Marks are edited in a spreadsheet and the old value is gone.',
  },
  {
    topic: 'Disputes',
    athena: 'Candidates query a question in the app, and the decision is recorded with any regrade.',
    usual: 'Queries arrive by email and are settled out of sight.',
  },
  {
    topic: 'Reports',
    athena: 'Reports are signed, and anyone can verify one on a public page.',
    usual: 'A PDF can be changed by anyone with an editor.',
  },
];

export function Comparison() {
  return (
    <section id="compare" className={`${s.section} ${s.carmine}`} aria-labelledby="compare-title">
      <div className={`${s.wrap} ${s.grid}`}>
        <div className={s.sectionHead}>
          <h2 id="compare-title" className={s.head}>
            Compare it with the usual way.
          </h2>
        </div>
      </div>
      <div className={s.wrap}>
        <table className={x.compare}>
          <caption className={s.srOnly}>Athena compared with the usual way of running online exams</caption>
          <thead>
            <tr>
              <td />
              <th scope="col" className={x.compareAthena}>
                Athena
              </th>
              <th scope="col" className={x.compareUsual}>
                The usual way
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((row) => (
              <tr key={row.topic}>
                <th scope="row" className={x.compareTopic}>
                  {row.topic}
                </th>
                <td className={x.compareAthena}>
                  <span className={x.compareTag}>Athena</span>
                  {row.athena}
                </td>
                <td className={x.compareUsual}>
                  <span className={x.compareTag}>The usual way</span>
                  {row.usual}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- Proof: each guarantee and the mechanism that enforces it ---------- */

const PROOF: { layer: string; rows: [string, string][] }[] = [
  {
    layer: 'On the server',
    rows: [
      [
        'Time cannot be added from the browser.',
        'The server fixes each deadline at the start: the start time plus the duration, capped at the window’s close. Writes after a short grace for the last autosave are refused.',
      ],
      ['Every paper is equally hard.', 'Questions are drawn for each candidate and swapped until every paper’s expected score is within 2% of the pool’s.'],
      ['Passwords resist guessing.', 'Passwords are hashed with argon2id, and sign-in attempts are rate limited.'],
      [
        'One organisation never sees another’s data.',
        'Every route requires an active tenant and the permissions it names. Authorization is enforced on the server, never by hiding buttons.',
      ],
    ],
  },
  {
    layer: 'In the database',
    rows: [
      [
        'Grade history cannot be rewritten.',
        'A trigger rejects every UPDATE and DELETE on the grade ledger, and each entry is chained to the one before it by an HMAC.',
      ],
      ['Previews never reach the results.', 'One shared query scope keeps examiner sandbox attempts out of every statistic, result list and monitor view.'],
    ],
  },
  {
    layer: 'For anyone holding a result',
    rows: [
      ['A report can be checked by anyone.', 'Reports are signed with Ed25519 over canonical JSON, and the public verification page checks the signature.'],
      ['A candidate can prove what they submitted.', 'The receipt is an HMAC-SHA256 of the final answers, shown as RCPT-XXXX-XXXX-XXXX.'],
    ],
  },
  {
    layer: 'In the browser',
    rows: [
      ['No camera and no microphone, ever.', 'The site’s Permissions-Policy header switches both off, so no page can ask for them.'],
      [
        'Offline work survives the deadline.',
        'Answers are journaled on the device. If time runs out offline, the journal is sealed with a SHA-256 hash chain, so any edit to it shows.',
      ],
      ['A leaked question names its paper.', 'Each question stem carries its paper’s code in zero-width characters, and copied text carries it too.'],
    ],
  },
];

export function Proof() {
  return (
    <section id="proof" className={`${s.section} ${s.marble}`} aria-labelledby="proof-title">
      <div className={`${s.wrap} ${s.grid}`}>
        <div className={s.sectionHead}>
          <h2 id="proof-title" className={s.head}>
            Every guarantee has a mechanism.
          </h2>
          <p className={`${s.lead} ${x.proofLead}`}>Each promise on this page, and the part of the system that keeps it.</p>
        </div>
      </div>
      <div className={s.wrap}>
        <table className={x.proof}>
          <caption className={s.srOnly}>Guarantees and the mechanisms that enforce them, by layer</caption>
          <thead className={s.srOnly}>
            <tr>
              <th scope="col">Guarantee</th>
              <th scope="col">Mechanism</th>
            </tr>
          </thead>
          {PROOF.map((group) => (
            <tbody key={group.layer}>
              <tr className={x.proofLayer}>
                <th scope="rowgroup" colSpan={2}>
                  {group.layer}
                </th>
              </tr>
              {group.rows.map(([g, mech]) => (
                <tr key={g}>
                  <th scope="row" className={x.proofGuarantee}>
                    {g}
                  </th>
                  <td className={x.proofMechanism}>{mech}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

/* ---------- Closing: the object returns ---------- */

export function Closing({ temple, signedIn, accent }: { temple: ResolvedImage | null; signedIn: boolean; accent?: ReactNode }) {
  return (
    <section id="start" className={`${x.closing} ${s.night}`} aria-labelledby="closing-title" data-scene="closing">
      {temple && (
        <div className={x.temple} data-scene="temple">
          <BrandPicture image={temple} sizes="(max-width: 1023px) 100vw, 60vw" />
        </div>
      )}
      <div className={x.closingText}>
        {accent && <div className={x.accent}>{accent}</div>}
        <h2 id="closing-title" className={x.closingLine}>
          Run your exams on Athena.
        </h2>
        <p className={`${s.body} ${x.closingBody}`}>
          The demo has an institution and a competition league, with an account for every role. Every demo account uses the password{' '}
          <strong className={x.password}>Athena@2026</strong>.
        </p>
        <div className={x.closingActions}>
          <Magnet padding={80} wrapperClassName={s.magnet}>
            <Link href={signedIn ? '/dashboard' : '/sign-in'} className={`${s.button} ${s.buttonGold}`}>
              {signedIn ? 'Open Athena' : 'Try the live demo'}
            </Link>
          </Magnet>
        </div>
      </div>
    </section>
  );
}

/* ---------- Footer: the address is the headline ---------- */

export function Footer({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className={`${x.footer} ${s.carmine}`}>
      <div className={x.footerTop}>
        <a href="https://athena.devqueue.co" className={x.address}>
          athena.
          <wbr />
          devqueue.co
        </a>
        <nav aria-label="Footer" className={x.footerNav}>
          <a href="#exhibits" className={s.textLink}>
            Exhibits
          </a>
          <a href="#draw" className={s.textLink}>
            Live draw
          </a>
          <a href="#proof" className={s.textLink}>
            Proof
          </a>
          <Link href={signedIn ? '/dashboard' : '/sign-in'} className={s.textLink}>
            {signedIn ? 'Open Athena' : 'Sign in'}
          </Link>
        </nav>
      </div>
      <div className={x.footerGrid}>
        <div>
          <h2 className={x.footerHead}>Type</h2>
          <p className={x.footerText}>Athens by La Rosna; Switzer by Indian Type Foundry.</p>
        </div>
        <div>
          <h2 className={x.footerHead}>Made for</h2>
          <p className={x.footerText}>Built for Technoverse 5.0 Web-e-Thon.</p>
        </div>
      </div>
    </footer>
  );
}
