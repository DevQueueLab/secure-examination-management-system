import type { Metadata } from 'next';
import { BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "No analytics yet" };

export default function Page() {
  return (
    <EmptyState
      icon={<BarChart3 />}
      title="No analytics yet"
      description="Question difficulty, discrimination and time spent appear after the first submissions."
    />
  );
}
