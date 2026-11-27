import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Metric {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}

/**
 * Key figures as light numerals on the page ground, ruled by hairlines rather than boxed in cards.
 * Two columns on phones, one row from `xl`.
 */
export function MetricStrip({ metrics, className }: { metrics: Metric[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-px border-y border-separator bg-separator xl:grid-cols-4',
        className,
      )}
    >
      {metrics.map((m) => (
        <div
          key={m.label}
          className="flex min-w-0 flex-col bg-bg py-5 pl-5 max-xl:odd:pl-0 xl:first:pl-0"
        >
          <dt className="text-footnote text-label-secondary">{m.label}</dt>
          <dd className="numeral mt-3 text-[2.5rem]/none text-label sm:text-[3rem]/none">
            {m.value}
          </dd>
          {m.detail && (
            <dd className="mt-2.5 text-pretty pr-3 text-caption text-label-tertiary">{m.detail}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
