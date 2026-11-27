import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';

/** Every signed-in page except the exam workspace lives inside the shell. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
