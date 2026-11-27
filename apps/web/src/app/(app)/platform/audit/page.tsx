import type { Metadata } from 'next';
import { AccessGate } from '@/features/admin/components/access-gate';
import { PageHeader } from '@/components/ui/page-header';
import { AuditTimeline } from '@/features/admin/audit/audit-timeline';

export const metadata: Metadata = { title: 'Platform audit' };

export default function PlatformAuditPage() {
  return (
    <AccessGate
      platform
      title="Platform audit"
      reason="This area is for Athena platform administrators."
    >
      <PageHeader
        title="Platform audit"
        subtitle="Onboarding, suspensions and platform administrator sign-ins. What happens inside each organization stays in that organization’s own log."
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Audit' }]}
      />
      <AuditTimeline scope="platform" />
    </AccessGate>
  );
}
