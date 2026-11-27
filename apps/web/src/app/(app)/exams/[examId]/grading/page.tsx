import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SkeletonRows } from '@/components/ui/skeleton';
import { GradingWorkspace } from '@/features/grading/components/grading-workspace';

export const metadata: Metadata = { title: 'Grading' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <GradingWorkspace examId={examId} />
    </Suspense>
  );
}
