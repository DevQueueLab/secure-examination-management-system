import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Tone } from './badge';

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small leading icon element. */
  icon?: ReactNode;
  /** Context under the value: "of 120 enrolled", "since Monday". */
  hint?: ReactNode;
  /** Change indicator. Positive is not always good: set `deltaTone` to say which. */
  delta?: { value: string; direction: 'up' | 'down'; tone?: Tone };
  /** Makes the whole tile a link. */
  href?: string;
  className?: string;
}

const deltaColor: Record<Tone, string> = {
  neutral: 'text-label-secondary',
  accent: 'text-accent-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  info: 'text-info-text',
};

/** One number with its label and context. Group three or four in a row; never as decoration. */
export function StatTile({ label, value, icon, hint, delta, href, className }: StatTileProps) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-subheadline font-medium text-label-secondary">
        {icon && <span className="flex text-label-tertiary [&_svg]:size-4" aria-hidden>{icon}</span>}
        <span className="truncate">{label}</span>
        {href && <ChevronRight aria-hidden className="ml-auto size-4 text-label-tertiary transition-transform group-hover:translate-x-0.5" />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-title-1 tabular-nums text-label">{value}</span>
        {delta && (
          <span className={cn('inline-flex items-center gap-0.5 text-footnote font-medium', deltaColor[delta.tone ?? 'neutral'])}>
            {delta.direction === 'up' ? <ArrowUpRight aria-hidden className="size-3.5" /> : <ArrowDownRight aria-hidden className="size-3.5" />}
            {delta.value}
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-footnote text-label-secondary">{hint}</div>}
    </>
  );
  const base = cn('group flex min-w-0 flex-col rounded-xl bg-surface p-4', className);
  if (href) {
    return (
      <Link href={href} className={cn(base, 'transition-colors hover:bg-fill-secondary')}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}
