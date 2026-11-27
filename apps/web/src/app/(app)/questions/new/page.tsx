import type { Metadata } from 'next';
import { QuestionEditorPage } from '@/features/authoring/questions/editor/question-editor';

export const metadata: Metadata = { title: 'New question' };

export default function Page() {
  return <QuestionEditorPage />;
}
