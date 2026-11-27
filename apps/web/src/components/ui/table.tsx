import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Data table on a hairline sheet. Scrolls horizontally on narrow screens instead of squashing columns.
 * Put the row's primary text in the first column; keep numbers right-aligned (`numeric`).
 * `stickyHeader` pins the header under the top bar while the page scrolls. It trades the horizontal
 * scroll for clipping, so use it on tables that fit their width.
 */
export function Table({
  className,
  containerClassName,
  stickyHeader = false,
  ...props
}: ComponentProps<'table'> & { containerClassName?: string; stickyHeader?: boolean }) {
  return (
    <div
      className={cn(
        'relative w-full rounded-xl bg-surface ring-1 ring-separator',
        stickyHeader ? 'overflow-x-clip' : 'overflow-x-auto',
        containerClassName,
      )}
    >
      <table
        className={cn(
          'w-full caption-bottom border-collapse text-callout',
          stickyHeader &&
            '[&_thead_th]:sticky [&_thead_th]:top-[calc(env(safe-area-inset-top)+3.25rem)] [&_thead_th]:z-10 [&_thead_th]:bg-surface [&_thead_th]:shadow-[inset_0_-1px_0_var(--separator-strong)]',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-separator-strong', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return <tfoot className={cn('border-t bg-fill-secondary font-medium', className)} {...props} />;
}

export function TableRow({ className, interactive, selected, ...props }: ComponentProps<'tr'> & { interactive?: boolean; selected?: boolean }) {
  return (
    <tr
      data-selected={selected || undefined}
      aria-selected={selected || undefined}
      className={cn(
        'border-b border-separator transition-colors duration-100',
        interactive && 'cursor-default hover:bg-fill-secondary',
        'data-[selected]:bg-accent-tint',
        className,
      )}
      {...props}
    />
  );
}

export type SortDirection = 'asc' | 'desc' | false;

export interface TableHeadProps extends ComponentProps<'th'> {
  numeric?: boolean;
  /** Makes the header a sort button. Pass the current direction for this column, or false. */
  sort?: SortDirection;
  onSort?: () => void;
}

export function TableHead({ className, numeric, sort, onSort, children, ...props }: TableHeadProps) {
  const sortable = onSort !== undefined;
  return (
    <th
      scope="col"
      aria-sort={sortable ? (sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none') : undefined}
      className={cn(
        'h-10 whitespace-nowrap px-4 text-left align-middle text-footnote font-medium tracking-[0.005em] text-label-secondary',
        numeric && 'text-right',
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            '-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-fill-secondary hover:text-label',
            sort && 'text-label',
            numeric && 'flex-row-reverse',
          )}
        >
          {children}
          {sort === 'asc' ? (
            <ArrowUp aria-hidden className="size-3.5" />
          ) : sort === 'desc' ? (
            <ArrowDown aria-hidden className="size-3.5" />
          ) : (
            <ChevronsUpDown aria-hidden className="size-3.5 opacity-50" />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TableCell({ className, numeric, ...props }: ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      className={cn('px-4 py-3 align-middle text-label', numeric && 'text-right tabular-nums', className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption className={cn('px-4 py-3 text-left text-footnote text-label-secondary', className)} {...props} />;
}

/** A single full-width row for empty or error states inside a table body. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}
