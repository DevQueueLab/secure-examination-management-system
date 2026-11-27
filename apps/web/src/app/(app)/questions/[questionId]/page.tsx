import type { Metadata } from 'next';
import { QuestionEditorPage } from '@/features/authoring/questions/editor/question-editor';

export const metadata: Metadata = { title: 'Question' };

/** Edit one bank question: every save of content creates a new version. */
export default async function Page({ params }: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await params;
  return <QuestionEditorPage questionId={questionId} />;
}
