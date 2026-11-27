import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium',
    'transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out',
    'active:scale-[0.97] active:duration-75',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-offset-2 focus-visible:outline-focus',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        /** The one primary action in a view. */
        filled:
          'bg-accent text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(16_20_28/0.18)] hover:bg-accent-hover active:bg-accent-pressed active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.18)]',
        /** Secondary actions that still carry the accent. */
        tinted: 'bg-accent-tint text-accent-text hover:bg-accent/15',
        /** Neutral push button. */
        gray: 'bg-fill text-label hover:bg-fill-strong active:bg-fill-strong',
        /** Borderless, for toolbars and inline actions. */
        plain: 'text-accent-text hover:bg-fill-secondary',
        /** Toolbars and icon buttons in label colour. */
        ghost: 'text-label-secondary hover:bg-fill-secondary hover:text-label',
        destructive: 'bg-danger-fill text-white shadow-xs hover:brightness-110 active:brightness-95',
        'destructive-tinted': 'bg-danger-tint text-danger-text hover:bg-danger/15',
      },
      size: {
        sm: 'h-7 rounded-md px-2.5 text-subheadline [&_svg]:size-3.5',
        md: 'h-9 rounded-lg px-3.5 text-callout [&_svg]:size-4',
        lg: 'h-11 rounded-xl px-5 text-body font-semibold [&_svg]:size-[18px]',
        'icon-sm': 'size-7 rounded-md [&_svg]:size-3.5',
        icon: 'size-9 rounded-lg [&_svg]:size-4',
        'icon-lg': 'size-11 rounded-xl [&_svg]:size-5',
      },
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'gray', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (a Link, an <a>) with button styling. Loading is ignored then. */
  asChild?: boolean;
  /** Keeps the width, shows a spinner, blocks clicks and sets aria-busy. */
  loading?: boolean;
}

/**
 * Variants: filled (primary), tinted, gray (default), plain, ghost, destructive, destructive-tinted.
 * Icon-only buttons need an aria-label.
 */
export function Button({ className, variant, size, block, asChild = false, loading = false, disabled, children, type, ...props }: ButtonProps) {
  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={cn(buttonVariants({ variant, size, block }), className)} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      data-slot="button"
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-1.5">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner size={size === 'lg' || size === 'icon-lg' ? 18 : 15} label={null} />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
