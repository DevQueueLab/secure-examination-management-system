import type { Metadata } from 'next';
import { AccessGate } from '@/features/admin/components/access-gate';
import { TenantDetail } from '@/features/admin/platform/tenant-detail';

export const metadata: Metadata = { title: 'Organization' };

export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AccessGate
      platform
      title="Organization"
      reason="This area is for Athena platform administrators."
    >
      <TenantDetail id={id} />
    </AccessGate>
  );
}
