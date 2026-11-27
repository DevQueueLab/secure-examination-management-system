import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Placeholder with the shape of the content that is loading. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      data-slot="skeleton"
      className={cn(
        'rounded-md bg-fill',
        'motion-safe:bg-[linear-gradient(90deg,transparent_0%,var(--fill)_40%,var(--fill-strong)_50%,var(--fill)_60%,transparent_100%)] motion-safe:bg-[length:200%_100%] motion-safe:animate-shimmer',
        className,
      )}
      {...props}
    />
  );
}

/** A few lines of text, the last one shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

/** Rows for a list or table that is loading. Announces once. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('flex flex-col divide-y divide-separator overflow-hidden rounded-xl bg-surface', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
