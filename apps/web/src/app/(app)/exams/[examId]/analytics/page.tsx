import type { Metadata } from 'next';
import { ExamAnalyticsView } from '@/features/analytics/components/exam-analytics';

export const metadata: Metadata = { title: 'Analytics' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ExamAnalyticsView examId={examId} />;
}
