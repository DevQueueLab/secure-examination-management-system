import type { Metadata } from 'next';
import { AccessGate } from '@/features/admin/components/access-gate';
import { OrganizationsView } from '@/features/admin/platform/organizations-view';

export const metadata: Metadata = { title: 'Organizations' };

export default function OrganizationsPage() {
  return (
    <AccessGate
      platform
      title="Organizations"
      reason="This area is for Athena platform administrators."
    >
      <OrganizationsView />
    </AccessGate>
  );
}
