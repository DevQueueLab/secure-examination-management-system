import type { Metadata } from 'next';
import { Gauge } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Exam overview" };

export default function Page() {
  return (
    <EmptyState
      icon={<Gauge />}
      title="Exam overview"
      description="Status, schedule, enrollment and readiness checks for this exam will appear here."
    />
  );
}
