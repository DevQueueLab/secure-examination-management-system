import type { Metadata } from 'next';
import { QuestionBank } from '@/features/authoring/questions/question-bank';

export const metadata: Metadata = { title: 'Question bank' };

export default function Page() {
  return <QuestionBank />;
}
