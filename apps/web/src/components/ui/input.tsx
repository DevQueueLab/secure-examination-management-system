'use client';

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';

/** Shared look for text-like controls (inputs, textareas, select triggers). */
export const controlBase = [
  'w-full min-w-0 rounded-lg border border-separator-strong bg-surface text-body text-label',
  'transition-[border-color,box-shadow,background-color] duration-150 ease-out',
  'hover:border-label-quaternary',
  'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/25',
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/25',
  'disabled:cursor-not-allowed disabled:bg-fill-secondary disabled:opacity-60',
].join(' ');

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  /** md = 36px (default), lg = 44px for sign-in and touch-first forms. */
  size?: 'sm' | 'md' | 'lg';
  /** Icon or text inside the left edge. Decorative unless you label it. */
  leading?: ReactNode;
  /** Button or text inside the right edge (reveal password, clear, unit). */
  trailing?: ReactNode;
  containerClassName?: string;
}

const heights = { sm: 'h-8 text-callout', md: 'h-9', lg: 'h-11' } as const;

export function Input({ className, containerClassName, size = 'md', leading, trailing, id, required, disabled, ...props }: InputProps) {
  const field = useFieldControl({
    id,
    required,
    disabled,
    'aria-describedby': props['aria-describedby'],
    'aria-invalid': props['aria-invalid'] as boolean | undefined,
  });
  const input = (
    <input
      data-slot="input"
      className={cn(
        controlBase,
        heights[size],
        'px-3 placeholder:text-placeholder read-only:bg-fill-secondary',
        'file:mr-3 file:border-0 file:bg-transparent file:text-callout file:font-medium file:text-accent-text',
        leading && 'pl-9',
        trailing && 'pr-10',
        className,
      )}
      {...props}
      {...field}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className={cn('relative flex items-center', containerClassName)}>
      {leading && (
        <span className="pointer-events-none absolute left-3 flex items-center text-label-tertiary [&_svg]:size-4">{leading}</span>
      )}
      {input}
      {trailing && <span className="absolute right-1 flex items-center">{trailing}</span>}
    </div>
  );
}

export interface TextareaProps extends ComponentProps<'textarea'> {
  /** Grow with content up to max-h. Uses CSS field-sizing where supported. */
  autoGrow?: boolean;
}

export function Textarea({ className, autoGrow = true, id, required, disabled, ...props }: TextareaProps) {
  const field = useFieldControl({
    id,
    required,
    disabled,
    'aria-describedby': props['aria-describedby'],
    'aria-invalid': props['aria-invalid'] as boolean | undefined,
  });
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        controlBase,
        'min-h-24 px-3 py-2 leading-relaxed placeholder:text-placeholder read-only:bg-fill-secondary',
        autoGrow && '[field-sizing:content] max-h-[28rem]',
        className,
      )}
      {...props}
      {...field}
    />
  );
}
