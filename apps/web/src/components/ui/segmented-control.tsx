'use client';

import { motion } from 'motion/react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useSpring } from '@/lib/motion';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Optional leading icon element. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Accessible name when the label is an icon only. */
  'aria-label'?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name for the group. */
  'aria-label': string;
  size?: 'sm' | 'md';
  /** Stretch segments to fill the width. */
  block?: boolean;
  className?: string;
}

/**
 * Pick one of 2-5 mutually exclusive views or values. Arrow keys move the selection.
 * The thumb slides on a critically damped spring; with reduced motion it cross-fades.
 */
export function SegmentedControl<T extends string = string>({ options, value, onValueChange, size = 'md', block, className, ...aria }: SegmentedControlProps<T>) {
  const layoutId = useId();
  const transition = useSpring('snappy');
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      aria-label={aria['aria-label']}
      orientation="horizontal"
      loop
      className={cn(
        // Track radius 9px, inset 2px: thumbs use 7px so the corners stay concentric.
        'relative inline-flex select-none items-stretch rounded-[9px] bg-fill p-0.5',
        size === 'sm' ? 'h-7 text-subheadline' : 'h-8 text-callout',
        block ? 'flex w-full' : 'w-fit',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            aria-label={option['aria-label']}
            className={cn(
              'relative flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] px-3 font-medium outline-none',
              'text-label-secondary transition-colors duration-150 hover:text-label data-[state=checked]:text-label',
              'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-offset-0 focus-visible:outline-focus',
              'disabled:opacity-40 [&_svg]:size-4',
              block && 'flex-1',
            )}
          >
            {selected && (
              <motion.span
                layoutId={`segment-${layoutId}`}
                transition={transition}
                className="absolute inset-0 rounded-[7px] bg-thumb shadow-sm"
                aria-hidden
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5 truncate">
              {option.icon}
              {option.label}
            </span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
