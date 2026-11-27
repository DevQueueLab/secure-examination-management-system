import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons aligned with the title. */
  actions?: ReactNode;
  /** Heading level. Default h2 (pages own the h1). */
  as?: 'h2' | 'h3';
}

/** A titled region of a page. Sections separate with space, not boxes. */
export function Section({ title, description, actions, as: Heading = 'h2', className, children, ...props }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-3', className)} {...props}>
      {(title || actions) && (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && <Heading className="text-title-3 text-label">{title}</Heading>}
            {description && <p className="mt-0.5 max-w-prose text-subheadline text-label-secondary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
