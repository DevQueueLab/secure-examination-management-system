'use client';

import { useSyncExternalStore, type ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export interface KbdProps extends ComponentProps<'kbd'> {
  size?: 'sm' | 'md';
}

/** A keycap. */
export function Kbd({ className, size = 'md', ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded-[5px] border border-separator-strong bg-surface font-sans font-medium text-label-secondary shadow-[0_1px_0_var(--separator-strong)]',
        size === 'sm' ? 'h-[18px] min-w-[18px] px-1 text-caption' : 'h-5 min-w-5 px-1.5 text-footnote',
        className,
      )}
      {...props}
    />
  );
}

const subscribe = () => () => {};

/** True on Apple platforms, where shortcuts read ⌘ instead of Ctrl. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent),
    () => true,
  );
}

/** Platform-aware shortcut: <Shortcut keys={['mod', 'K']} /> renders ⌘K on a Mac and Ctrl K elsewhere. */
export function Shortcut({ keys, size = 'md', className }: { keys: string[]; size?: 'sm' | 'md'; className?: string }) {
  const mac = useIsMac();
  const label = (k: string) => (k === 'mod' ? (mac ? '⌘' : 'Ctrl') : k === 'shift' ? '⇧' : k === 'alt' ? (mac ? '⌥' : 'Alt') : k);
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={keys.map((k) => (k === 'mod' ? (mac ? 'Command' : 'Control') : k)).join(' ')}>
      {keys.map((k) => (
        <Kbd key={k} size={size} aria-hidden>
          {label(k)}
        </Kbd>
      ))}
    </span>
  );
}
