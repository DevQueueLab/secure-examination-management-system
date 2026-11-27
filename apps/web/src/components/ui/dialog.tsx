'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  size?: keyof typeof widths;
  /** Show the close button in the corner. Default true. */
  closable?: boolean;
}

/**
 * A focused task that must finish or be cancelled before returning. Prefer inline UI or a Sheet first.
 * Radius 18px with 24px padding: content sits outside the corner zone, so inner shapes need no adjustment.
 */
export function DialogContent({ className, children, size = 'md', closable = true, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-scrim',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200',
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'overflow-hidden rounded-2xl bg-surface-raised text-label shadow-xl outline-none',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.96] data-[state=open]:slide-in-from-bottom-2 duration-200 ease-out-expo',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98]',
          widths[size],
          className,
        )}
        {...props}
      >
        {children}
        {closable && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-5 top-5 inline-flex size-7 items-center justify-center rounded-full bg-fill text-label-secondary transition-colors hover:bg-fill-strong hover:text-label"
          >
            <X aria-hidden className="size-3.5" strokeWidth={2.5} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ title, description, className }: { title: ReactNode; description?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1 px-6 pb-2 pr-14 pt-6', className)}>
      <DialogPrimitive.Title className="text-title-3 text-label">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="text-callout text-label-secondary">{description}</DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>
      )}
    </div>
  );
}

export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

/** Scrolls when content is tall; header and footer stay put. */
export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col-reverse gap-2 px-6 pb-6 pt-2 sm:flex-row sm:justify-end', className)} {...props} />;
}
