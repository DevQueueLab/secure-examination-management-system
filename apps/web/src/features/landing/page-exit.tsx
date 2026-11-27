'use client';

import { ViewTransition, type ReactNode } from 'react';

/** The landing's way out: when the page is left for another route it leaves with the wipe (globals.css). */
export function PageExit({ children }: { children: ReactNode }) {
  return (
    <ViewTransition exit="page-wipe-out" default="none">
      {children}
    </ViewTransition>
  );
}
