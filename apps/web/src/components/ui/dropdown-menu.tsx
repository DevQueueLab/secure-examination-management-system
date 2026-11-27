'use client';

import { Check, ChevronRight } from 'lucide-react';
import { DropdownMenu as Menu } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuSub = Menu.Sub;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

// Menu: 14px radius, 4px inset -> items use 10px so the corners stay concentric.
const surface = cn(
  'z-[60] min-w-[13rem] overflow-hidden rounded-xl bg-surface-raised p-1 text-label shadow-lg',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] duration-150',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98]',
);

const item = cn(
  'relative flex min-h-8 cursor-default select-none items-center gap-2.5 rounded-[calc(var(--radius-xl)-4px)] px-2.5 py-1.5 text-callout outline-none',
  'data-[highlighted]:bg-accent data-[highlighted]:text-on-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
  '[&_svg]:size-4 [&_svg]:shrink-0',
);

export function DropdownMenuContent({ className, sideOffset = 6, align = 'start', ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn(surface, 'origin-(--radix-dropdown-menu-content-transform-origin)', className)}
        {...props}
      />
    </Menu.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof Menu.Item> {
  icon?: ReactNode;
  /** Right-aligned shortcut hint, e.g. "⌘K". */
  shortcut?: string;
  destructive?: boolean;
}

export function DropdownMenuItem({ className, icon, shortcut, destructive, children, ...props }: DropdownMenuItemProps) {
  return (
    <Menu.Item
      className={cn(
        item,
        destructive && 'text-danger-text data-[highlighted]:bg-danger-fill data-[highlighted]:text-white',
        !destructive && '[&_svg]:text-label-secondary data-[highlighted]:[&_svg]:text-on-accent',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="text-footnote tracking-wide opacity-60">{shortcut}</span>}
    </Menu.Item>
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(item, 'pl-8', className)} {...props}>
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, icon, ...props }: ComponentProps<typeof Menu.RadioItem> & { icon?: ReactNode }) {
  return (
    <Menu.RadioItem className={cn(item, 'pl-8 [&_svg]:text-label-secondary data-[highlighted]:[&_svg]:text-on-accent', className)} {...props}>
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check aria-hidden className="size-3.5 !text-current" strokeWidth={2.5} />
        </Menu.ItemIndicator>
      </span>
      {icon}
      <span className="flex-1">{children}</span>
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn('px-2.5 pb-1 pt-1.5 text-footnote font-medium text-label-secondary', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-separator', className)} {...props} />;
}

export function DropdownMenuSubTrigger({ className, icon, children, ...props }: ComponentProps<typeof Menu.SubTrigger> & { icon?: ReactNode }) {
  return (
    <Menu.SubTrigger
      className={cn(item, '[&_svg]:text-label-secondary data-[highlighted]:[&_svg]:text-on-accent data-[state=open]:bg-fill', className)}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      <ChevronRight aria-hidden className="!size-3.5" />
    </Menu.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.Portal>
      <Menu.SubContent
        sideOffset={4}
        collisionPadding={8}
        className={cn(surface, 'min-w-[10rem] origin-(--radix-dropdown-menu-content-transform-origin)', className)}
        {...props}
      />
    </Menu.Portal>
  );
}
