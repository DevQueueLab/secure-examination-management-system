import type { Metadata } from 'next';
import { Gavel } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "No disputes for this exam" };

export default function Page() {
  return (
    <EmptyState
      icon={<Gavel />}
      title="No disputes for this exam"
      description="When a candidate questions a grade or a question, it arrives here with the evidence attached."
    />
  );
}
