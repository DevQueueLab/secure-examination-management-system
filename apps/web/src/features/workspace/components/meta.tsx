import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Metadata parts set apart by space, never by separator glyphs. Screen readers hear a comma
 * between parts so the run doesn't blur into one phrase.
 */
export function Meta({ items, className }: { items: ReactNode[]; className?: string }) {
  const parts = items.filter((part) => part !== null && part !== undefined && part !== false && part !== '');
  return (
    <span className={cn('flex flex-wrap items-baseline gap-x-4 gap-y-0.5', className)}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <span className="sr-only">, </span>}
        </span>
      ))}
    </span>
  );
}
