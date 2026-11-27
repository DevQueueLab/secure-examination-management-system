import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Instrument parts for the admin and staff screens that the shared Marks rule does not cover: parts of a
 * whole laid on the rule (a cohort, a set of exams) and light-numeral figures with their key.
 * Colours come from the shared data tokens (`--data-1` to `--data-5`, `--gold`).
 */

/** Light, tabular figures (the shared `numeral` utility): they read as precision rather than weight. */
export const numeral = 'numeral';

export type Ink = 'carmine' | 'graphite' | 'gold' | 'wine' | 'rest';

/** The data palette from globals.css: carmine subject, graphite comparison, gold target, wine, marble rest. */
export const INK_BG: Record<Ink, string> = {
  carmine: 'bg-data-1',
  graphite: 'bg-data-2',
  gold: 'bg-data-3',
  wine: 'bg-data-4',
  rest: 'bg-data-5',
};

/** The ruler itself: ticks rising from a baseline, scaled to the width it is given. */
export function Ticks({ height = 10, className }: { height?: number; className?: string }) {
  const lines: ReactNode[] = [];
  for (let x = 0; x <= 100; x += 2) {
    const major = x % 10 === 0;
    lines.push(
      <line
        key={x}
        x1={x}
        x2={x}
        y1={major ? 0 : height * 0.45}
        y2={height}
        className={major ? 'stroke-label-tertiary' : 'stroke-label-quaternary'}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        shapeRendering="crispEdges"
      />,
    );
  }
  return (
    <svg
      aria-hidden
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      overflow="visible"
      className={cn('block w-full', className)}
      style={{ height }}
    >
      {lines}
    </svg>
  );
}

/**
 * Parts of one whole laid along the rule, for a cohort or a set of exams.
 * Segments keep a 2px gap of ground between them; the ruler runs underneath.
 */
export function SegmentRule({
  segments,
  label,
  startLabel,
  endLabel,
  barClassName,
  className,
}: {
  segments: { key: string; value: number; ink: Ink }[];
  label: string;
  startLabel?: ReactNode;
  endLabel?: ReactNode;
  barClassName?: string;
  className?: string;
}) {
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div role="img" aria-label={label} className={cn('w-full', className)}>
      <div className={cn('flex h-3 w-full gap-[2px]', barClassName)}>
        {shown.length === 0 ? (
          <span className="h-full flex-1 rounded-[3px] bg-fill" />
        ) : (
          shown.map((s) => (
            <span
              key={s.key}
              className={cn(
                'h-full min-w-[3px] first:rounded-l-[3px] last:rounded-r-[3px]',
                INK_BG[s.ink],
              )}
              style={{ flexGrow: s.value, flexBasis: 0 }}
            />
          ))
        )}
      </div>
      <Ticks height={8} className="mt-1.5" />
      {(startLabel || endLabel) && (
        <div className="mt-1 flex justify-between gap-3 text-caption tabular-nums text-label-tertiary">
          <span>{startLabel}</span>
          <span className="text-right">{endLabel}</span>
        </div>
      )}
    </div>
  );
}

/** A figure for a legend: a key in its ink, a light numeral, and what it counts. */
export function Figure({
  value,
  label,
  ink,
  size = 'lg',
  className,
}: {
  value: ReactNode;
  label: ReactNode;
  ink?: Ink;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p
        className={cn(
          numeral,
          'text-label',
          size === 'lg' ? 'text-[2.75rem]/none sm:text-[3.25rem]/none' : 'text-[2rem]/none',
        )}
      >
        {value}
      </p>
      <p className="mt-3 flex items-center gap-2 text-footnote text-label-secondary">
        {ink && <span aria-hidden className={cn('size-2 shrink-0 rounded-[2px]', INK_BG[ink])} />}
        <span className="truncate">{label}</span>
      </p>
    </div>
  );
}
