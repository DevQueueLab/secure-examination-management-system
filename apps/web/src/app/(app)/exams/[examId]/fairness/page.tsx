import type { Metadata } from 'next';
import { FairnessView } from '@/features/fairness/components/fairness-view';

export const metadata: Metadata = { title: 'Fairness report' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <FairnessView examId={examId} />;
}
