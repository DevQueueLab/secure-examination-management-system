'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { DIFFICULTY_LABEL, fmtShare } from '../format';
import type { ExposureRow } from '../types';

/**
 * How often each pool question lands on a paper. A dot plot on a 0–100% track: the balanced rate is a filled
 * dot, the random-draw rate a ring, and the hairline marks an even draw (drawCount / pool size). Exposure is
 * leak risk: a question shown to everyone reveals the most when it leaks.
 */

const TICKS = [0, 25, 50, 75, 100];

export function ExposureChart({ rows, view }: { rows: ExposureRow[]; view: 'chart' | 'table' }) {
  const [active, setActive] = useState<string | null>(null);

  if (view === 'table') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-callout sm:min-w-[30rem]">
          <caption className="sr-only">Share of simulated papers that include each pool question</caption>
          <thead>
            <tr className="border-b text-footnote text-label-secondary">
              <th scope="col" className="py-2 text-left font-medium">Question</th>
              <th scope="col" className="py-2 pl-3 text-left font-medium max-sm:hidden">Difficulty</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Balanced</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Random draw</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium max-sm:hidden">Even draw</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.questionId} className="border-b last:border-0">
                <td className="py-1.5 sm:max-w-[16rem] sm:truncate">
                  <span className="mr-1.5 tabular-nums text-label-secondary">{r.label}</span>
                  {r.title}
                </td>
                <td className="py-1.5 pl-3 text-label-secondary max-sm:hidden">{DIFFICULTY_LABEL[r.difficulty]}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums">{fmtShare(r.balancedRate)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums">{fmtShare(r.randomRate)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums text-label-secondary max-sm:hidden">{fmtShare(r.uniformRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div role="list" aria-label="Exposure of each pool question" className="flex flex-col">
      <div aria-hidden className="grid grid-cols-[minmax(0,1fr)] gap-x-4 pb-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_3rem]">
        <span className="max-sm:hidden" />
        <div className="relative h-4">
          {TICKS.map((t) => (
            <span key={t} className={cn('absolute text-caption tabular-nums text-label-tertiary', t === 0 ? '' : t === 100 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${t}%` }}>
              {t}%
            </span>
          ))}
        </div>
        <span className="max-sm:hidden" />
      </div>
      {rows.map((r) => {
        const on = active === r.questionId;
        return (
          <div
            key={r.questionId}
            role="listitem"
            tabIndex={0}
            aria-label={`${r.label} ${r.title}, ${DIFFICULTY_LABEL[r.difficulty]}: on ${fmtShare(r.balancedRate)} of balanced papers and ${fmtShare(r.randomRate)} of random ones; an even draw is ${fmtShare(r.uniformRate)}`}
            onPointerEnter={() => setActive(r.questionId)}
            onPointerLeave={() => setActive((a) => (a === r.questionId ? null : a))}
            onFocus={() => setActive(r.questionId)}
            onBlur={() => setActive((a) => (a === r.questionId ? null : a))}
            className="group grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-4 gap-y-1 rounded-lg px-1 py-2 outline-none transition-colors duration-100 hover:bg-fill-secondary focus-visible:bg-fill-secondary sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_3rem]"
          >
            <div className="col-span-2 flex min-w-0 items-baseline gap-2 sm:col-span-1">
              <span className="shrink-0 text-footnote tabular-nums text-label-tertiary">{r.label}</span>
              <span className="truncate text-callout text-label">{r.title}</span>
              <span className="ml-auto shrink-0 text-footnote text-label-tertiary sm:hidden">{DIFFICULTY_LABEL[r.difficulty]}</span>
            </div>
            <div className="relative h-6">
              {TICKS.map((t) => (
                <div key={t} aria-hidden className="absolute inset-y-1 w-px bg-separator" style={{ left: `${t}%` }} />
              ))}
              <div aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-separator-strong" />
              {/* Even draw reference */}
              <div aria-hidden className="absolute inset-y-0 w-px bg-label-secondary" style={{ left: `${r.uniformRate * 100}%` }} />
              {/* Random draw: ring */}
              <div
                aria-hidden
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-chart-6 bg-surface"
                style={{ left: `${r.randomRate * 100}%` }}
              />
              {/* Balanced: filled dot with a surface ring */}
              <div
                aria-hidden
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 shadow-[0_0_0_2px_var(--surface)]"
                style={{ left: `${r.balancedRate * 100}%` }}
              />
              {on && (
                <div className="pointer-events-none absolute bottom-full z-20 mb-1.5 w-max -translate-x-1/2 rounded-lg bg-surface-raised px-2.5 py-1.5 text-footnote shadow-md" style={{ left: `${Math.min(80, Math.max(20, r.balancedRate * 100))}%` }}>
                  <div>
                    <span className="font-semibold tabular-nums text-label">{fmtShare(r.balancedRate)}</span> <span className="text-label-secondary">of balanced papers</span>
                  </div>
                  <div>
                    <span className="font-semibold tabular-nums text-label">{fmtShare(r.randomRate)}</span> <span className="text-label-secondary">of random-draw papers</span>
                  </div>
                  <div>
                    <span className="font-semibold tabular-nums text-label">{fmtShare(r.uniformRate)}</span> <span className="text-label-secondary">with an even draw</span>
                  </div>
                </div>
              )}
            </div>
            <span className="text-right text-callout tabular-nums text-label">{fmtShare(r.balancedRate)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ExposureLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-footnote text-label-secondary">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full bg-chart-1" />
        Balanced
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full border-2 border-chart-6" />
        Random draw
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-px bg-label-secondary" />
        Even draw
      </li>
    </ul>
  );
}
