'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { createRng, dealPapers, estimateP, fmt1, fmtP, POOL, TOLERANCE_PERCENT, type Difficulty, type DrawMode } from './paper-draw';
import ClickSpark from './bits/ClickSpark';
import { Figure } from './figure';
import d from './draw.module.css';
import s from './landing.module.css';

const LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** The seed the next draw uses: derived from this one, so the no-script form and the script agree. */
export const nextSeed = (seed: number) => Math.floor(createRng(seed).next() * 2 ** 31);

/**
 * The live thing: four candidates draw four of eight questions each. Balanced mode swaps questions until
 * each paper is within 2% of the pool's expected score; pure chance does not. Without script the same
 * controls submit a GET form and the server deals the papers.
 */
export function PaperDrawLive({ initialSeed, initialMode }: { initialSeed: number; initialMode: DrawMode }) {
  const [seed, setSeed] = useState(initialSeed);
  const [mode, setMode] = useState<DrawMode>(initialMode);
  const deal = useMemo(() => dealPapers(seed, mode), [seed, mode]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSeed((x) => nextSeed(x));
  };

  const easiest = Math.max(...deal.papers.map((p) => p.expected));
  const hardest = Math.min(...deal.papers.map((p) => p.expected));

  return (
    <div className={d.live}>
      <form className={d.controls} method="get" action="/#draw" onSubmit={onSubmit} aria-label="Draw the papers">
        <input type="hidden" name="deal" value={nextSeed(seed)} />
        <fieldset className={d.segmented}>
          <legend className={s.srOnly}>How papers are drawn</legend>
          {(['balanced', 'chance'] as const).map((m) => (
            <label key={m} className={d.segment} data-on={mode === m ? '' : undefined}>
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className={d.radio} />
              {m === 'balanced' ? 'Balanced' : 'Pure chance'}
            </label>
          ))}
        </fieldset>
        <ClickSpark sparkColor={['#FFD9DC', '#F2DFA7']} sparkCount={10} sparkRadius={36} className={d.sparkWrap}>
          <button type="submit" className={`${s.button} ${s.buttonPink} ${d.again}`}>
            Draw again
          </button>
        </ClickSpark>
      </form>

      <p className={d.spread} aria-live="polite">
        Spread between the easiest and hardest paper: <Figure value={deal.spread} className={d.spreadValue} /> points
      </p>
      <p className={d.spreadNote}>
        {mode === 'balanced'
          ? `Every paper is held within ${TOLERANCE_PERCENT}% (${fmt1(deal.tolerance)} marks) of the pool’s expected score of ${fmt1(deal.target)} of 20.`
          : `Pure chance draws any four questions, so the same candidate could score ${fmt1(easiest - hardest)} marks more on one paper than on another.`}
      </p>

      <ol className={d.papers} aria-label="Four papers">
        {deal.papers.map((p) => {
          const off = p.expected - deal.target;
          return (
            <li key={p.candidate} className={d.paper} data-outside={p.withinTolerance ? undefined : ''}>
              <div className={d.paperHead}>
                <span className={d.candidate}>{p.candidate}</span>
                <span className={d.status}>{p.withinTolerance ? `Within ${TOLERANCE_PERCENT}%` : `Outside ${TOLERANCE_PERCENT}%`}</span>
              </div>
              <ol className={d.questions}>
                {p.questions.map((q) => (
                  <li key={q.id} className={d.question}>
                    <span>{q.title}</span>
                    <span className={d.qLabel} data-level={q.difficulty}>
                      {LABEL[q.difficulty]}
                    </span>
                  </li>
                ))}
              </ol>
              <div className={d.paperFoot}>
                <span>
                  Expected <Figure value={p.expected} className={d.expected} /> of {p.totalMarks}
                </span>
                <span className={d.delta}>
                  {Math.abs(off) < 0.05 ? 'On the pool’s score' : `${off > 0 ? '+' : '−'}${fmt1(Math.abs(off))} against the pool`}
                </span>
              </div>
              {(p.sameAs || (mode === 'balanced' && p.swaps > 0)) && (
                <p className={d.note}>
                  {p.sameAs ? `Same four questions as ${p.sameAs}, in a different order.` : `Balanced with ${p.swaps} ${p.swaps === 1 ? 'swap' : 'swaps'}.`}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <div className={d.poolWrap}>
        <h3 className={d.poolTitle}>The pool of eight questions</h3>
        <div className={d.poolScroll}>
        <table className={d.pool}>
          <caption className={s.srOnly}>Each question’s label, past results and the difficulty Athena estimates from them</caption>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Label</th>
              <th scope="col">Sat by</th>
              <th scope="col">Share scored</th>
              <th scope="col">Estimate</th>
            </tr>
          </thead>
          <tbody>
            {POOL.map((q) => (
              <tr key={q.id}>
                <th scope="row">{q.title}</th>
                <td>{LABEL[q.difficulty]}</td>
                <td>{q.observedN}</td>
                <td>{fmtP(q.observedP)}</td>
                <td>{fmtP(estimateP(q))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className={d.formula}>
          Estimate = (10 × the label’s prior + candidates × share scored) ÷ (10 + candidates). The priors are .80 for easy, .60 for medium
          and .40 for hard, so a question few candidates have sat stays close to its label.
        </p>
      </div>
    </div>
  );
}
