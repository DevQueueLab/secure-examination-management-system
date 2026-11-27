import { resolveBrandImages, resolveHeroLoop } from './brand-assets.server';
import { Chapter } from './chapters';
import { ChapterScenes } from './chapter-scenes';
import { Hero } from './hero';
import { SiteNav } from './nav';
import { LandingEffects } from './landing-effects';
import { ScrollScenes } from './scroll-scenes';
import type { DrawMode } from './paper-draw';
import { PaperDrawLive } from './paper-draw-live';
import { PageExit } from './page-exit';
import { Protection } from './protection';
import { Closing, Footer } from './sections';
import { TapeRun } from './tape';
import DecryptedText from './bits/DecryptedText';
import { OfflineFragment, ParamQuestionFragment, ProctorFragment, RubricFragment, VerifyFragment } from './ui-fragments';
import d from './draw.module.css';
import s from './landing.module.css';

const KEYS = ['athenaGlass', 'parthenonGlass'] as const;

const VERIFY_CODE = 'ATH-7K2P-9QXM-4D8R';

/*
 * The page follows one exam along a length of security tape: written, sat, watched, graded and certified.
 * Then the one chapter on dark glass shows how copying is caught, the live draw lets you try the balancing,
 * and the close invites you in. The marble Athena leaves the hero and comes to rest at the first stop.
 */
export function Landing({ signedIn, seed, mode }: { signedIn: boolean; seed: number; mode: DrawMode }) {
  const img = resolveBrandImages(KEYS);
  const loop = resolveHeroLoop();

  return (
    <PageExit>
    <div className={s.page}>
      <LandingEffects />
      <ScrollScenes />
      <ChapterScenes />
      <SiteNav signedIn={signedIn} />
      <Hero figure={img.athenaGlass} loop={loop} signedIn={signedIn} />

      <main>
        <TapeRun>
          <Chapter
            id="exam"
            side="left"
            slot
            title="Write the paper once."
            line="Each numeric question draws its own values for every candidate, and every paper is balanced to the same difficulty."
          >
            <ParamQuestionFragment tone="light" />
          </Chapter>
          <Chapter
            id="sit"
            side="right"
            title="Sit it anywhere."
            line="Answers are saved on the device as they are written, so a dropped connection costs nothing."
          >
            <OfflineFragment tone="light" />
          </Chapter>
          <Chapter
            id="watch"
            side="left"
            title="Watch the room live."
            line="The monitor shows who is writing, who has submitted and who has not started, and asks before it gives back lost minutes."
          >
            <ProctorFragment tone="light" />
          </Chapter>
          <Chapter
            id="grade"
            side="right"
            title="Grade it blind."
            line="Written answers are marked against the rubric without the candidate’s name, with credit for the working."
          >
            <RubricFragment tone="light" />
          </Chapter>
          <Chapter
            id="certify"
            side="left"
            title="Seal every result."
            line="Each report carries a signed code, and anyone can check it on the public verification page."
          >
            <VerifyFragment tone="light" code={<DecryptedText text={VERIFY_CODE} animateOn="view" sequential speed={40} />} />
          </Chapter>
        </TapeRun>

        <Protection figure={img.athenaGlass} clip={loop} />

        <section id="draw" className={`${s.section} ${s.carmine} ${s.isolated}`} aria-labelledby="draw-title">
          <div className={`${s.wrap} ${s.grid}`}>
            <div className={s.sectionHead}>
              <h2 id="draw-title" className={s.head}>
                Draw four papers.
              </h2>
              <p className={`${s.lead} ${d.method}`}>
                Every candidate gets different questions at the same difficulty. Try it with eight questions from a sample Data Structures bank.
              </p>
            </div>
          </div>
          <PaperDrawLive initialSeed={seed} initialMode={mode} />
        </section>

        <Closing signedIn={signedIn} figure={img.parthenonGlass} />
      </main>

      <Footer signedIn={signedIn} />
    </div>
    </PageExit>
  );
}
