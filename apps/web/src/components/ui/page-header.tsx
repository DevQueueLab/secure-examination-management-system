import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ViewTransition } from 'react';
import { cn } from '@/lib/cn';
import { ShellTitle } from '@/components/shell/shell-title';

export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  /** Shared-element name: a list item wrapped in the same name morphs into this title on navigation. */
  titleTransitionName?: string;
  /** One line that says what this page is for. */
  subtitle?: ReactNode;
  /** Primary action last (rightmost). At most one filled button. */
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Badges or metadata next to the title (status, type). */
  meta?: ReactNode;
  className?: string;
}

/**
 * The page's h1. Its title also feeds the compact title in the shell's top bar, which fades in
 * once the large title scrolls away (like a large-title navigation bar).
 */
export function PageHeader({ title, titleTransitionName, subtitle, actions, breadcrumbs, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 pb-6 pt-2 sm:pt-4', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {titleTransitionName ? (
              <ViewTransition name={titleTransitionName} share="morph" default="none">
                <h1 className="text-title-1 text-label sm:text-large-title">{title}</h1>
              </ViewTransition>
            ) : (
              <h1 className="text-title-1 text-label sm:text-large-title">{title}</h1>
            )}
            {meta}
          </div>
          {subtitle && <p className="mt-1 max-w-2xl text-body text-label-secondary">{subtitle}</p>}
          <ShellTitle title={title} />
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-subheadline text-label-secondary">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="rounded-sm transition-colors hover:text-label">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'text-label')}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight aria-hidden className="size-3.5 text-label-tertiary" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
