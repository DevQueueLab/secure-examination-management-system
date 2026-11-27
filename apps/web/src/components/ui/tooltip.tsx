'use client';

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Shortcut } from './kbd';

export function TooltipProvider({ delayDuration = 400, skipDelayDuration = 200, ...props }: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />;
}

export interface TooltipProps {
  /** Short text, no punctuation. */
  content: ReactNode;
  /** Keyboard shortcut after the text. 'mod' renders ⌘ on Apple platforms and Ctrl elsewhere: ['mod', 'K']. */
  shortcut?: string[];
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** The trigger. Must be a single focusable element (Button, Link). */
  children: ReactNode;
  disabled?: boolean;
}

/** Label for icon buttons and truncated text. Never put essential information only here. */
export function Tooltip({ content, shortcut, side = 'top', align = 'center', children, disabled }: TooltipProps) {
  if (disabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-[70] flex max-w-64 items-center gap-2 rounded-md bg-surface-raised px-2 py-1 text-footnote font-medium text-label shadow-md',
            'origin-(--radix-tooltip-content-transform-origin) animate-in fade-in-0 zoom-in-95 duration-150',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          {content}
          {shortcut && <Shortcut keys={shortcut} size="sm" />}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
