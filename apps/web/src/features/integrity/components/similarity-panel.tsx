'use client';

import { Info, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSimilarity } from '../api';
import { count, duration, pct } from '../format';
import styles from '../integrity.module.css';
import type { Distribution, Passage, SimilarityPair, SimilarityReport, WrittenEvidence } from '../types';
import { MathText } from './math-text';

export function SimilarityPanel({ examId, selected, onSelect }: { examId: string; selected: string | null; onSelect: (pairId: string) => void }) {
  const query = useSimilarity(examId);
  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading similarity" className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl bg-surface p-5">
        <p className="text-callout text-label">{errorMessage(query.error, 'Similarity could not be computed.')}</p>
        <Button size="sm" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <SimilarityContent report={query.data} selected={selected} onSelect={onSelect} />;
}

function SimilarityContent({ report, selected, onSelect }: { report: SimilarityReport; selected: string | null; onSelect: (pairId: string) => void }) {
  const current = report.pairs.find((p) => p.id === selected || p.id === selected?.split(':').reverse().join(':')) ?? report.pairs[0] ?? null;
  const flaggedScores = report.pairs.filter((p) => p.objective).map((p) => p.objective!.score);
  const d = report.objective.distribution;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <section aria-labelledby="sim-dist">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h3 id="sim-dist" className="text-title-3 text-label">
              {report.pairs.length === 0 ? 'No pair stands out' : `${count(report.pairs.length, 'pair')} ${report.pairs.length === 1 ? 'stands' : 'stand'} out`}
            </h3>
            <p className="text-subheadline text-label-secondary" data-numeric>
              {count(d.pairs, 'pair')} compared on {count(report.objective.comparedItems, 'objective item')}
            </p>
          </div>
          <p className="mt-1 max-w-3xl text-subheadline text-label-secondary">
            Each pair scores the uncommon wrong answers both candidates gave: ones no more than {pct(report.thresholds.uncommonShare)} of the
            candidates gave, weighted by rarity (−ln of the share who gave that same answer). A pair is listed when its score is{' '}
            {report.thresholds.z} or more standard deviations above the typical pair and it shares at least {report.thresholds.minSharedWrong}{' '}
            uncommon wrong answers, or when {pct(report.thresholds.jaccard)} or more of a written answer’s wording overlaps.
          </p>
          {d.enough ? (
            <ScoreHistogram distribution={d} flagged={flaggedScores} z={report.thresholds.z} />
          ) : (
            <p className="mt-4 text-callout text-label-secondary">
              {d.pairs < 10
                ? 'Too few candidates have answered yet for a fair comparison. Pairs are scored once there are at least 5 attempts.'
                : 'Every pair scores the same so far, so no pair can stand out.'}
            </p>
          )}
          {report.written.distribution.pairs > 0 && (
            <p className="mt-3 text-footnote text-label-secondary" data-numeric>
              Written answers: {count(report.written.distribution.pairs, 'comparison')}
              {report.written.distribution.pairs >= 3
                ? `, typical overlap ${pct(report.written.distribution.mean)}, highest ${pct(report.written.distribution.max)}.`
                : ' between answers long enough to compare.'}
            </p>
          )}
        </section>

        {report.pairs.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Users />}
            title="No similar pairs"
            description="No two candidates share an unusual set of wrong answers or near-identical wording."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <ul aria-label="Similar pairs" className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]">
              {report.pairs.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-current={current?.id === p.id || undefined}
                    onClick={() => onSelect(p.id)}
                    className={cn(
                      'flex h-full w-full flex-col gap-1.5 rounded-xl px-4 py-3 text-left transition-colors duration-100',
                      current?.id === p.id ? 'bg-accent-tint' : 'bg-surface hover:bg-fill-secondary',
                    )}
                  >
                    <span className="truncate text-callout font-medium text-label">
                      {p.a.name} and {p.b.name}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {p.objective && (
                        <Badge size="sm" tone="warning">
                          {count(p.objective.sharedWrong.length, 'shared wrong answer')}
                        </Badge>
                      )}
                      {p.written.map((w) => (
                        <Badge key={w.questionId + w.field} size="sm" tone="info">
                          {pct(w.jaccard)} wording overlap
                        </Badge>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {current && <PairDetail pair={current} />}
          </div>
        )}
      </div>

      <aside aria-labelledby="caveats" className="flex flex-col gap-3 xl:sticky xl:top-28">
        <h3 id="caveats" className="flex items-center gap-2 text-headline text-label">
          <Info aria-hidden className="size-4 text-label-secondary" />
          Read this before acting
        </h3>
        <ul className="flex flex-col gap-2.5">
          {report.caveats.map((c) => (
            <li key={c} className="text-subheadline text-label-secondary">
              {c}
            </li>
          ))}
        </ul>
        <p className="border-t pt-3 text-subheadline text-label-secondary">
          A listed pair is a reason to look more closely, for example by asking both candidates to talk through their method. It never
          changes a mark on its own.
        </p>
      </aside>
    </div>
  );
}

/** Pair scores as a histogram, with the z = 3 line and the listed pairs marked on the same axis. */
function ScoreHistogram({ distribution, flagged, z }: { distribution: Distribution; flagged: number[]; z: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const bins = distribution.histogram;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const top = Math.max(distribution.max, 1e-9);
  const threshold = distribution.mean + z * distribution.sd;
  const at = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  // Bars use a square-root scale so a single outlying pair stays visible next to hundreds of ordinary ones.
  const h = (c: number) => (c === 0 ? 0 : 6 + 94 * Math.sqrt(c / maxCount));

  return (
    <figure className="mt-5">
      <div className="relative h-36" onPointerLeave={() => setHover(null)}>
        <div className="absolute inset-x-0 bottom-0 flex h-full items-end gap-[2px]">
          {bins.map((b, i) => (
            <div key={i} className="relative flex h-full flex-1 items-end" onPointerEnter={() => setHover(i)}>
              <div
                className={cn('w-full rounded-t-[4px] transition-colors duration-100', hover === i ? 'bg-label-secondary' : 'bg-label-quaternary')}
                style={{ height: `${h(b.count)}%` }}
              />
            </div>
          ))}
        </div>
        {threshold <= top && (
          <div className="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-label-tertiary" style={{ left: at(threshold) }}>
            <span className="absolute -top-0.5 left-1.5 whitespace-nowrap text-caption text-label-secondary">z = {z}</span>
          </div>
        )}
        {flagged.map((score, i) => (
          <span
            key={i}
            className="pointer-events-none absolute bottom-0 size-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-bg bg-warning"
            style={{ left: at(score) }}
            title={`Listed pair, score ${score.toFixed(2)}`}
          />
        ))}
        {hover !== null && bins[hover] && (
          <div
            role="tooltip"
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-surface-raised px-2 py-1 text-footnote text-label shadow-md"
            style={{ left: `${((hover + 0.5) / bins.length) * 100}%` }}
          >
            {count(bins[hover]!.count, 'pair')} scored {bins[hover]!.from.toFixed(1)}–{bins[hover]!.to.toFixed(1)}
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-between border-t pt-1.5 text-caption tabular-nums text-label-tertiary">
        <span>0</span>
        <span>Pair score (rarity-weighted uncommon shared wrong answers)</span>
        <span>{top.toFixed(1)}</span>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-footnote text-label-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-3 rounded-t-[3px] bg-label-quaternary" /> Pairs in this exam
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-warning" /> Listed pairs
        </span>
        <span data-numeric>
          Typical pair {distribution.mean.toFixed(2)} ± {distribution.sd.toFixed(2)}
        </span>
      </figcaption>
    </figure>
  );
}

function PairDetail({ pair }: { pair: SimilarityPair }) {
  const o = pair.objective;
  return (
    <section aria-label={`${pair.a.name} and ${pair.b.name}`} className="flex min-w-0 flex-col gap-5 rounded-xl bg-surface p-5">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2">
          <Avatar name={pair.a.name} size="sm" />
          <span className="text-headline text-label">{pair.a.name}</span>
        </span>
        <span className="text-callout text-label-tertiary">and</span>
        <span className="flex items-center gap-2">
          <Avatar name={pair.b.name} size="sm" />
          <span className="text-headline text-label">{pair.b.name}</span>
        </span>
      </header>

      {o && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-headline text-label">Shared wrong answers</h4>
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-footnote text-label-secondary" data-numeric>
              <span>Score {o.score.toFixed(2)}</span>
              {o.z !== null && <span>{o.z.toFixed(1)} SD above a typical pair</span>}
              <span>
                Both wrong on {o.bothWrong} of the {count(o.comparableItems, 'question')} they both answered
              </span>
            </p>
          </div>
          <ul className="flex flex-col divide-y divide-separator overflow-hidden rounded-lg bg-bg">
            {o.sharedWrong.map((w, i) => (
              <li key={i} className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap gap-x-3 text-footnote text-label-secondary">
                    <span className="font-medium text-label">{w.title}</span>
                    <span>
                      Q{w.positionA} on {pair.a.name.split(' ')[0]}’s paper, Q{w.positionB} on {pair.b.name.split(' ')[0]}’s
                    </span>
                  </p>
                  {w.response.includes('\n') ? (
                    <div className="mt-0.5 text-callout text-label">
                      Both answered
                      <ul className="mt-0.5 flex flex-col font-medium">
                        {w.response.split('\n').map((line, j) => (
                          <li key={j}>
                            <MathText inline>{line}</MathText>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-0.5 text-callout text-label">
                      Both answered <MathText inline className="font-medium">{w.response}</MathText>
                    </p>
                  )}
                  {w.variantNote && (
                    <p className="mt-0.5 text-footnote text-label-secondary">
                      {w.variantNote}, so the same number is unexpected. A shared method mistake can produce it too.
                    </p>
                  )}
                  <p className="text-footnote text-label-tertiary" data-numeric>
                    {w.apartMs !== null ? `Answered ${duration(w.apartMs)} apart` : 'Answer times unknown'}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill" aria-hidden>
                    <div className="h-full rounded-full bg-warning" style={{ width: `${Math.max(4, w.share * 100)}%` }} />
                  </div>
                  <p className="flex flex-wrap gap-x-3 text-footnote tabular-nums text-label-secondary">
                    <span>
                      {w.count} of {w.respondents} gave it
                    </span>
                    <span>Weight {w.weight.toFixed(2)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {o.within2Min !== null && (
            <p className="text-subheadline text-label-secondary">
              {timingLine(o.within2Min, o.sharedWrong.filter((w) => w.apartMs !== null).length)}
            </p>
          )}
        </div>
      )}

      {pair.written.map((w) => (
        <WrittenComparison key={w.questionId + w.field} pair={pair} evidence={w} />
      ))}
    </section>
  );
}

function timingLine(share: number, timed: number): string {
  const close = Math.round(share * timed);
  if (close === 0) return 'Timing: none of these were answered within 2 minutes of each other.';
  const lead = close === timed ? (timed === 1 ? 'It was' : `All ${timed} were`) : `${close} of ${timed} were`;
  return `Timing: ${lead} answered within 2 minutes of each other. Working through the paper in the same order produces close timings too.`;
}

function Highlighted({ text, passages }: { text: string; passages: Passage[] }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  passages.forEach((p, i) => {
    if (p.start > cursor) parts.push(text.slice(cursor, p.start));
    parts.push(
      <mark key={i} className={cn(styles.match, 'text-label')}>
        {text.slice(p.start, p.end)}
      </mark>,
    );
    cursor = p.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function WrittenComparison({ pair, evidence }: { pair: SimilarityPair; evidence: WrittenEvidence }) {
  const shared = (t: { text: string; passages: Passage[] }) => t.passages.reduce((n, p) => n + (p.end - p.start), 0) / Math.max(1, t.text.length);
  return (
    <div className={cn(styles.tokens, 'flex flex-col gap-3')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-headline text-label">{evidence.label}</h4>
        <p className="text-footnote text-label-secondary" data-numeric>
          {pct(evidence.jaccard)} of 5-character sequences shared, after removing the question text
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {([
          [pair.a, evidence.a],
          [pair.b, evidence.b],
        ] as const).map(([who, t]) => (
          <div key={who.attemptId} className="flex min-w-0 flex-col gap-1.5">
            <p className="flex flex-wrap gap-x-3 text-footnote text-label-secondary">
              <span className="font-medium text-label">{who.name}</span>
              <span>{pct(shared(t))} of the text highlighted</span>
            </p>
            <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-bg p-3 text-callout leading-relaxed text-label">
              <Highlighted text={t.text} passages={t.passages} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
