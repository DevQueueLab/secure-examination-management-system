import { Check, CircleAlert, Clock, Lock, ShieldCheck, WifiOff } from 'lucide-react';
import DecryptedText from './bits/DecryptedText';
import f from './fragments.module.css';

type Tone = 'light' | 'dark';
const root = (tone: Tone, extra = '') => ({ className: `${f.frag} ${extra}`.trim(), 'data-ui': '', 'data-tone': tone });

/** Wisdom: one exam read back, with the finding stated in plain words. */
export function ItemAnalysisFragment({ tone = 'light' }: { tone?: Tone }) {
  return (
    <div {...root(tone)} aria-label="Item analysis for the Data Structures midterm" role="group">
      <div className={f.fHead}>
        <span className={f.fTitle}>Item analysis</span>
        <span className={f.fBadge} data-kind="success">
          KR-20 <span className={f.fNum}>0.81</span>, good
        </span>
      </div>
      <table className={f.fTable}>
        <thead>
          <tr>
            <th scope="col">Question</th>
            <th scope="col" title="Difficulty: share of marks earned">
              p
            </th>
            <th scope="col" title="Discrimination: top 27% minus bottom 27%">
              D
            </th>
            <th scope="col">Skipped</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Q3 Heap parent index</td>
            <td>.71</td>
            <td>.38</td>
            <td>0%</td>
          </tr>
          <tr className={f.fRowAlert}>
            <td className={f.fStrong}>Q4 BFS shortest path</td>
            <td>.57</td>
            <td className={f.fNeg}>−.12</td>
            <td>3%</td>
          </tr>
          <tr>
            <td>Q5 AVL height balance</td>
            <td>.49</td>
            <td>.44</td>
            <td>6%</td>
          </tr>
        </tbody>
      </table>
      <div className={f.fCallout}>
        <CircleAlert aria-hidden color="var(--f-danger)" />
        <div>
          <p className={f.fCalloutTitle}>Q4 may be miskeyed</p>
          <p>High scorers chose C more often than the key B (6 vs 2 of the top 8). Check the key and the wording.</p>
        </div>
      </div>
    </div>
  );
}

const TYPES = [
  ['Single choice', 'Auto-graded'],
  ['True / False', 'Auto-graded'],
  ['Multiple select', 'Partial credit'],
  ['Numeric', 'Per-candidate values'],
  ['Short answer', 'Accepted answers'],
  ['Fill in the blanks', 'Each blank credited'],
  ['Matching', 'Each pair credited'],
  ['Ordering', 'Credit by position'],
  ['Written response', 'Rubric'],
  ['Code', 'Rubric'],
] as const;

/** Craft: the ten question types, one being chosen. */
export function QuestionTypeFragment({ tone = 'light' }: { tone?: Tone }) {
  return (
    <div {...root(tone)} aria-label="The question type picker" role="group">
      <div className={f.fHead}>
        <span className={f.fTitle}>New question</span>
        <span className={f.fSub}>Data Structures bank</span>
      </div>
      <div className={f.fTypes}>
        {TYPES.map(([name, meta]) => (
          <div key={name} className={f.fType} data-selected={name === 'Numeric' ? '' : undefined}>
            <span className={f.fTypeName}>{name}</span>
            <span className={f.fTypeMeta}>{meta}</span>
          </div>
        ))}
      </div>
      <div className={f.fFoot}>A number checked with tolerance. Can be parameterized per candidate.</div>
    </div>
  );
}

/** Protection: the public verification page, as anyone holding a report sees it. */
export function VerifyFragment({ tone = 'light', code }: { tone?: Tone; code: React.ReactNode }) {
  return (
    <div {...root(tone)} aria-label="A report verified on the public page" role="group">
      <div className={f.fVerdict}>
        <span className={f.fSeal} data-seal>
          <Check aria-hidden strokeWidth={3} />
        </span>
        <div>
          <div className={f.fVerdictTitle}>Authentic</div>
          <div className={f.fSub}>Issued by Northfield Institute of Technology, unchanged since.</div>
        </div>
      </div>
      <dl className={f.fDl}>
        <dt>Report</dt>
        <dd className={f.fCode}>{code}</dd>
        <dt>Candidate</dt>
        <dd>Ali Hassan</dd>
        <dt>Exam</dt>
        <dd>Data Structures Midterm</dd>
        <dt>Score</dt>
        <dd>78 of 100</dd>
        <dt>Signature</dt>
        <dd>
          Ed25519, key{' '}
          <DecryptedText text="7c1e9b04a2d3f856" characters="0123456789abcdef" animateOn="view" sequential speed={45} />
        </dd>
      </dl>
      <div className={f.fFoot}>
        <span className={f.fRow}>
          <span>Grade ledger, 96 entries</span>
          <span className={f.fBadge} data-kind="success">
            <ShieldCheck aria-hidden size={14} /> Chain intact
          </span>
        </span>
      </div>
    </div>
  );
}

/** Strategy: the live proctor view of one sitting. Counts add up: 21 + 2 + 1 = 24. */
export function ProctorFragment({ tone = 'light' }: { tone?: Tone }) {
  return (
    <div {...root(tone)} aria-label="The live proctor view" role="group">
      <div className={f.fHead}>
        <span className={f.fTitle}>Data Structures Midterm</span>
        <span className={f.fBadge} data-kind="accent">
          Live at <time className={f.fNum}>10:42:17</time>
        </span>
      </div>
      <div className={f.fStats}>
        {[
          ['24', 'Sitting'],
          ['21', 'Answering'],
          ['2', 'Offline'],
          ['1', 'Submitted'],
        ].map(([v, l]) => (
          <div key={l} className={f.fStat}>
            <div className={f.fStatValue}>{v}</div>
            <div className={f.fSub}>{l}</div>
          </div>
        ))}
      </div>
      <div className={f.fSeat}>
        <span className={f.fStrong}>FA24-BCS-007</span>
        <span className={f.fNum}>31:12 left</span>
        <span className={f.fSub}>Answering question 6 of 12</span>
      </div>
      <div className={f.fSeat}>
        <span className={f.fStrong}>FA24-BCS-012</span>
        <span className={f.fNum}>35:12 left</span>
        <span className={f.fSub}>
          <WifiOff aria-hidden size={13} style={{ verticalAlign: '-2px' }} /> Offline 0:42, answers kept on the device
        </span>
      </div>
      <div className={f.fSeat}>
        <span className={f.fStrong}>FA24-BCS-023</span>
        <span className={f.fBadge} data-kind="success">
          Submitted
        </span>
      </div>
      <div className={f.fCallout} data-kind="warning">
        <Clock aria-hidden color="var(--f-warning)" />
        <div>
          <p className={f.fCalloutTitle}>Shared outage at 10:21</p>
          <p>8 of 24 candidates lost their connection within two minutes. Give them back the 4 minutes they lost?</p>
        </div>
      </div>
    </div>
  );
}

/** Author: a numeric question whose values differ for every candidate. */
export function ParamQuestionFragment({ tone = 'dark' }: { tone?: Tone }) {
  return (
    <div {...root(tone)} aria-label="A parameterized numeric question in the editor" role="group">
      <div className={f.fHead}>
        <span className={f.fTitle}>Numeric, 5 marks</span>
        <span className={f.fBadge} data-kind="accent">
          Parameterized
        </span>
      </div>
      <div className={f.fBody}>
        <p style={{ margin: 0 }}>
          A hash table holds <span className={f.fParam}>n</span> keys in <span className={f.fParam}>m</span> buckets. What is the
          expected chain length?
        </p>
      </div>
      <table className={f.fTable}>
        <tbody>
          <tr>
            <td>n</td>
            <td>600 to 900, step 50</td>
          </tr>
          <tr>
            <td>m</td>
            <td>200 to 300, step 25</td>
          </tr>
          <tr>
            <td>Answer</td>
            <td>n ÷ m, within ±0.01</td>
          </tr>
          <tr>
            <td>Show your working</td>
            <td>2 of the 5 marks</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Sit: the server's clock and the question navigator. */
export function TimerNavFragment({ tone = 'dark' }: { tone?: Tone }) {
  const states: ('answered' | 'flagged' | 'open')[] = [
    'answered', 'answered', 'flagged', 'answered', 'answered', 'open',
    'answered', 'flagged', 'open', 'open', 'open', 'open',
  ];
  const count = (state: (typeof states)[number]) => states.filter((st) => st === state).length;
  return (
    <div {...root(tone)} aria-label="The exam timer and question navigator" role="group">
      <div className={f.fHead}>
        <span className={f.fSub}>Time left, kept by the server</span>
        <span className={f.fBadge} data-kind="success">
          In sync
        </span>
      </div>
      <div className={f.fBody}>
        <div className={f.fTimer}>
          <time>00:31:12</time>
        </div>
        <div className={f.fNav} style={{ marginTop: 12 }}>
          {states.map((st, i) => (
            <span key={i} className={f.fQ} data-state={st} data-current={i === 5 ? '' : undefined}>
              {i + 1}
            </span>
          ))}
        </div>
        <div className={f.fLegend}>
          <span>{count('answered')} answered</span>
          <span>{count('flagged')} flagged</span>
          <span>{count('open')} unanswered</span>
        </div>
      </div>
    </div>
  );
}

/** Sit: what the candidate sees when the connection drops. */
export function OfflineFragment({ tone = 'dark' }: { tone?: Tone }) {
  return (
    <div {...root(tone)} aria-label="The offline save notice and the sealed journal" role="group">
      <div className={f.fBody} style={{ display: 'grid', gap: 12 }}>
        <span className={f.fSave}>
          <WifiOff aria-hidden size={16} /> Offline, 3 answers saved on this device
        </span>
        <div className={f.fCallout} data-kind="warning" style={{ margin: 0 }}>
          <Lock aria-hidden color="var(--f-warning)" />
          <div>
            <p className={f.fCalloutTitle}>Time is up</p>
            <p>Your answers are sealed on this device and will be sent when you reconnect.</p>
          </div>
        </div>
        <svg className={f.fScratch} viewBox="0 0 400 132" aria-label="Scratchpad with a sketched binary tree">
          <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.8">
            <circle cx="200" cy="28" r="14" />
            <circle cx="140" cy="74" r="14" />
            <circle cx="260" cy="74" r="14" />
            <circle cx="110" cy="116" r="12" />
            <circle cx="170" cy="116" r="12" />
            <path d="M190 39 150 63M210 39 250 63M132 86 117 105M148 86 163 105" />
          </g>
          <g fill="currentColor" fontSize="15" fontFamily="inherit" opacity="0.85">
            <text x="194" y="33">8</text>
            <text x="134" y="79">3</text>
            <text x="250" y="79">10</text>
            <text x="295" y="40">h = 2</text>
            <text x="295" y="64">balanced</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

/** Grade: a rubric with credit for the working. */
export function RubricFragment({ tone = 'dark' }: { tone?: Tone }) {
  const rows: [string, string, boolean][] = [
    ['States the load factor n ÷ m', '1', true],
    ['Substitutes 750 and 250', '1', true],
    ['Final answer 3.00', '3', false],
  ];
  return (
    <div {...root(tone)} aria-label="Rubric grading with credit for working" role="group">
      <div className={f.fHead}>
        <span className={f.fTitle}>Q7, FA24-BCS-019</span>
        <span className={f.fSub}>Blind marking</span>
      </div>
      <p className={f.fWorking} style={{ marginTop: 12 }}>
        load = n / m = 750 / 250 = 2.5
      </p>
      {rows.map(([label, marks, on]) => (
        <div key={label} className={f.fRubric}>
          <span>
            <span className={f.fCheck} data-on={on ? '' : undefined}>
              {on && <Check aria-hidden strokeWidth={3} />}
            </span>
            {label}
          </span>
          <span className={f.fNum}>{on ? marks : '0'} / {marks}</span>
        </div>
      ))}
      <div className={f.fFoot}>
        <span className={f.fRow}>
          <span>Awarded for working</span>
          <span className={`${f.fNum} ${f.fStrong}`}>2 of 5</span>
        </span>
      </div>
    </div>
  );
}

/** Verify: the receipt every candidate keeps. */
export function ReceiptFragment({ tone = 'dark', code }: { tone?: Tone; code: React.ReactNode }) {
  return (
    <div {...root(tone)} aria-label="The submission receipt" role="group">
      <div className={f.fVerdict}>
        <span className={f.fSeal}>
          <Check aria-hidden strokeWidth={3} />
        </span>
        <div>
          <div className={f.fVerdictTitle}>Submitted</div>
          <div className={f.fSub}>12 of 12 answers received at 11:13:40</div>
        </div>
      </div>
      <dl className={f.fDl}>
        <dt>Receipt</dt>
        <dd className={f.fCode}>{code}</dd>
        <dt>Exam</dt>
        <dd>Data Structures Midterm</dd>
        <dt>Results</dt>
        <dd>Released by the examiner</dd>
      </dl>
    </div>
  );
}
