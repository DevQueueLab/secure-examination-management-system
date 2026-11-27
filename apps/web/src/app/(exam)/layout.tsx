import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { HtmlClass } from '@/features/workspace/workspace';
import { ExamGuard } from './exam-guard';

/** The "Hyperlegible" reading font, offered in workspace preferences. Self-hosted from src/fonts; loaded on use. */
const readable = localFont({
  src: [{ path: '../../fonts/AtkinsonHyperlegibleNext-Variable.woff2', weight: '200 800', style: 'normal' }],
  variable: '--font-readable',
  display: 'swap',
  preload: false,
});

/** Full-screen exam workspace: no sidebar, no tab bar, nothing between the candidate and the paper. */
export default function ExamWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className={readable.variable}>
      <HtmlClass className={readable.variable} />
      <ExamGuard>{children}</ExamGuard>
    </div>
  );
}
