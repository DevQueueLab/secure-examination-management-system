import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Tone } from './badge';

export interface GroupedListProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Small caps-free header above the group. */
  header?: ReactNode;
  /** Explanatory text under the group. */
  footer?: ReactNode;
  /** Render rows as a list for screen readers. Default true. */
  list?: boolean;
}

/** iOS inset grouped list: rounded group, hairline separators inset past the icon. */
export function GroupedList({ header, footer, list = true, className, children, ...props }: GroupedListProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      {header && <div className="px-4 text-footnote font-medium text-label-secondary">{header}</div>}
      <div
        role={list ? 'list' : undefined}
        className="overflow-hidden rounded-xl bg-surface [&>*+*]:before:absolute [&>*+*]:before:top-0 [&>*+*]:before:right-0 [&>*+*]:before:left-[var(--inset,1rem)] [&>*+*]:before:h-px [&>*+*]:before:bg-separator"
      >
        {children}
      </div>
      {footer && <div className="px-4 text-footnote text-label-secondary">{footer}</div>}
    </div>
  );
}

const iconTone: Record<Tone | 'gray', string> = {
  neutral: 'bg-label-tertiary',
  gray: 'bg-label-tertiary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** The rounded coloured square that leads a settings row. */
export function IconTile({ tone = 'accent', children, size = 28, className }: { tone?: Tone | 'gray'; children: ReactNode; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[7px] text-white [&_svg]:size-4', iconTone[tone], className)}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

interface RowBaseProps {
  /** Leading visual: <IconTile>, <Avatar> or an icon. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned value, in secondary colour. */
  value?: ReactNode;
  /** Right-most control: a Switch, a Badge, a Button. */
  accessory?: ReactNode;
  /** Shows a chevron. Default true for links. */
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  className?: string;
}

type RowProps = RowBaseProps &
  (
    | { href: string; onClick?: never; prefetch?: boolean }
    | { onClick: () => void; href?: never; prefetch?: never }
    | { href?: never; onClick?: never; prefetch?: never }
  );

/**
 * One row of a GroupedList. Becomes a link with `href`, a button with `onClick`,
 * or a static row (for rows that hold their own control).
 */
export function GroupedListItem({ icon, title, description, value, accessory, chevron, destructive, disabled, className, href, onClick, prefetch }: RowProps) {
  const interactive = !!href || !!onClick;
  const showChevron = chevron ?? !!href;
  const inner = (
    <>
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col py-0.5">
        <span className={cn('truncate text-body', destructive ? 'text-danger-text' : 'text-label')}>{title}</span>
        {description && <span className="text-subheadline text-label-secondary">{description}</span>}
      </span>
      {value !== undefined && <span className="shrink-0 truncate text-body text-label-secondary">{value}</span>}
      {accessory && <span className="flex shrink-0 items-center">{accessory}</span>}
      {showChevron && <ChevronRight aria-hidden className="size-4 shrink-0 text-label-tertiary" />}
    </>
  );

  const rowClass = cn(
    'relative flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left',
    interactive && 'transition-colors duration-100 hover:bg-fill-secondary active:bg-fill focus-visible:-outline-offset-2',
    disabled && 'pointer-events-none opacity-50',
    className,
  );
  // Separator inset lines up with the text, past the icon.
  const style = { '--inset': icon ? '3.75rem' : '1rem' } as CSSProperties;

  if (href) {
    return (
      <div role="listitem" className="relative" style={style}>
        <Link href={href} prefetch={prefetch} className={rowClass} aria-disabled={disabled || undefined}>
          {inner}
        </Link>
      </div>
    );
  }
  if (onClick) {
    return (
      <div role="listitem" className="relative" style={style}>
        <button type="button" onClick={onClick} disabled={disabled} className={rowClass}>
          {inner}
        </button>
      </div>
    );
  }
  return (
    <div role="listitem" className={cn(rowClass, 'relative')} style={style}>
      {inner}
    </div>
  );
}
