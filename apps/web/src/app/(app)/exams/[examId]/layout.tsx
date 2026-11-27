import type { ReactNode } from 'react';
import { ExamHeader, ExamTabsNav } from './exam-nav';

/** Shared chrome for one exam: its header and the section tabs. Tab pages render their content only. */
export default async function ExamLayout({ children, params }: { children: ReactNode; params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return (
    <div className="flex flex-col">
      <ExamHeader examId={examId} />
      <ExamTabsNav examId={examId} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
