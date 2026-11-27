'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './field';
import { controlBase } from './input';

export const SelectRoot = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, size = 'md', id, ...props }: ComponentProps<typeof SelectPrimitive.Trigger> & { size?: 'sm' | 'md' | 'lg' }) {
  const field = useFieldControl({ id, 'aria-describedby': props['aria-describedby'], 'aria-invalid': props['aria-invalid'] as boolean | undefined });
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        controlBase,
        'flex items-center justify-between gap-2 px-3 text-left data-[placeholder]:text-placeholder',
        size === 'sm' ? 'h-8 text-callout' : size === 'lg' ? 'h-11' : 'h-9',
        '[&>span]:truncate',
        className,
      )}
      {...props}
      id={field.id}
      aria-describedby={field['aria-describedby']}
      aria-invalid={field['aria-invalid']}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-label-tertiary" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = 'popper', ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          'relative z-[60] max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-xl bg-surface-raised p-1 text-label shadow-lg',
          'origin-(--radix-select-content-transform-origin) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] duration-150',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="max-h-80">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, description, ...props }: ComponentProps<typeof SelectPrimitive.Item> & { description?: ReactNode }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        // Concentric with the 14px menu and its 4px inset.
        'relative flex min-h-8 w-full select-none items-center gap-2 rounded-[calc(var(--radius-xl)-4px)] py-1.5 pl-8 pr-3 text-callout outline-none',
        'data-[highlighted]:bg-accent data-[highlighted]:text-on-accent data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="flex flex-col">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description && <span className="text-footnote opacity-75">{description}</span>}
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn('px-3 pb-1 pt-2 text-footnote font-medium text-label-secondary', className)} {...props} />;
}

export function SelectSeparator({ className, ...props }: ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn('mx-2 my-1 h-px bg-separator', className)} {...props} />;
}

export interface SelectOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  id?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Needed when the select has no visible Field label. */
  'aria-label'?: string;
}

/** Convenience select from a list of options. Use the Select* parts for groups or custom rows. */
export function Select({ options, value, defaultValue, onValueChange, placeholder = 'Choose…', disabled, name, required, id, size, className, ...rest }: SelectProps) {
  return (
    <SelectRoot value={value} defaultValue={defaultValue} onValueChange={onValueChange} disabled={disabled} name={name} required={required}>
      <SelectTrigger id={id} size={size} className={className} aria-label={rest['aria-label']}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled} description={o.description}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
