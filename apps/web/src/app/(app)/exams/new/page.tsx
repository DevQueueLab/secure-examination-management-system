import type { Metadata } from 'next';
import { ExamWizard } from '@/features/authoring/exams/exam-wizard';

export const metadata: Metadata = { title: 'New exam' };

export default function Page() {
  return <ExamWizard />;
}
