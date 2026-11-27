import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "No integrity indicators" };

export default function Page() {
  return (
    <EmptyState
      icon={<ShieldCheck />}
      title="No integrity indicators"
      description="Focus changes, paste events and other signals show here for review. They are indicators, never verdicts."
    />
  );
}
