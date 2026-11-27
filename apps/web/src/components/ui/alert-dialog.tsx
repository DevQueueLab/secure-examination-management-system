'use client';

import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import { createContext, useCallback, useContext, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({ className, children, ...props }: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-scrim',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200',
        )}
      />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[22rem] -translate-x-1/2 -translate-y-1/2',
          'rounded-2xl bg-surface-raised p-6 text-center shadow-xl outline-none',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.96] duration-200 ease-out-expo',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98]',
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title className={cn('text-headline text-label', className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description className={cn('mt-1.5 text-callout text-label-secondary', className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row [&>*]:flex-1', className)} {...props} />;
}

export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  /** Name the action: "Delete exam", not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

/** Mount once near the root. Enables `const confirm = useConfirm()`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setPending({ ...options, resolve });
      setOpen(true);
    });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(next) => !next && settle(false)}>
        {pending && (
          <AlertDialogContent>
            <AlertDialogTitle>{pending.title}</AlertDialogTitle>
            {pending.description ? (
              <AlertDialogDescription>{pending.description}</AlertDialogDescription>
            ) : (
              <AlertDialogDescription className="sr-only">Confirm to continue</AlertDialogDescription>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="gray" size="lg" className="text-callout" onClick={() => settle(false)}>
                  {pending.cancelLabel ?? 'Cancel'}
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant={pending.destructive ? 'destructive' : 'filled'}
                  size="lg"
                  className="text-callout"
                  onClick={() => settle(true)}
                >
                  {pending.confirmLabel ?? 'Continue'}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Promise-based confirmation for destructive or irreversible actions:
 * `if (await confirm({ title: 'Delete this exam?', confirmLabel: 'Delete', destructive: true })) ...`
 */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
