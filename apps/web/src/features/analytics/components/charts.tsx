'use client';

import { Check } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/cn';
import { fmtPercent, fmtShare, plural } from '../format';
import { Meta } from './meta';

/**
 * Charts for grading, results and analytics. Plain HTML so they follow the theme tokens in every mode:
 * thin bars (24px cap) with a 4px rounded data end and a square baseline, hairline grids, hover and focus
 * tooltips, and a table view for every chart.
 */

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

/** A round upper bound for the y axis and the ticks below it. */
function niceTicks(peak: number): number[] {
  if (peak <= 4) return Array.from({ length: Math.max(peak, 1) + 1 }, (_, i) => i);
  const rough = peak / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const top = Math.ceil(peak / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

export function ChartViewToggle({ value, onChange, label }: { value: 'chart' | 'table'; onChange: (v: 'chart' | 'table') => void; label: string }) {
  return (
    <SegmentedControl
      size="sm"
      aria-label={`${label}: chart or table`}
      value={value}
      onValueChange={onChange}
      options={[
        { value: 'chart', label: 'Chart' },
        { value: 'table', label: 'Table' },
      ]}
    />
  );
}

export interface ScoreHistogramProps {
  bins: HistogramBin[];
  /** Draws the pass mark as a dashed rule. */
  passPercent?: number | null;
  /** Accessible name and the noun in tooltips. */
  label?: string;
  unit?: [one: string, many: string];
  view?: 'chart' | 'table';
  height?: number;
  className?: string;
}

/** Score distribution in ten-point bins. One series, so the title names it and there is no legend. */
export function ScoreHistogram({
  bins,
  passPercent = null,
  label = 'Score distribution',
  unit = ['candidate', 'candidates'],
  view = 'chart',
  height = 176,
  className,
}: ScoreHistogramProps) {
  const [active, setActive] = useState<number | null>(null);
  const total = bins.reduce((s, b) => s + b.count, 0);
  const ticks = niceTicks(Math.max(1, ...bins.map((b) => b.count)));
  const top = ticks[ticks.length - 1] || 1;

  if (view === 'table') {
    return (
      <table className={cn('w-full text-callout', className)}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b text-footnote text-label-secondary">
            <th scope="col" className="py-2 text-left font-medium">Score band</th>
            <th scope="col" className="py-2 text-right font-medium">{unit[1][0]!.toUpperCase() + unit[1].slice(1)}</th>
            <th scope="col" className="py-2 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((b, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-1.5 tabular-nums">
                {b.from}–{b.to}%
              </td>
              <td className="py-1.5 text-right tabular-nums">{b.count}</td>
              <td className="py-1.5 text-right tabular-nums text-label-secondary">{total ? fmtPercent((b.count / total) * 100) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const tip = active !== null ? bins[active] : null;
  return (
    <div role="group" aria-label={label} className={cn('relative select-none', className)}>
      <div className="flex">
        {/* y axis */}
        <div aria-hidden className="relative w-7 shrink-0" style={{ height }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-2 translate-y-1/2 text-caption tabular-nums text-label-tertiary"
              style={{ bottom: `${(t / top) * 100}%` }}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div
              key={t}
              aria-hidden
              className={cn('absolute inset-x-0 h-px', t === 0 ? 'bg-separator-strong' : 'bg-separator')}
              style={{ bottom: `${(t / top) * 100}%` }}
            />
          ))}
          {passPercent !== null && passPercent > 0 && passPercent < 100 && (
            <div aria-hidden className="pointer-events-none absolute inset-y-0 z-10" style={{ left: `${passPercent}%` }}>
              <div className="h-full border-l border-dashed border-label-secondary" />
              <span className="absolute -top-0.5 left-1.5 whitespace-nowrap text-caption font-medium text-label-secondary">
                Pass {fmtPercent(passPercent)}
              </span>
            </div>
          )}
          <div className="absolute inset-0 flex">
            {bins.map((b, i) => {
              const h = b.count ? Math.max(1.5, (b.count / top) * 100) : 0;
              return (
                <div
                  key={i}
                  role="img"
                  tabIndex={0}
                  aria-label={`${b.from} to ${b.to} percent: ${plural(b.count, unit[0], unit[1])}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  className="group relative flex h-full flex-1 items-end justify-center rounded-sm outline-none focus-visible:bg-fill-secondary"
                >
                  <div
                    className={cn(
                      'w-[min(24px,62%)] rounded-t-[4px] bg-chart-1 transition-opacity duration-150',
                      active !== null && active !== i && 'opacity-45',
                    )}
                    style={{ height: `${h}%` }}
                  />
                </div>
              );
            })}
          </div>
          {tip && active !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-surface-raised px-2.5 py-1.5 text-footnote shadow-md"
              style={{ left: `${(active + 0.5) * (100 / bins.length)}%`, bottom: `calc(${(tip.count / top) * 100}% + 8px)` }}
            >
              <div className="font-semibold tabular-nums text-label">{plural(tip.count, unit[0], unit[1])}</div>
              <div className="tabular-nums text-label-secondary">{tip.from}–{tip.to}%</div>
              {total > 0 && <div className="tabular-nums text-label-secondary">{fmtPercent((tip.count / total) * 100)} of all</div>}
            </div>
          )}
        </div>
      </div>
      {/* x axis: bin edges */}
      <div aria-hidden className="relative ml-7 mt-1.5 h-4">
        {bins.map((b, i) => (
          <span
            key={i}
            className={cn('absolute -translate-x-1/2 text-caption tabular-nums text-label-tertiary', i % 2 === 1 && 'max-sm:hidden')}
            style={{ left: `${(i / bins.length) * 100}%` }}
          >
            {b.from}
          </span>
        ))}
        <span className="absolute right-0 translate-x-1/2 text-caption tabular-nums text-label-tertiary">100%</span>
      </div>
    </div>
  );
}

/** A thin horizontal meter (0-1) for table cells and lists. Fully rounded: it has no baseline axis. */
export function Meter({ value, className, tone = 'accent', label }: { value: number | null; className?: string; tone?: 'accent' | 'neutral'; label: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(pct)}
      className={cn('relative h-1.5 overflow-hidden rounded-full bg-fill', className)}
    >
      <div className={cn('absolute inset-y-0 left-0 rounded-full', tone === 'accent' ? 'bg-chart-1' : 'bg-label-tertiary')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export interface DistractorRow {
  id: string;
  letter: string;
  text: string;
  isKey: boolean;
  count: number;
  upperShare: number;
  lowerShare: number;
}

/**
 * Upper vs lower 27% groups per option. Two series, so a legend is always shown and each bar carries its
 * value. Colours validated for both modes (blue / orange, CVD-safe); text stays in label inks.
 */
export function DistractorChart({
  rows,
  upperSize,
  lowerSize,
  view = 'chart',
  footer,
}: {
  rows: DistractorRow[];
  upperSize: number;
  lowerSize: number;
  view?: 'chart' | 'table';
  footer?: ReactNode;
}) {
  const id = useId();
  const seriesVars = '[--series-upper:var(--chart-1)] [--series-lower:#e0700a] dark:[--series-lower:#e07b00]';

  if (view === 'table') {
    return (
      <table className="w-full text-callout">
        <caption className="sr-only">Option choice by upper and lower scoring groups</caption>
        <thead>
          <tr className="border-b text-footnote text-label-secondary">
            <th scope="col" className="py-2 text-left font-medium">Option</th>
            <th scope="col" className="py-2 text-right font-medium">Chosen</th>
            <th scope="col" className="py-2 text-right font-medium">Upper 27%</th>
            <th scope="col" className="py-2 text-right font-medium">Lower 27%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="py-1.5">
                <span className="font-medium">{r.letter}</span> {r.isKey && <span className="text-success-text">(key)</span>}
              </td>
              <td className="py-1.5 text-right tabular-nums">{r.count}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtShare(r.upperShare)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtShare(r.lowerShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', seriesVars)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-footnote text-label-secondary" id={`${id}-legend`}>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--series-upper)]" />
          Top 27% of scorers <span className="tabular-nums text-label-tertiary">({upperSize})</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--series-lower)]" />
          Bottom 27% <span className="tabular-nums text-label-tertiary">({lowerSize})</span>
        </span>
      </div>
      <ul className="flex flex-col gap-3" aria-describedby={`${id}-legend`}>
        {rows.map((r) => (
          <li key={r.id} className="grid grid-cols-[minmax(0,13rem)_1fr] items-center gap-x-4 max-sm:grid-cols-1 max-sm:gap-y-1.5">
            <div className="flex min-w-0 items-start gap-2">
              <span
                className={cn(
                  'mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-md text-caption font-semibold',
                  r.isKey ? 'bg-success-tint text-success-text' : 'bg-fill text-label-secondary',
                )}
              >
                {r.isKey ? <Check aria-label="Correct option" className="size-3" strokeWidth={3} /> : r.letter}
              </span>
              <span className="min-w-0 text-subheadline text-label">
                <span className="line-clamp-2">{r.text}</span>
                <span className="block text-footnote tabular-nums text-label-tertiary">
                  <Meta items={[r.isKey ? 'Key' : null, plural(r.count, 'pick')]} />
                </span>
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              {(
                [
                  ['upper', r.upperShare, 'Top 27%'],
                  ['lower', r.lowerShare, 'Bottom 27%'],
                ] as const
              ).map(([key, share, name]) => (
                <div key={key} className="flex items-center gap-2" title={`${name}: ${fmtShare(share)}`}>
                  <div className="relative h-2.5 flex-1">
                    <div
                      role="img"
                      aria-label={`${r.letter}, ${name}: ${fmtShare(share)}`}
                      className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--series-upper)] data-[series=lower]:bg-[var(--series-lower)]"
                      data-series={key}
                      style={{ width: `${Math.max(share > 0 ? 0.8 : 0, share * 100)}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-caption tabular-nums text-label-secondary">{fmtShare(share)}</span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {footer && <p className="text-footnote text-label-secondary">{footer}</p>}
    </div>
  );
}
