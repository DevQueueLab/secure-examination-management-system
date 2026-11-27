'use client';

import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldControl } from '@/components/ui/field';
import { cn } from '@/lib/cn';

/**
 * Number entry with − / + buttons. Typing is free; the value commits on blur or Enter and is clamped,
 * so a half-typed "1." never reaches the API. Buttons commit immediately.
 */
export function NumberStepper({
  value,
  onCommit,
  min = 0,
  max = 1000,
  step = 1,
  decimals = 0,
  disabled,
  size = 'md',
  suffix,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  value: number | null;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  disabled?: boolean;
  size?: 'sm' | 'md';
  suffix?: string;
  className?: string;
  id?: string;
  'aria-label'?: string;
}) {
  const field = useFieldControl({ id, disabled });
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);

  const clamp = (n: number) => {
    const f = 10 ** decimals;
    return Math.min(max, Math.max(min, Math.round(n * f) / f));
  };
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) {
      setDraft(value === null ? '' : String(value));
      return;
    }
    const next = clamp(n);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  const bump = (dir: 1 | -1) => {
    const next = clamp((value ?? min) + dir * step);
    if (next !== value) onCommit(next);
  };
  const isDisabled = field.disabled ?? disabled;
  const h = size === 'sm' ? 'h-8' : 'h-9';
  const btn = cn(
    'inline-flex shrink-0 items-center justify-center text-label-secondary transition-colors hover:bg-fill-secondary hover:text-label active:bg-fill disabled:pointer-events-none disabled:opacity-40',
    size === 'sm' ? 'w-7' : 'w-8',
  );

  return (
    <div
      className={cn(
        'inline-flex w-fit items-stretch self-start overflow-hidden rounded-lg bg-fill-secondary ring-1 ring-inset ring-transparent focus-within:ring-accent',
        h,
        isDisabled && 'opacity-60',
        className,
      )}
    >
      <button type="button" className={btn} aria-label="Decrease" disabled={isDisabled || (value ?? min) <= min} onClick={() => bump(-1)}>
        <Minus aria-hidden className="size-3.5" />
      </button>
      <span className="flex min-w-0 items-center">
        <input
          {...field}
          aria-label={ariaLabel}
          inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          value={draft}
          disabled={isDisabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit((e.target as HTMLInputElement).value);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              bump(1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              bump(-1);
            }
          }}
          className={cn('w-12 min-w-0 bg-transparent text-center tabular-nums text-label outline-none', size === 'sm' ? 'text-callout' : 'text-body')}
        />
        {suffix && <span className="pr-1 text-footnote text-label-tertiary">{suffix}</span>}
      </span>
      <button type="button" className={btn} aria-label="Increase" disabled={isDisabled || (value ?? min) >= max} onClick={() => bump(1)}>
        <Plus aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
