import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A surface on the grouped background. Elevation comes from the surface colour, not a border.
 * Never put a Card inside a Card: use a Section, a GroupedList or a divider instead.
 */
export function Card({ className, padding = 'md', ...props }: ComponentProps<'div'> & { padding?: 'none' | 'sm' | 'md' | 'lg' }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-xl bg-surface text-label',
        padding === 'sm' && 'p-4',
        padding === 'md' && 'p-5',
        padding === 'lg' && 'p-6 sm:p-7',
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or a menu on the right. */
  action?: ReactNode;
  /** Heading level for the title. Default h3. */
  as?: 'h2' | 'h3' | 'h4';
}

export function CardHeader({ title, description, action, as: Heading = 'h3', className, ...props }: CardHeaderProps) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)} {...props}>
      <div className="min-w-0">
        <Heading className="text-headline text-label">{title}</Heading>
        {description && <p className="mt-0.5 text-subheadline text-label-secondary">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-5 flex items-center justify-end gap-2 border-t pt-4', className)} {...props} />;
}
