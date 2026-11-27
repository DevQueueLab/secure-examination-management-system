import type { Metadata } from 'next';
import { Activity } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Nobody is taking this exam right now" };

export default function Page() {
  return (
    <EmptyState
      icon={<Activity />}
      title="Nobody is taking this exam right now"
      description="Live attempts, connection status and integrity indicators appear here while the window is open."
    />
  );
}
