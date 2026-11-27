import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "No candidates enrolled" };

export default function Page() {
  return (
    <EmptyState
      icon={<Users />}
      title="No candidates enrolled"
      description="Enroll people one at a time or import a CSV. Each candidate gets their own paper."
    />
  );
}
