'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatCount, formatWeekday } from '../format';

/**
 * Daily attempts as thin bars: one series, so no legend; the card title names it.
 * Each bar is focusable and reports its own value, and the max sits on a single recessive gridline.
 */
export function AttemptsChart({ days }: { days: { day: string; attempts: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.attempts));
  // A round gridline value just above the max.
  const step =
    max <= 5 ? 5 : max <= 10 ? 10 : max <= 50 ? Math.ceil(max / 10) * 10 : Math.ceil(max / 50) * 50;
  const total = days.reduce((n, d) => n + d.attempts, 0);
  const iso = (d: string) => `${d}T12:00:00`;

  return (
    <figure className="flex flex-col gap-3">
      <div className="relative h-36">
        <span
          aria-hidden
          className="absolute left-0 top-0 text-caption leading-4 tabular-nums text-label-tertiary"
        >
          {formatCount(step)}
        </span>
        <div aria-hidden className="absolute inset-x-0 top-5 h-px bg-separator" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-separator-strong" />
        <ol
          className="absolute inset-0 flex items-end gap-[2px] pt-5"
          aria-label={`Attempts per day, last ${days.length} days: ${formatCount(total)} in total`}
        >
          {days.map((d, i) => {
            const h = d.attempts === 0 ? 0 : Math.max(4, (d.attempts / step) * 100);
            const label = `${formatWeekday(iso(d.day))}: ${formatCount(d.attempts)} ${d.attempts === 1 ? 'attempt' : 'attempts'}`;
            const isToday = i === days.length - 1;
            return (
              <li
                key={d.day}
                tabIndex={0}
                aria-label={label}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="group relative flex h-full flex-1 items-end justify-center rounded-sm outline-none focus-visible:bg-fill-secondary"
              >
                <span
                  className={cn(
                    'w-full max-w-7 rounded-t-[4px] transition-opacity duration-100',
                    isToday ? 'bg-chart-1' : 'bg-chart-1/70',
                    active !== null && active !== i && 'opacity-40',
                  )}
                  style={{ height: `${h}%` }}
                />
                {active === i && (
                  <span
                    role="tooltip"
                    className="material pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-footnote shadow-md"
                  >
                    <span className="block text-label-secondary">{formatWeekday(iso(d.day))}</span>
                    <span className="block font-semibold tabular-nums text-label">
                      {formatCount(d.attempts)} {d.attempts === 1 ? 'attempt' : 'attempts'}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <figcaption className="flex justify-between text-caption text-label-tertiary" aria-hidden>
        <span>{days[0] ? formatWeekday(iso(days[0].day)) : ''}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}
