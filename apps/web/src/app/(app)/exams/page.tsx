import type { Metadata } from 'next';
import { ExamList } from '@/features/authoring/exams/exam-list';

export const metadata: Metadata = { title: 'Exams' };

export default function Page() {
  return <ExamList />;
}
