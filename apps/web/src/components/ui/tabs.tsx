'use client';

import { motion } from 'motion/react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { createContext, useContext, useId, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useSpring } from '@/lib/motion';

type Variant = 'segmented' | 'underline';

const TabsContext = createContext<{ value: string; variant: Variant; layoutId: string }>({ value: '', variant: 'segmented', layoutId: '' });

export interface TabsProps extends Omit<ComponentProps<typeof TabsPrimitive.Root>, 'value' | 'defaultValue' | 'onValueChange'> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** segmented: a track with a sliding thumb (switching views). underline: a lighter strip for page sections, marked by a carmine rule. */
  variant?: Variant;
}

/** In-page panels that share one place. For route-level sections use a link nav (see the exam layout). */
export function Tabs({ value, defaultValue, onValueChange, variant = 'segmented', className, ...props }: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const layoutId = useId();
  return (
    <TabsContext.Provider value={{ value: current, variant, layoutId }}>
      <TabsPrimitive.Root
        value={current}
        onValueChange={(v) => {
          if (value === undefined) setInner(v);
          onValueChange?.(v);
        }}
        className={cn('flex flex-col gap-4', className)}
        {...props}
      />
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  const { variant } = useContext(TabsContext);
  return (
    <TabsPrimitive.List
      className={cn(
        variant === 'segmented'
          ? 'relative inline-flex h-8 w-fit items-stretch rounded-[9px] bg-fill p-0.5 text-callout'
          : 'relative flex items-stretch gap-5 overflow-x-auto border-b scrollbar-none text-callout',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, value, children, ...props }: ComponentProps<typeof TabsPrimitive.Trigger> & { children: ReactNode }) {
  const ctx = useContext(TabsContext);
  const transition = useSpring('snappy');
  const active = ctx.value === value;
  const segmented = ctx.variant === 'segmented';
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'relative flex items-center justify-center gap-1.5 whitespace-nowrap font-medium outline-none transition-colors duration-150',
        'text-label-secondary hover:text-label data-[state=active]:text-label disabled:opacity-40 [&_svg]:size-4',
        'focus-visible:outline-[length:var(--focus-width)] focus-visible:outline-focus',
        segmented ? 'rounded-[7px] px-3 focus-visible:outline-offset-0' : 'h-10 px-0.5 focus-visible:outline-offset-2',
        className,
      )}
      {...props}
    >
      {active && (
        <motion.span
          layoutId={`tab-${ctx.layoutId}`}
          transition={transition}
          aria-hidden
          className={segmented ? 'absolute inset-0 rounded-[7px] bg-thumb shadow-sm' : 'absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent'}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">{children}</span>
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 duration-200', className)}
      {...props}
    />
  );
}
