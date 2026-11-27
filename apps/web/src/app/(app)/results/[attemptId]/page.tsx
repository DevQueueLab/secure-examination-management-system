import type { Metadata } from 'next';
import { ResultReport } from '@/features/results/components/result-report';

export const metadata: Metadata = { title: 'Result' };

export default async function Page({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return <ResultReport attemptId={attemptId} />;
}
