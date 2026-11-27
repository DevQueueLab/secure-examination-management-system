import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The Marks rule: Athena's one measuring instrument, drawn like the rulers on the landing hero's edges.
 * Major ticks every tenth of the range, minor ticks every fiftieth, a carmine needle (or fill) for the value,
 * an optional gold pass-mark tick and a gold tolerance band. Use it wherever a measurement is shown
 * (score, grading progress, live progress, time remaining, fairness tolerance) instead of donuts and bars.
 */

type Size = 'sm' | 'md' | 'lg';

export interface MarksRuleProps {
  /** Current value, between min and max. */
  value: number;
  min?: number;
  /** Default 100. */
  max?: number;
  /** Accessible name, e.g. "Score" or "Papers graded". Required: a meter needs a name. */
  label: string;
  /** Spoken value. Defaults to "62 of 100". */
  valueText?: string;
  orientation?: 'horizontal' | 'vertical';
  /** sm fits a table cell (21 ticks), md a panel, lg a result headline. Default md. */
  size?: Size;
  /** needle: a carmine hairline with a cap. fill: a carmine bar along the edge. both: the two together. */
  marker?: 'needle' | 'fill' | 'both';
  /** Needle and fill colour. accent is carmine; neutral is ink, for a value that is not the subject. */
  tone?: 'accent' | 'neutral' | 'gold';
  /** Pass mark (same units as value): a gold tick that stands above the others. */
  pass?: number;
  /** Text beside the pass tick, e.g. "Pass 50%". Horizontal only. */
  passLabel?: ReactNode;
  /** Tolerance band [from, to] (same units as value), shaded gold. */
  band?: readonly [number, number];
  /** Scale numbers: none, the two ends, or every major tick. Default none. */
  labels?: 'none' | 'ends' | 'major';
  /** Formats scale numbers. Default rounds to an integer. */
  format?: (value: number) => string;
  /** Tick spacing in value units. Default range / 10 (major) and range / 50 (minor; range / 20 at sm). */
  ticks?: { major: number; minor: number };
  /** The result reveal: the needle travels from min and settles with a slight spring, once, on mount. */
  settle?: boolean;
  /** Vertical length in px (vertical only). Default 160. */
  length?: number;
  className?: string;
  /** Merged onto the root (e.g. a mask). */
  style?: CSSProperties;
}

const GEOMETRY: Record<Size, { major: number; minor: number; mid: number; needle: number; fill: number; label: string }> = {
  sm: { major: 7, minor: 3, mid: 5, needle: 13, fill: 2, label: 'text-[0.625rem] leading-3' },
  md: { major: 12, minor: 5, mid: 8, needle: 22, fill: 2, label: 'text-caption' },
  lg: { major: 18, minor: 7, mid: 12, needle: 34, fill: 3, label: 'text-footnote' },
};

const TONE = {
  accent: 'bg-accent',
  neutral: 'bg-label',
  gold: 'bg-gold',
} as const;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const defaultFormat = (v: number) => String(Math.round(v));

function tickList(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  if (!(step > 0) || !(max > min)) return out;
  const n = Math.round((max - min) / step);
  if (n > 400) return out;
  for (let i = 0; i <= n; i++) out.push(min + i * step);
  return out;
}

export function MarksRule({
  value,
  min = 0,
  max = 100,
  label,
  valueText,
  orientation = 'horizontal',
  size = 'md',
  marker = 'needle',
  tone = 'accent',
  pass,
  passLabel,
  band,
  labels = 'none',
  format = defaultFormat,
  ticks,
  settle = false,
  length = 160,
  className,
  style: styleProp,
}: MarksRuleProps) {
  const range = max - min || 1;
  const frac = (v: number) => clamp01((v - min) / range);
  const f = frac(value);
  const g = GEOMETRY[size];
  const majorStep = ticks?.major ?? range / 10;
  const minorStep = ticks?.minor ?? (size === 'sm' ? range / 20 : range / 50);
  const majors = tickList(min, max, majorStep);
  const minors = tickList(min, max, minorStep);
  const isMajor = (v: number) => majors.some((m) => Math.abs(m - v) < minorStep / 4);
  const isMid = (v: number) => !isMajor(v) && Math.abs(((v - min) / majorStep) % 1 - 0.5) < 0.01;
  const showNeedle = marker !== 'fill';
  const showFill = marker !== 'needle';
  const vertical = orientation === 'vertical';
  const pct = (v: number) => `${(frac(v) * 100).toFixed(3)}%`;
  const fromTop = (v: number) => `${((1 - frac(v)) * 100).toFixed(3)}%`;
  const scale = labels === 'major' ? majors : labels === 'ends' ? [min, max] : [];
  const style = { ...styleProp, '--mr-f': f } as CSSProperties;

  const meter = {
    role: 'meter' as const,
    'aria-label': label,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    'aria-valuetext': valueText ?? `${format(value)} of ${format(max)}`,
  };

  if (vertical) {
    // Edge on the left, ticks reaching right, numbers beyond them; value runs bottom to top.
    const w = g.needle;
    return (
      <div {...meter} data-settle={settle || undefined} className={cn('relative inline-flex shrink-0', className)} style={{ ...style, height: length }}>
        <div className="relative h-full" style={{ width: w }}>
          <svg aria-hidden className="absolute inset-0 h-full w-full overflow-visible" width="100%" height="100%">
            {band && <rect x={0} width={g.major} y={fromTop(band[1])} height={`${((frac(band[1]) - frac(band[0])) * 100).toFixed(3)}%`} className="fill-gold-tint" />}
            <line x1={0.5} x2={0.5} y1="0" y2="100%" className="stroke-separator-strong" strokeWidth={1} shapeRendering="crispEdges" />
            {minors.map((v) => {
              const len = isMajor(v) ? g.major : isMid(v) ? g.mid : g.minor;
              return (
                <line
                  key={v}
                  x1={0}
                  x2={len}
                  y1={fromTop(v)}
                  y2={fromTop(v)}
                  className={isMajor(v) ? 'stroke-label-tertiary' : 'stroke-label-quaternary'}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              );
            })}
            {pass !== undefined && <line x1={-3} x2={g.major + 6} y1={fromTop(pass)} y2={fromTop(pass)} className="stroke-gold" strokeWidth={1.5} />}
          </svg>
          {showFill && (
            <span
              aria-hidden
              className={cn('marks-fill-y absolute bottom-0 left-0 h-full rounded-full', TONE[tone])}
              style={{ width: g.fill }}
            />
          )}
          {showNeedle && (
            <span
              aria-hidden
              className={cn('marks-needle-y absolute left-0 h-[2px] translate-y-1/2 rounded-full', TONE[tone])}
              style={{ width: w }}
            />
          )}
        </div>
        {scale.length > 0 && (
          <div aria-hidden className={cn('relative h-full pl-1.5 tabular-nums text-label-tertiary', g.label)}>
            {scale.map((v) => (
              <span key={v} className="absolute left-1.5 translate-y-1/2 whitespace-nowrap" style={{ bottom: pct(v) }}>
                {format(v)}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const top = passLabel !== undefined && pass !== undefined ? 16 : 0;
  return (
    <div
      {...meter}
      data-settle={settle || undefined}
      className={cn('relative w-full', size === 'sm' ? 'min-w-20' : 'min-w-36', className)}
      style={{ ...style, paddingTop: top }}
    >
      {top > 0 && pass !== undefined && (
        <span
          aria-hidden
          className={cn(
            'absolute top-0 whitespace-nowrap text-caption font-medium text-gold-text tabular-nums',
            frac(pass) > 0.85 ? '-translate-x-full' : frac(pass) < 0.15 ? 'translate-x-0' : '-translate-x-1/2',
          )}
          style={{ left: pct(pass) }}
        >
          {passLabel}
        </span>
      )}
      <div className="relative" style={{ height: g.needle }}>
        <svg aria-hidden className="absolute inset-0 h-full w-full overflow-visible" width="100%" height="100%">
          {band && <rect x={pct(band[0])} width={`${((frac(band[1]) - frac(band[0])) * 100).toFixed(3)}%`} y={g.needle - g.major} height={g.major} className="fill-gold-tint" />}
          <line x1="0" x2="100%" y1={g.needle - 0.5} y2={g.needle - 0.5} className="stroke-separator-strong" strokeWidth={1} shapeRendering="crispEdges" />
          {minors.map((v) => {
            const len = isMajor(v) ? g.major : isMid(v) ? g.mid : g.minor;
            return (
              <line
                key={v}
                x1={pct(v)}
                x2={pct(v)}
                y1={g.needle - len}
                y2={g.needle}
                className={isMajor(v) ? 'stroke-label-tertiary' : 'stroke-label-quaternary'}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            );
          })}
          {pass !== undefined && (
            <line x1={pct(pass)} x2={pct(pass)} y1={top > 0 ? -2 : 0} y2={g.needle} className="stroke-gold" strokeWidth={1.5} />
          )}
        </svg>
        {showFill && (
          <span
            aria-hidden
            className={cn('marks-fill-x absolute bottom-0 left-0 w-full rounded-full', TONE[tone])}
            style={{ height: g.fill }}
          />
        )}
        {showNeedle && (
          <span
            aria-hidden
            className={cn(
              'marks-needle-x absolute top-0 w-[2px] -translate-x-1/2 rounded-full',
              // The cap: a small carmine point at the head of the needle.
              'before:absolute before:-top-[3px] before:left-1/2 before:size-[8px] before:-translate-x-1/2 before:bg-inherit before:[clip-path:polygon(0_0,100%_0,50%_100%)]',
              TONE[tone],
            )}
            style={{ height: g.needle }}
          />
        )}
      </div>
      {scale.length > 0 && (
        <div aria-hidden className={cn('relative mt-1 h-3.5 tabular-nums text-label-tertiary', g.label)}>
          {scale.map((v, i) => (
            <span
              key={v}
              className={cn(
                'absolute top-0 whitespace-nowrap',
                i === 0 ? 'translate-x-0' : i === scale.length - 1 ? '-translate-x-full' : '-translate-x-1/2',
              )}
              style={{ left: pct(v) }}
            >
              {format(v)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ScoreRuleProps {
  score: number;
  max: number;
  /** Pass mark in the same units as score (marks). Drawn as the gold tick. */
  pass?: number;
  size?: Size;
  /** Animate the needle in once (the result reveal). Respects reduced motion. */
  settle?: boolean;
  /** Show the percentage as a light numeral with "19 of 23 marks" beside it. */
  readout?: boolean;
  /** Accessible name. Default "Score". */
  label?: string;
  className?: string;
}

const pctFormat = (n: number) => `${Math.round(n * 10) / 10}`;

/** A score on the Marks rule, scaled to percent: needle at the score, gold tick at the pass mark. */
export function ScoreRule({ score, max, pass, size = 'md', settle = false, readout = false, label = 'Score', className }: ScoreRuleProps) {
  const safeMax = max > 0 ? max : 1;
  const percent = (score / safeMax) * 100;
  const passPercent = pass !== undefined ? (pass / safeMax) * 100 : undefined;
  return (
    <div className={cn('flex w-full flex-col gap-3', className)}>
      {readout && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={cn('numeral text-label', size === 'lg' ? 'text-[3.5rem] leading-none' : 'text-[2.25rem] leading-none')}>
            {pctFormat(percent)}
            <span className="ml-0.5 text-[0.5em] text-label-secondary">%</span>
          </span>
          <span className="text-callout text-label-secondary tabular-nums">
            {score} of {max} marks
          </span>
        </div>
      )}
      <MarksRule
        value={Math.max(0, Math.min(100, percent))}
        max={100}
        label={label}
        valueText={`${pctFormat(percent)}%, ${score} of ${max} marks${passPercent !== undefined ? `, pass mark ${pctFormat(passPercent)}%` : ''}`}
        size={size}
        pass={passPercent}
        passLabel={passPercent !== undefined && size !== 'sm' ? `Pass ${pctFormat(passPercent)}%` : undefined}
        labels={size === 'sm' ? 'none' : 'major'}
        settle={settle}
      />
    </div>
  );
}
