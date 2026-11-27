import type { ReactNode } from 'react';
import { ExamGuard } from './exam-guard';

/** Full-screen exam workspace: no sidebar, no tab bar, nothing between the candidate and the paper. */
export default function ExamWorkspaceLayout({ children }: { children: ReactNode }) {
  return <ExamGuard>{children}</ExamGuard>;
}
