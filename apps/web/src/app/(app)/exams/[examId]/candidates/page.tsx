import type { Metadata } from 'next';
import { ExamCandidates } from '@/features/authoring/exams/exam-candidates';

export const metadata: Metadata = { title: 'Exam candidates' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ExamCandidates examId={examId} />;
}
