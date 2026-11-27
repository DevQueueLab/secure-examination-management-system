'use client';

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A single-choice list of whole-row options. Arrow keys move between rows. */
export function ChoiceList<T extends string>({
  value,
  onValueChange,
  label,
  className,
  children,
}: {
  value: T | null;
  onValueChange: (value: T) => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadioGroupPrimitive.Root value={value ?? ''} onValueChange={(v) => onValueChange(v as T)} aria-label={label} className={cn('flex flex-col gap-2', className)}>
      {children}
    </RadioGroupPrimitive.Root>
  );
}

export function ChoiceRow({
  value,
  title,
  description,
  aside,
  disabled,
  className,
}: {
  value: string;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      disabled={disabled}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl bg-surface px-4 py-3 text-left ring-1 ring-separator',
        'outline-none transition-[background-color,box-shadow] duration-150 hover:bg-fill-secondary',
        'data-[state=checked]:bg-accent-tint/50 data-[state=checked]:ring-2 data-[state=checked]:ring-accent',
        'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface',
        className,
      )}
    >
      <span
        aria-hidden
        className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border border-separator-strong bg-surface transition-colors group-data-[state=checked]:border-accent group-data-[state=checked]:bg-accent"
      >
        <span className="size-[7px] scale-0 rounded-full bg-white transition-transform duration-150 group-data-[state=checked]:scale-100" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-callout font-semibold text-label">{title}</span>
        {description && <span className="mt-0.5 block text-subheadline text-label-secondary">{description}</span>}
      </span>
      {aside && <span className="shrink-0 self-center">{aside}</span>}
    </RadioGroupPrimitive.Item>
  );
}
