import type { Metadata } from 'next';
import { AccessGate } from '@/features/admin/components/access-gate';
import { PlatformOverview } from '@/features/admin/platform/platform-overview';

export const metadata: Metadata = { title: 'Platform' };

export default function PlatformPage() {
  return (
    <AccessGate platform title="Platform" reason="This area is for Athena platform administrators.">
      <PlatformOverview />
    </AccessGate>
  );
}
