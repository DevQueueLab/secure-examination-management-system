import type { Metadata } from 'next';
import { ExamQuestions } from '@/features/authoring/exams/exam-questions';

export const metadata: Metadata = { title: 'Exam questions' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ExamQuestions examId={examId} />;
}
