import type { Metadata } from 'next';
import { AccessGate } from '@/features/admin/components/access-gate';
import { PageHeader } from '@/components/ui/page-header';
import { AuditTimeline } from '@/features/admin/audit/audit-timeline';

export const metadata: Metadata = { title: 'Audit log' };

export default function AuditPage() {
  return (
    <AccessGate
      anyOf={['audit.view']}
      title="Audit log"
      reason="The audit log needs the “View the audit log” permission. Ask an organization admin."
    >
      <PageHeader
        title="Audit log"
        subtitle="Who did what in your organization, and when. Every administrative and grading action is recorded."
      />
      <AuditTimeline scope="org" />
    </AccessGate>
  );
}
