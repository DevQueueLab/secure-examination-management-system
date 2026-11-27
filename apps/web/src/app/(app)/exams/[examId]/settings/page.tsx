import type { Metadata } from 'next';
import { ExamSettingsView } from '@/features/authoring/exams/exam-settings';

export const metadata: Metadata = { title: 'Exam settings' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ExamSettingsView examId={examId} />;
}
