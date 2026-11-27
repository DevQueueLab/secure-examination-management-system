import { Atkinson_Hyperlegible_Next } from 'next/font/google';
import type { ReactNode } from 'react';
import { HtmlClass } from '@/features/workspace/workspace';
import { ExamGuard } from './exam-guard';

/** The "Hyperlegible" reading font, offered in workspace preferences. Self-hosted by next/font; loaded on use. */
const readable = Atkinson_Hyperlegible_Next({ subsets: ['latin', 'latin-ext'], variable: '--font-readable', display: 'swap', preload: false });

/** Full-screen exam workspace: no sidebar, no tab bar, nothing between the candidate and the paper. */
export default function ExamWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className={readable.variable}>
      <HtmlClass className={readable.variable} />
      <ExamGuard>{children}</ExamGuard>
    </div>
  );
}
