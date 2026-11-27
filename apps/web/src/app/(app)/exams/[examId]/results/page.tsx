import type { Metadata } from 'next';
import { Trophy } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Results aren’t ready" };

export default function Page() {
  return (
    <EmptyState
      icon={<Trophy />}
      title="Results aren’t ready"
      description="Review scores and the grade distribution, then publish results to candidates."
    />
  );
}
