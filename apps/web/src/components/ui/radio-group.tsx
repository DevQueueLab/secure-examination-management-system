'use client';

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn('flex flex-col gap-3', className)} {...props} />;
}

export interface RadioProps extends ComponentProps<typeof RadioGroupPrimitive.Item> {
  label?: ReactNode;
  description?: ReactNode;
}

export function Radio({ className, label, description, id, ...props }: RadioProps) {
  const auto = useId();
  const controlId = id ?? `radio-${auto}`;
  const descId = description ? `${controlId}-desc` : undefined;
  const dot = (
    <RadioGroupPrimitive.Item
      id={controlId}
      aria-describedby={descId}
      className={cn(
        'peer inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-separator-strong bg-surface',
        'transition-[background-color,border-color,transform] duration-150 active:scale-90',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="block size-[7px] rounded-full bg-white data-[state=checked]:animate-in data-[state=checked]:zoom-in-50 duration-150" />
    </RadioGroupPrimitive.Item>
  );
  if (!label) return dot;
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-5 items-center">{dot}</span>
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
