'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ShellTitleState {
  title: string | null;
  /** True once the page's large title has scrolled under the top bar. */
  condensed: boolean;
}

const ShellTitleContext = createContext<{
  state: ShellTitleState;
  set: (next: ShellTitleState) => void;
} | null>(null);

export function ShellTitleProvider({ children }: { children: ReactNode }) {
  const [state, set] = useState<ShellTitleState>({ title: null, condensed: false });
  return <ShellTitleContext.Provider value={{ state, set }}>{children}</ShellTitleContext.Provider>;
}

export function useShellTitle(): ShellTitleState {
  return useContext(ShellTitleContext)?.state ?? { title: null, condensed: false };
}

/** Invisible sentinel under the page title; reports when it leaves the viewport. */
export function ShellTitle({ title }: { title: string }) {
  const ctx = useContext(ShellTitleContext);
  const ref = useRef<HTMLSpanElement>(null);
  const set = ctx?.set;

  useEffect(() => {
    if (!set || !ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => set({ title, condensed: !!entry && !entry.isIntersecting && entry.boundingClientRect.top < 80 }),
      { rootMargin: '-56px 0px 0px 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      set({ title: null, condensed: false });
    };
  }, [set, title]);

  return <span ref={ref} aria-hidden className="block h-px w-px" />;
}
