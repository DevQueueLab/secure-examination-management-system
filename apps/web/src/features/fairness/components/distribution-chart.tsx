'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { fmtBand, fmtPercent, plural } from '../format';
import type { DistributionBin } from '../types';

/**
 * Overlaid histograms of expected paper difficulty: random draw (gray, behind) and balanced (accent, in front,
 * with a 2px surface ring where they overlap). One shared bin grid from the API, so the two series line up.
 * Plain HTML on the theme tokens: hairline grid, 4px rounded data ends, hover and focus tooltips, table twin.
 */

function niceTicks(peak: number): number[] {
  const top = Math.min(100, Math.max(5, peak));
  const rough = top / 4;
  const step = [1, 2, 2.5, 5, 10, 20, 25].find((s) => s >= rough) ?? 25;
  const max = Math.min(100, Math.ceil(top / step) * step);
  return Array.from({ length: Math.round(max / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

/** Axis labels at round values: a step that leaves at most `max` labels across the domain. */
function axisLabels(lo: number, hi: number, max = 7): number[] {
  const step = [0.5, 1, 2, 2.5, 5, 10, 20, 25].find((s) => Math.floor(hi / s) - Math.ceil(lo / s) + 1 <= max) ?? 25;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export interface DistributionChartProps {
  bins: DistributionBin[];
  runs: number;
  targetPercent: number;
  tolerancePercent: number;
  view: 'chart' | 'table';
  /** Dims the chart while a new simulation loads, keeping the frame. */
  stale?: boolean;
  height?: number;
}

export function DistributionChart({ bins, runs, targetPercent, tolerancePercent, view, stale, height = 220 }: DistributionChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const share = (count: number) => (runs > 0 ? (count / runs) * 100 : 0);

  if (bins.length === 0) return null;

  if (view === 'table') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-callout">
          <caption className="sr-only">Expected difficulty of simulated papers, balanced and random draw</caption>
          <thead>
            <tr className="border-b text-footnote text-label-secondary">
              <th scope="col" className="py-2 text-left font-medium">Expected score</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Balanced</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Random draw</th>
            </tr>
          </thead>
          <tbody>
            {bins
              .filter((b) => b.balanced > 0 || b.random > 0)
              .map((b) => (
                <tr key={b.from} className="border-b last:border-0">
                  <td className="py-1.5 tabular-nums">
                    {fmtPercent(b.from, 2)} – {fmtPercent(b.to, 2)}
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">
                    {fmtPercent(share(b.balanced), 1)} <span className="text-label-tertiary">({b.balanced})</span>
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">
                    {fmtPercent(share(b.random), 1)} <span className="text-label-tertiary">({b.random})</span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  }

  const lo = bins[0]!.from;
  const hi = bins.at(-1)!.to;
  const span = Math.max(1e-6, hi - lo);
  const x = (v: number) => ((v - lo) / span) * 100;
  const clampX = (v: number) => Math.min(100, Math.max(0, x(v)));
  const ticks = niceTicks(Math.max(...bins.map((b) => Math.max(share(b.balanced), share(b.random)))));
  const top = ticks.at(-1) || 100;
  const bandFrom = clampX(targetPercent - tolerancePercent);
  const bandTo = clampX(targetPercent + tolerancePercent);
  const targetX = x(targetPercent);
  const tip = active !== null ? bins[active] : null;

  return (
    <div role="group" aria-label="Expected difficulty of simulated papers" className={cn('relative select-none transition-opacity duration-200', stale && 'opacity-50')}>
      <div className="flex">
        <div aria-hidden className="relative w-10 shrink-0" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-2 translate-y-1/2 text-caption tabular-nums text-label-tertiary" style={{ bottom: `${(t / top) * 100}%` }}>
              {t}%
            </span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div key={t} aria-hidden className={cn('absolute inset-x-0 h-px', t === 0 ? 'bg-separator-strong' : 'bg-separator')} style={{ bottom: `${(t / top) * 100}%` }} />
          ))}

          {/* Tolerance band around the target */}
          {bandTo > bandFrom && (
            <div aria-hidden className="pointer-events-none absolute inset-y-0 rounded-[3px] bg-gold-tint" style={{ left: `${bandFrom}%`, width: `${bandTo - bandFrom}%` }} />
          )}

          <div className="absolute inset-0 flex">
            {bins.map((b, i) => {
              const rh = (share(b.random) / top) * 100;
              const bh = (share(b.balanced) / top) * 100;
              const dim = active !== null && active !== i;
              return (
                <div
                  key={b.from}
                  role="img"
                  tabIndex={0}
                  aria-label={`${b.from} to ${b.to} percent expected score: balanced ${fmtPercent(share(b.balanced))} of papers, random draw ${fmtPercent(share(b.random))}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((a) => (a === i ? null : a))}
                  className="relative flex h-full flex-1 items-end justify-center rounded-sm outline-none focus-visible:bg-fill-secondary"
                >
                  {b.random > 0 && (
                    <div
                      className={cn('absolute bottom-0 w-[min(24px,76%)] rounded-t-[4px] bg-chart-6 transition-opacity duration-150', dim ? 'opacity-30' : 'opacity-70')}
                      style={{ height: `${Math.max(1, rh)}%` }}
                    />
                  )}
                  {b.balanced > 0 && (
                    <div
                      className={cn(
                        'absolute bottom-0 w-[min(12px,42%)] rounded-t-[4px] bg-chart-1 shadow-[0_0_0_2px_var(--surface)] transition-opacity duration-150',
                        dim && 'opacity-40',
                      )}
                      style={{ height: `${Math.max(1, bh)}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Target */}
          {targetX >= 0 && targetX <= 100 && (
            <div aria-hidden className="pointer-events-none absolute inset-y-0 z-10" style={{ left: `${targetX}%` }}>
              <div className="h-full w-px -translate-x-1/2 bg-gold" />
              <span
                className={cn(
                  'absolute -top-5 whitespace-nowrap text-caption font-medium text-gold-text',
                  targetX > 70 ? 'right-1.5' : 'left-1.5',
                )}
              >
                Target {fmtPercent(targetPercent)}
              </span>
            </div>
          )}

          {tip && active !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute z-20 w-max -translate-x-1/2 rounded-lg bg-surface-raised px-2.5 py-2 text-footnote shadow-md"
              style={{
                left: `${Math.min(88, Math.max(12, ((active + 0.5) / bins.length) * 100))}%`,
                bottom: `calc(${(Math.max(share(tip.balanced), share(tip.random)) / top) * 100}% + 10px)`,
              }}
            >
              <div className="mb-1 tabular-nums text-label-secondary">
                {fmtPercent(tip.from, 2)} – {fmtPercent(tip.to, 2)} expected
              </div>
              <TipRow color="bg-chart-1" value={fmtPercent(share(tip.balanced))} label={`Balanced (${plural(tip.balanced, 'paper', 'papers')})`} />
              <TipRow color="bg-chart-6" value={fmtPercent(share(tip.random))} label={`Random draw (${plural(tip.random, 'paper', 'papers')})`} />
            </div>
          )}
        </div>
      </div>

      <div aria-hidden className="relative ml-10 mt-1.5 h-4">
        {axisLabels(lo, hi).map((v) => (
          <span key={v} className="absolute -translate-x-1/2 text-caption tabular-nums text-label-tertiary" style={{ left: `${x(v)}%` }}>
            {v}%
          </span>
        ))}
      </div>
      <p className="ml-10 mt-1 flex flex-wrap gap-x-4 text-caption text-label-tertiary">
        <span>Expected score of the paper, % of total marks</span>
        <span>Shaded band: target {fmtBand(tolerancePercent, 0)}</span>
      </p>
    </div>
  );
}

function TipRow({ color, value, label }: { color: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-0.5 w-2.5 shrink-0 rounded-full', color)} />
      <span className="font-semibold tabular-nums text-label">{value}</span>
      <span className="text-label-secondary">{label}</span>
    </div>
  );
}

/** Legend for the two assembly series plus the reference marks. */
export function DistributionLegend({ tolerancePercent }: { tolerancePercent: number }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-footnote text-label-secondary">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-[3px] bg-chart-1" />
        Balanced
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-[3px] bg-chart-6 opacity-70" />
        Random draw
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-px bg-gold" />
        Target
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-4 rounded-[3px] bg-gold-tint" />
        Tolerance {fmtBand(tolerancePercent, 0)}
      </li>
    </ul>
  );
}
