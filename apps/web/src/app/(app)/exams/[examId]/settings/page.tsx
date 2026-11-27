import type { Metadata } from 'next';
import { SlidersHorizontal } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Exam settings" };

export default function Page() {
  return (
    <EmptyState
      icon={<SlidersHorizontal />}
      title="Exam settings"
      description="Timing, navigation, integrity checks and how results are released."
    />
  );
}
