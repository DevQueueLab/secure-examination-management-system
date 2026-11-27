import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Metric {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}

/**
 * Key figures on one surface, divided by hairlines instead of split into separate cards.
 * Two columns on phones, one row from `xl`.
 */
export function MetricStrip({ metrics, className }: { metrics: Metric[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-separator xl:grid-cols-4',
        className,
      )}
    >
      {metrics.map((m) => (
        <div key={m.label} className="flex min-w-0 flex-col bg-surface px-4 py-3.5">
          <dt className="text-footnote text-label-secondary">{m.label}</dt>
          <dd className="mt-1 text-title-1 tabular-nums text-label">{m.value}</dd>
          {m.detail && (
            <dd className="mt-0.5 text-pretty text-caption text-label-tertiary">{m.detail}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
