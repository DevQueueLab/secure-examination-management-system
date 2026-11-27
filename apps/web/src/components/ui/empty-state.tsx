import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  /** An icon element, e.g. <Inbox />. Rendered large and quiet. */
  icon?: ReactNode;
  title: ReactNode;
  /** Say what will appear here and how to make it appear. */
  description?: ReactNode;
  /** Primary and secondary actions (Buttons or Links styled as buttons). */
  action?: ReactNode;
  /** Compact for use inside a card or a table body. */
  size?: 'sm' | 'md';
  /** Draws its own surface. Default true; pass false inside an existing surface. */
  surface?: boolean;
  className?: string;
}

/** What a region shows when it has nothing yet. Teaches the next step instead of saying "nothing here". */
export function EmptyState({ icon, title, description, action, size = 'md', surface = true, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        surface && 'rounded-xl bg-surface',
        size === 'md' ? 'gap-3 px-6 py-14 sm:py-16' : 'gap-2 px-4 py-8',
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden
          className={cn(
            'flex items-center justify-center rounded-full bg-fill-secondary text-label-tertiary',
            size === 'md' ? 'mb-1 size-14 [&_svg]:size-7' : 'size-10 [&_svg]:size-5',
          )}
        >
          {icon}
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className={cn('text-label', size === 'md' ? 'text-title-3' : 'text-headline')}>{title}</h3>
        {description && <p className="text-callout text-label-secondary">{description}</p>}
      </div>
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
