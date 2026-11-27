import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Item = ReactNode | null | false | undefined;

/**
 * A run of metadata (code, date, role) as separate items held apart by a gap, so nothing is glued together
 * with separator characters. Renders inline, so it can sit inside a paragraph.
 */
export function Meta({ items, className }: { items: Item[]; className?: string }) {
  const shown = items.filter((i): i is Exclude<ReactNode, null | undefined | boolean> => i !== null && i !== undefined && i !== false && i !== '');
  if (!shown.length) return null;
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-3 gap-y-0.5', className)}>
      {shown.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </span>
  );
}
