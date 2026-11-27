import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Tone } from './badge';

const fills: Record<Tone, string> = {
  neutral: 'bg-label-tertiary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

const strokes: Record<Tone, string> = {
  neutral: 'stroke-label-tertiary',
  accent: 'stroke-accent',
  success: 'stroke-success',
  warning: 'stroke-warning',
  danger: 'stroke-danger',
  info: 'stroke-info',
};

export interface ProgressBarProps {
  /** 0..max. Omit for an indeterminate bar. */
  value?: number;
  max?: number;
  tone?: Tone;
  size?: 'sm' | 'md';
  /** Accessible name, e.g. "Upload progress". */
  label: string;
  /** Visible value text such as "12 of 40". Defaults to a percentage for assistive tech. */
  valueText?: string;
  className?: string;
}

export function ProgressBar({ value, max = 100, tone = 'accent', size = 'md', label, valueText, className }: ProgressBarProps) {
  const indeterminate = value === undefined;
  const pct = indeterminate ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuetext={indeterminate ? undefined : (valueText ?? `${Math.round(pct)}%`)}
      className={cn('relative w-full overflow-hidden rounded-full bg-fill', size === 'sm' ? 'h-1' : 'h-1.5', className)}
    >
      {indeterminate ? (
        <div className={cn('absolute inset-y-0 left-0 w-full origin-left rounded-full animate-indeterminate', fills[tone])} />
      ) : (
        <div
          className={cn('h-full origin-left rounded-full transition-transform duration-500 ease-out-expo', fills[tone])}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      )}
    </div>
  );
}

export interface ProgressRingProps {
  value: number;
  max?: number;
  /** Pixel diameter. Default 44. */
  size?: number;
  /** Stroke width in px. Default size / 11. */
  thickness?: number;
  tone?: Tone;
  label: string;
  /** Centre content, e.g. "72%". Hidden when the ring is under 36px. */
  children?: ReactNode;
  className?: string;
}

/** Circular progress for compact summaries (completion, time used). */
export function ProgressRing({ value, max = 100, size = 44, thickness, tone = 'accent', label, children, className }: ProgressRingProps) {
  const pct = Math.max(0, Math.min(1, value / max));
  const stroke = thickness ?? Math.max(3, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-fill" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cn('transition-[stroke-dashoffset] duration-700 ease-out-expo', strokes[tone])}
        />
      </svg>
      {children && size >= 36 && (
        <span className="absolute inset-0 flex items-center justify-center text-footnote font-semibold tabular-nums text-label">{children}</span>
      )}
    </div>
  );
}
