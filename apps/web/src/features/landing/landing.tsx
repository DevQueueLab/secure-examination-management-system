import { resolveBrandImages, resolveHeroLoop } from './brand-assets.server';
import { BrandPicture } from './brand-picture';
import { Exhibits } from './exhibits';
import { Hero } from './hero';
import { LandingEffects } from './landing-effects';
import { ScrollScenes } from './scroll-scenes';
import { WriteOnView } from './write-on-view';
import type { DrawMode } from './paper-draw';
import { PaperDrawLive } from './paper-draw-live';
import { Closing, Comparison, Footer, Proof } from './sections';
import { Showcase, type Step } from './showcase';
import { AthenaA } from './three/athena-a';
import DecryptedText from './bits/DecryptedText';
import { GatedThreads } from './bits/gated';
import { OfflineFragment, ParamQuestionFragment, ReceiptFragment, RubricFragment, TimerNavFragment } from './ui-fragments';
import d from './draw.module.css';
import s from './landing.module.css';

const KEYS = [
  'athenaGlass',
  'owlMarble',
  'owlGlass',
  'amphoraMarble',
  'amphoraGlass',
  'shieldMarble',
  'shieldGlass',
  'helmetMarble',
  'helmetGlass',
  'parthenonGlass',
  'laurelGlass',
] as const;

const VERIFY_CODE = 'ATH-7K2P-9QXM-4D8R';
const RECEIPT_CODE = 'RCPT-4F7Q-K2M9-XD3T';

export function Landing({ signedIn, seed, mode }: { signedIn: boolean; seed: number; mode: DrawMode }) {
  const img = resolveBrandImages(KEYS);
  const loop = resolveHeroLoop();
  const laurel = img.laurelGlass;

  const steps: Step[] = [
    {
      id: 'write',
      line: 'First you write the paper.',
      detail: 'A numeric question whose values are drawn for each candidate, with two of its five marks for the working.',
      fragment: <ParamQuestionFragment />,
    },
    {
      id: 'sit',
      line: 'Candidates sit it anywhere.',
      detail: 'The clock belongs to the server. The navigator shows what is answered, flagged and still open.',
      fragment: <TimerNavFragment />,
    },
    {
      id: 'offline',
      line: 'A dropped connection loses nothing.',
      detail: 'Answers are kept on the device and sent on reconnection. If time runs out offline, they are sealed where they are.',
      fragment: <OfflineFragment />,
    },
    {
      id: 'grade',
      line: 'Graders work to a rubric.',
      detail: 'Written answers are marked blind against the rubric, with credit for the working shown.',
      fragment: <RubricFragment />,
    },
    {
      id: 'verify',
      line: 'Anyone can verify the results.',
      detail: 'Every submission ends with a receipt, and every report carries a code that the public page checks.',
      fragment: <ReceiptFragment code={<DecryptedText text={RECEIPT_CODE} animateOn="view" sequential speed={40} />} />,
    },
  ];

  return (
    <div className={s.page}>
      <LandingEffects />
      <ScrollScenes />
      <Hero figure={img.athenaGlass} loop={loop} signedIn={signedIn} />

      <main>
        <Exhibits images={img} verifyCode={<DecryptedText text={VERIFY_CODE} animateOn="view" sequential speed={40} />} />

        <section id="draw" className={`${s.section} ${s.carmine} ${s.isolated}`} aria-labelledby="draw-title">
          <GatedThreads className={d.threads} opacity={0.42} lineCount={70} amplitude={1.4} speed={0.45} />
          <div className={`${s.wrap} ${s.grid}`}>
            <div className={s.sectionHead}>
              <h2 id="draw-title" className={s.head}>
                <WriteOnView text="Draw four papers." pen="#f2dfa7" />
              </h2>
              <p className={`${s.lead} ${d.method}`}>
                Every candidate gets different questions at the same difficulty. Try it with eight questions from a sample Data Structures bank.
              </p>
            </div>
          </div>
          <PaperDrawLive initialSeed={seed} initialMode={mode} />
        </section>

        <section id="journey" className={`${s.section} ${s.night}`} aria-labelledby="journey-title">
          <div className={`${s.wrap} ${s.grid}`}>
            <div className={s.sectionHead}>
              <h2 id="journey-title" className={s.head}>
                Follow one exam through Athena.
              </h2>
            </div>
          </div>
          <Showcase steps={steps} />
        </section>

        <Comparison />
        <Proof />
        <Closing
          temple={img.parthenonGlass}
          signedIn={signedIn}
          accent={
            <div className={s.accentStack}>
              {laurel && (
                <div className={s.laurel} data-scene="laurel">
                  <BrandPicture image={laurel} sizes="320px" decorative />
                </div>
              )}
              <AthenaA className={s.accentA} />
            </div>
          }
        />
      </main>

      <Footer signedIn={signedIn} />
    </div>
  );
}
