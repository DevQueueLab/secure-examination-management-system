import type { Metadata } from 'next';
import { QuestionImport } from '@/features/authoring/questions/question-import';

export const metadata: Metadata = { title: 'Import questions' };

export default function Page() {
  return <QuestionImport />;
}
