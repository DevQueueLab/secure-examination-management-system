import type { Metadata } from 'next';
import { ExamResultsView } from '@/features/results/components/exam-results';

export const metadata: Metadata = { title: 'Results' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ExamResultsView examId={examId} />;
}
