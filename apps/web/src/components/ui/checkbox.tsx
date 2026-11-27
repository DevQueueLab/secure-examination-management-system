'use client';

import { Check, Minus } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';

export interface CheckboxProps extends ComponentProps<typeof CheckboxPrimitive.Root> {
  /** Inline label. Clicking it toggles the box. */
  label?: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ className, label, description, id, ...props }: CheckboxProps) {
  const auto = useId();
  const field = useFieldControl({ id, 'aria-describedby': props['aria-describedby'] });
  const controlId = field.id ?? `cb-${auto}`;
  const descId = description ? `${controlId}-desc` : undefined;
  const box = (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-separator-strong bg-surface',
        'transition-[background-color,border-color,transform] duration-150 ease-out active:scale-90',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-on-accent',
        'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-on-accent',
        'aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
      id={controlId}
      aria-describedby={[field['aria-describedby'], descId].filter(Boolean).join(' ') || undefined}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center data-[state=checked]:animate-in data-[state=checked]:zoom-in-50 duration-150">
        {props.checked === 'indeterminate' ? (
          <Minus aria-hidden className="size-3" strokeWidth={3} />
        ) : (
          <Check aria-hidden className="size-3" strokeWidth={3.25} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-5 items-center">{box}</span>
      <div className="flex flex-col">
        <label htmlFor={controlId} className="text-body text-label select-none peer-disabled:opacity-50">
          {label}
        </label>
        {description && (
          <p id={descId} className="text-subheadline text-label-secondary">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
