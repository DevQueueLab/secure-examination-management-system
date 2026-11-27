import type { Metadata } from 'next';
import { Scale } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Fairness report" };

export default function Page() {
  return (
    <EmptyState
      icon={<Scale />}
      title="Fairness report"
      description="Once questions are added, see how evenly difficulty is spread across every randomized paper."
    />
  );
}
