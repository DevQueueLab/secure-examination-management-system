'use client';

import { Check, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CountUp } from '@/components/ui/count-up';
import { cn } from '@/lib/cn';
import { spring, useReducedMotion } from '@/lib/motion';
import { useExamDisputeSummary } from '../api';
import { fmtDateTime, fmtRelative, plural } from '../format';
import type { ExamDisputeSummary } from '../types';
import { Hash, ScoreChange } from './primitives';

const PART: Record<string, string> = { answer: 'answer', working: 'working' };
/** The check lands on one block every 25 ms, and the whole walk never takes longer than 1.5 s. */
const STEP_MS = 25;
const CAP_MS = 1500;

type Verdict = { intact: boolean; checked: number; brokenAtSeq: number | null };
type Walk = { run: number; reached: number; done: boolean };

/**
 * The exam's grade ledger drawn as the chain it is, newest block first. Each block carries the hash of the block
 * before it, so a changed or deleted entry breaks every later link. Verify chain asks the server to walk the whole
 * ledger again while the check visibly lands on each block here; the verdict shown is the server's.
 */
export function LedgerExplorer({ data }: { data: ExamDisputeSummary }) {
  const reduced = useReducedMotion();
  const summary = useExamDisputeSummary(data.exam.id);
  const rows = data.recentLedger;
  const [walk, setWalk] = useState<Walk | null>(null);
  const [verdict, setVerdict] = useState<(Verdict & { run: number }) | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const runRef = useRef(0);
  const frame = useRef(0);
  const latest = useRef(data.ledger);
  latest.current = data.ledger;

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function verify() {
    const run = ++runRef.current;
    cancelAnimationFrame(frame.current);
    setVerdict(null);
    // The server re-walks every entry in the ledger; this request is the verification itself.
    const fetched = summary.refetch().then((r) => r.data?.ledger ?? latest.current);
    const settle = (l: Verdict) => {
      if (run !== runRef.current) return;
      setVerdict({ intact: l.intact, checked: l.checked, brokenAtSeq: l.brokenAtSeq, run });
    };
    if (reduced || rows.length === 0) {
      setWalk(null);
      void fetched.then(settle);
      return;
    }
    const step = Math.min(STEP_MS, CAP_MS / rows.length);
    const start = performance.now();
    setWalk({ run, reached: 0, done: false });
    let walked: () => void = () => {};
    const finished = new Promise<void>((resolve) => (walked = resolve));
    const tick = (now: number) => {
      if (run !== runRef.current) return;
      const broken = latest.current.intact ? -1 : rows.findIndex((r) => r.seq === latest.current.brokenAtSeq);
      const last = broken >= 0 ? broken : rows.length - 1;
      const reached = Math.min(last, Math.floor((now - start) / step));
      const done = reached >= last;
      setWalk({ run, reached, done });
      if (done) walked();
      else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    void Promise.all([fetched, finished]).then(([l]) => settle(l));
  }

  const l = data.ledger;
  // From the click until the server's verdict lands, the live line follows the check down the chain.
  const checking = walk !== null && verdict === null;
  const shown: Verdict = verdict ?? l;
  const earlier = Math.max(0, l.examEntries - rows.length);

  return (
    <section aria-label="Grade ledger" className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-title-3 font-semibold tracking-[-0.02em] text-label">Grade ledger</h3>
          <p className="mt-1 max-w-prose text-callout text-label-secondary">
            Every mark on this exam is a block carrying the hash of the block before it, newest first. Change or delete any entry and every later link stops matching.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <Button variant="tinted" onClick={verify} aria-busy={checking || summary.isFetching || undefined}>
            Verify chain
          </Button>
          <div aria-live="polite" className="min-h-6">
            {checking ? (
              <span className="text-footnote tabular-nums text-label-secondary">Checking block #{rows[walk.reached]?.seq ?? ''}</span>
            ) : (
              <motion.span
                key={verdict?.run ?? 'loaded'}
                initial={reduced || !verdict ? false : { scale: 0.8, opacity: 0.4, y: 4 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={spring.bouncy}
                className="inline-flex"
              >
                {shown.intact ? (
                  <Badge tone="gold">
                    <ShieldCheck aria-hidden />
                    Intact: {plural(shown.checked, 'entry', 'entries')} verified
                  </Badge>
                ) : (
                  <Badge tone="accent">
                    <ShieldAlert aria-hidden />
                    Broken at #{shown.brokenAtSeq ?? '?'}
                  </Badge>
                )}
              </motion.span>
            )}
          </div>
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-10 gap-y-3 border-y border-separator py-3 text-footnote">
        <div>
          <dt className="text-label-secondary">Whole ledger</dt>
          <dd className="text-title-3 text-label">
            <CountUp value={l.checked} className="numeral" />
          </dd>
        </div>
        <div>
          <dt className="text-label-secondary">This exam</dt>
          <dd className="text-title-3 text-label">
            <CountUp value={l.examEntries} className="numeral" delay={80} />
          </dd>
        </div>
        <div>
          <dt className="text-label-secondary">Last verified</dt>
          <dd className="pt-1.5 text-callout text-label">{fmtRelative(l.verifiedAt)}</dd>
        </div>
        {l.head && (
          <div>
            <dt className="text-label-secondary">Head of the chain</dt>
            <dd className="flex items-center gap-1.5 pt-1.5 text-callout text-label">
              #{l.head.seq} <Hash value={l.head.hash} />
            </dd>
          </div>
        )}
      </dl>

      {rows.length === 0 ? (
        <p className="text-callout text-label-secondary">No marks recorded yet.</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((r, i) => {
            const older = rows[i + 1];
            const gap = older ? r.seq - older.seq - 1 : 0;
            // Adjacent in the chain and both on screen: the link can be shown matching here.
            const adjacent = !!older && gap === 0;
            const matches = adjacent && r.prevHash === older.hash;
            const landed = walk !== null && walk.run === runRef.current && i <= walk.reached;
            const broken = !!verdict && !verdict.intact && verdict.brokenAtSeq === r.seq;
            const lit = hover === i && matches;
            const litFromAbove = hover === i - 1 && i > 0 && rows[i - 1]!.seq - r.seq === 1 && rows[i - 1]!.prevHash === r.hash;
            return (
              <li
                key={r.seq}
                className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              >
                <div aria-hidden className="relative flex justify-center">
                  {older && (
                    <motion.span
                      className={cn(
                        'absolute top-7 -bottom-4 w-0 origin-top border-l',
                        adjacent ? (matches ? 'border-separator-strong' : 'border-accent') : 'border-dashed border-label-quaternary',
                        lit && 'border-gold',
                      )}
                      initial={reduced ? false : { scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ ...spring.smooth, delay: Math.min(i * 0.02, 0.5) }}
                    />
                  )}
                  <span
                    className={cn(
                      'relative z-10 mt-3.5 grid size-5 place-items-center rounded-full border transition-colors duration-150',
                      broken ? 'border-accent bg-accent-tint text-accent-text' : landed ? 'border-gold bg-gold-tint text-gold-text' : 'border-separator-strong bg-surface',
                    )}
                  >
                    {broken ? (
                      <X className="size-3" strokeWidth={3} />
                    ) : landed ? (
                      <motion.span initial={reduced ? false : { scale: 0.3 }} animate={{ scale: 1 }} transition={spring.bouncy} className="grid place-items-center">
                        <Check className="size-3" strokeWidth={3} />
                      </motion.span>
                    ) : null}
                  </span>
                </div>
                <div className={cn('min-w-0 py-3', older && 'border-b border-separator')}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-subheadline">
                      <span className="font-mono text-footnote tabular-nums text-label-secondary">#{r.seq}</span>
                      <span className="font-semibold text-label">{r.label}</span>
                      {r.candidate && <span className="text-label-secondary">{r.candidate}</span>}
                      {r.question && (
                        <span className="text-label-secondary">
                          {r.question}
                          {r.part ? `, ${PART[r.part] ?? r.part}` : ''}
                        </span>
                      )}
                    </p>
                    {r.next !== null && <ScoreChange before={r.previous} after={r.next} size="sm" />}
                  </div>
                  {r.reason && <p className="mt-0.5 line-clamp-2 max-w-prose text-footnote text-label-secondary">{r.reason}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-label-tertiary">
                    <span className="font-medium text-label-secondary">{r.actor}</span>
                    <span className="tabular-nums">{fmtDateTime(r.at)}</span>
                    <span className="inline-flex items-center gap-1.5">
                      Previous <Hash value={r.prevHash} className={cn('text-caption transition-colors duration-150', lit && 'bg-gold-tint text-gold-text')} />
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      This block <Hash value={r.hash} className={cn('text-caption transition-colors duration-150', litFromAbove && 'bg-gold-tint text-gold-text')} />
                    </span>
                  </p>
                  {older && gap > 0 && (
                    <p className="mt-2 text-caption text-label-tertiary">
                      {plural(gap, 'entry', 'entries')} elsewhere in the ledger sit between this block and #{older.seq}.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {earlier > 0 && (
        <p className="text-footnote text-label-secondary">
          {plural(earlier, 'earlier block', 'earlier blocks')} for this exam are not drawn here. Verify chain checks them too, along with the rest of the ledger.
        </p>
      )}
    </section>
  );
}
