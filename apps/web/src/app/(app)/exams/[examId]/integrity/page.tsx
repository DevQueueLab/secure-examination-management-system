import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SkeletonRows } from '@/components/ui/skeleton';
import { IntegrityView } from '@/features/integrity/components/integrity-view';

export const metadata: Metadata = { title: 'Integrity review' };

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <IntegrityView examId={examId} />
    </Suspense>
  );
}
