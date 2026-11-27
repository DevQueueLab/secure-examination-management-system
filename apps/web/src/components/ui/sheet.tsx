'use client';

import { X } from 'lucide-react';
import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { Drawer } from 'vaul';
import { cn } from '@/lib/cn';

const MOBILE_QUERY = '(max-width: 767px)';

function subscribeMobile(cb: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** True below the md breakpoint. False during server render. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
}

type Side = 'right' | 'left' | 'bottom';

const SheetContext = createContext<{ side: Side; returnFocus: RefObject<HTMLElement | null> | null }>({ side: 'right', returnFocus: null });

export interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Desktop edge. On phones right-side sheets become bottom drawers you can swipe down;
   * left sheets (navigation) stay on the left.
   */
  side?: Side;
  children: ReactNode;
  /** Prevent dismissing by swipe, scrim tap or Escape (unsaved work). */
  dismissible?: boolean;
}

/** A panel for a parallel task: inspect, edit, filter. Drag to dismiss on touch. */
export function Sheet({ open, onOpenChange, side = 'right', children, dismissible = true }: SheetProps) {
  const mobile = useIsMobile();
  const effective: Side = mobile && side === 'right' ? 'bottom' : side;
  // Sheets opened from state have no Trigger, so Radix has nothing to hand focus back to on close.
  // Remember what had focus when the sheet opened (before the content's focus scope moves it) and return there.
  const returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
  }, [open]);
  return (
    <SheetContext.Provider value={{ side: effective, returnFocus }}>
      <Drawer.Root open={open} onOpenChange={onOpenChange} direction={effective} dismissible={dismissible} repositionInputs={false}>
        {children}
      </Drawer.Root>
    </SheetContext.Provider>
  );
}

export const SheetTrigger = Drawer.Trigger;
export const SheetClose = Drawer.Close;

const sideClass: Record<Side, string> = {
  right: 'inset-y-0 right-0 w-[min(28rem,100vw)] rounded-l-2xl',
  left: 'inset-y-0 left-0 w-[min(20rem,calc(100vw-3rem))] rounded-r-2xl pt-safe pb-safe',
  bottom: 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl pb-safe',
};

export interface SheetContentProps extends Omit<ComponentProps<typeof Drawer.Content>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Hide the title visually (it stays for screen readers). */
  hideHeader?: boolean;
  closable?: boolean;
  /** Render children edge to edge, without the header row or padding (navigation, custom layouts). */
  bare?: boolean;
}

export function SheetContent({
  className,
  children,
  title,
  description,
  hideHeader = false,
  closable = true,
  bare = false,
  onCloseAutoFocus,
  ...props
}: SheetContentProps) {
  const { side, returnFocus } = useContext(SheetContext);
  return (
    <Drawer.Portal>
      <Drawer.Overlay className="fixed inset-0 z-50 bg-scrim" />
      <Drawer.Content
        className={cn('fixed z-50 flex flex-col bg-surface-raised text-label shadow-xl outline-none', sideClass[side], className)}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          const target = returnFocus?.current;
          if (target && target.isConnected) {
            event.preventDefault();
            target.focus({ preventScroll: true });
          }
          if (returnFocus) returnFocus.current = null;
        }}
        {...props}
      >
        {side === 'bottom' && <Drawer.Handle className="mx-auto mt-2 h-1.5 w-9 shrink-0 rounded-full bg-fill-strong" />}
        {bare ? (
          <>
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
            <Drawer.Description className="sr-only">{description ?? (typeof title === 'string' ? title : 'Panel')}</Drawer.Description>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </>
        ) : (
          <>
        <div className={cn('flex items-start justify-between gap-4 px-5 pb-2 pt-4', hideHeader && 'sr-only')}>
          <div className="min-w-0">
            <Drawer.Title className="text-title-3 text-label">{title}</Drawer.Title>
            {description ? (
              <Drawer.Description className="mt-0.5 text-callout text-label-secondary">{description}</Drawer.Description>
            ) : (
              <Drawer.Description className="sr-only">{typeof title === 'string' ? title : 'Panel'}</Drawer.Description>
            )}
          </div>
          {closable && !hideHeader && (
            <Drawer.Close
              aria-label="Close"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-fill text-label-secondary transition-colors hover:bg-fill-strong hover:text-label"
            >
              <X aria-hidden className="size-3.5" strokeWidth={2.5} />
            </Drawer.Close>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">{children}</div>
          </>
        )}
      </Drawer.Content>
    </Drawer.Portal>
  );
}

export function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('sticky bottom-0 -mx-5 -mb-5 mt-4 flex gap-2 border-t bg-surface-raised px-5 py-4', className)} {...props} />;
}
