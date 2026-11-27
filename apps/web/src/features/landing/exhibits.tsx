import type { ReactNode } from 'react';
import type { ResolvedImage } from './brand-assets';
import { MatchCut } from './match-cut';
import { ItemAnalysisFragment, ProctorFragment, QuestionTypeFragment, VerifyFragment } from './ui-fragments';
import m from './exhibits.module.css';
import s from './landing.module.css';

export interface ExhibitImages {
  owlMarble: ResolvedImage | null;
  owlGlass: ResolvedImage | null;
  amphoraMarble: ResolvedImage | null;
  amphoraGlass: ResolvedImage | null;
  shieldMarble: ResolvedImage | null;
  shieldGlass: ResolvedImage | null;
  helmetMarble: ResolvedImage | null;
  helmetGlass: ResolvedImage | null;
}

interface Exhibit {
  id: string;
  name: string;
  marble: ResolvedImage | null;
  glass: ResolvedImage | null;
  myth: string;
  product: string;
  capabilities: string[];
  fragment: ReactNode;
}

export function Exhibits({ images, verifyCode }: { images: ExhibitImages; verifyCode: ReactNode }) {
  const exhibits: Exhibit[] = [
    {
      id: 'wisdom',
      name: 'Wisdom',
      marble: images.owlMarble,
      glass: images.owlGlass,
      myth: 'The owl was Athena’s bird, the one that sees what others miss in the dark.',
      product: 'After every exam, Athena tells you which questions worked.',
      capabilities: [
        'Difficulty and discrimination for every question, and KR-20 reliability for the whole paper.',
        'A distractor check that flags a key the strongest candidates disagreed with.',
        'Each sitting’s statistics go back into the bank, so the next paper is balanced on evidence.',
      ],
      fragment: <ItemAnalysisFragment />,
    },
    {
      id: 'craft',
      name: 'Craft',
      marble: images.amphoraMarble,
      glass: images.amphoraGlass,
      myth: 'Athena taught the crafts of the loom and the potter’s wheel, and her games gave painted jars of oil as prizes.',
      product: 'Write any kind of question once and use it for years.',
      capabilities: [
        'Ten question types, from single choice to code, each with its own marking rules.',
        'Numeric questions with values drawn for each candidate, so each candidate works their own numbers.',
        'Rubrics that give credit for the working, marked without the candidate’s name.',
      ],
      fragment: <QuestionTypeFragment />,
    },
    {
      id: 'protection',
      name: 'Protection',
      marble: images.shieldMarble,
      glass: images.shieldGlass,
      myth: 'As Athena Polias she guarded the city that carries her name.',
      product: 'Each institution is walled off, and every result can be checked.',
      capabilities: [
        'Every request is tied to one organisation and its permissions, checked on the server.',
        'Grade changes go into an append-only ledger, each entry chained to the one before.',
        'Reports are signed with Ed25519, and anyone holding one can verify it on a public page.',
      ],
      fragment: <VerifyFragment code={verifyCode} />,
    },
    {
      id: 'strategy',
      name: 'Strategy',
      marble: images.helmetMarble,
      glass: images.helmetGlass,
      myth: 'Where Ares fought with rage, Athena won with a plan.',
      product: 'Plan the sitting, then run it with the facts in front of you.',
      capabilities: [
        'Windows, access codes and extra time for accommodations, all set before the day.',
        'A deadline the server fixes for each candidate, capped at the close of the window.',
        'When a shared outage hits, Athena offers the lost minutes to exactly the candidates affected.',
      ],
      fragment: <ProctorFragment />,
    },
  ];

  return (
    <section id="exhibits" className={`${s.section} ${s.marble}`} aria-labelledby="exhibits-title">
      <div className={`${s.wrap} ${s.grid}`}>
        <div className={s.sectionHead}>
          <h2 id="exhibits-title" className={s.head}>
            Athena held four domains.
          </h2>
          <p className={`${s.lead} ${m.intro}`}>
            The goddess ruled wisdom, craft, the protection of cities and strategy. The platform takes on the same four duties.
          </p>
        </div>
        <nav className={m.index} aria-label="The four domains">
          <ul>
            {exhibits.map((ex) => (
              <li key={ex.id}>
                <a href={`#${ex.id}`}>
                  <span className={m.indexName}>{ex.name}</span>
                  <span className={m.indexLine}>{ex.product}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className={m.list}>
        {exhibits.map((ex, i) => (
          <article key={ex.id} id={ex.id} className={m.exhibit} data-flip={i % 2 === 1 ? '' : undefined} aria-labelledby={`${ex.id}-name`}>
            {(ex.marble || ex.glass) && (
              <figure className={m.figure}>
                <MatchCut marble={ex.marble} glass={ex.glass} />
              </figure>
            )}
            <div className={m.label}>
              <h3 id={`${ex.id}-name`} className={m.name}>
                {ex.name}
              </h3>
              <p className={m.myth}>{ex.myth}</p>
              <p className={m.product}>{ex.product}</p>
              <ul className={m.caps}>
                {ex.capabilities.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div className={m.fragment}>{ex.fragment}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
