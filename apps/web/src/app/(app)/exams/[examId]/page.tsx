import type { Metadata } from 'next';
import { ExamOverview } from '@/features/authoring/exams/exam-overview';

export const metadata: Metadata = { title: 'Exam overview' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ExamOverview examId={examId} />;
}
