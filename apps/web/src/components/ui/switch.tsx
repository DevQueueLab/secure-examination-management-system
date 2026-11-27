'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';

export interface SwitchProps extends ComponentProps<typeof SwitchPrimitive.Root> {
  size?: 'sm' | 'md';
  /** Inline label on the left, settings-row style. */
  label?: ReactNode;
  description?: ReactNode;
}

/** On/off that applies immediately. For choices saved with a form, prefer a Checkbox. */
export function Switch({ className, size = 'md', label, description, id, ...props }: SwitchProps) {
  const auto = useId();
  const field = useFieldControl({ id, 'aria-describedby': props['aria-describedby'] });
  const controlId = field.id ?? `sw-${auto}`;
  const descId = description ? `${controlId}-desc` : undefined;
  const control = (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ease-out',
        'bg-fill-strong data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-[26px] w-[44px]' : 'h-5 w-[34px]',
        className,
      )}
      {...props}
      id={controlId}
      aria-describedby={[field['aria-describedby'], descId].filter(Boolean).join(' ') || undefined}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-sm ring-0 transition-[transform,width] duration-200 ease-out-quart',
          size === 'md'
            ? 'h-[22px] w-[22px] data-[state=checked]:translate-x-[18px] group-active:w-[26px] group-active:data-[state=checked]:translate-x-[14px]'
            : 'h-4 w-4 data-[state=checked]:translate-x-[14px] group-active:w-[19px] group-active:data-[state=checked]:translate-x-[11px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={controlId} className="text-body text-label select-none">
          {label}
        </label>
        {description && (
          <p id={descId} className="text-subheadline text-label-secondary">
            {description}
          </p>
        )}
      </div>
      {control}
    </div>
  );
}
