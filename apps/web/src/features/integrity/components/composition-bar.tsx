import { cn } from '@/lib/cn';
import styles from '../integrity.module.css';
import { pct } from '../format';
import type { FinalComposition } from '../types';

const PARTS = [
  { key: 'typed', label: 'Typed', color: 'var(--typed)' },
  { key: 'pasted', label: 'Pasted', color: 'var(--paste)' },
  { key: 'burst', label: 'Burst', color: 'var(--burst)' },
] as const;

/**
 * Where the final text came from, as one 100% bar. Typed stays neutral so pasted and burst text stand out;
 * every part is also named in words, so colour is never the only signal.
 */
export function CompositionBar({
  composition,
  size = 'md',
  labels = true,
  className,
}: {
  composition: FinalComposition | null;
  size?: 'sm' | 'md';
  labels?: boolean;
  className?: string;
}) {
  if (!composition || composition.total === 0) {
    return labels ? <p className={cn('text-footnote text-label-tertiary', className)}>No final text to break down</p> : null;
  }
  const parts = PARTS.map((p) => ({ ...p, value: composition[p.key] })).filter((p) => p.value > 0);
  const description = parts.map((p) => `${p.label} ${pct(p.value / composition.total)}`).join(', ');
  return (
    <div className={cn(styles.tokens, 'flex min-w-0 flex-col gap-1.5', className)}>
      <div role="img" aria-label={`Final text: ${description}`} className={cn('flex w-full gap-[2px]', size === 'sm' ? 'h-1.5' : 'h-2')}>
        {parts.map((p) => (
          <span
            key={p.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(p.value / composition.total) * 100}%`, minWidth: 3, background: p.color }}
          />
        ))}
      </div>
      {labels && (
        <div aria-hidden className="flex flex-wrap gap-x-3 gap-y-0.5 text-footnote text-label-secondary">
          {parts.map((p) => (
            <span key={p.key} className="inline-flex items-center gap-1.5 tabular-nums">
              <span className="size-2 rounded-full" style={{ background: p.color }} />
              {p.label} {pct(p.value / composition.total)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
