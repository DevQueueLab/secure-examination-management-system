import type { Metadata } from 'next';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Organization" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Organization"
        subtitle="Members, roles, exams and status for this tenant."
        breadcrumbs={[{ label: "Platform", href: "/platform" }, { label: "Organizations", href: "/platform/organizations" }, { label: "Organization" }]}
      />
      <EmptyState
        icon={<Building2 />}
        title="Organization details will appear here"
        description="Suspend or reactivate the tenant, see its admins and review its recent activity."
      />
    </>
  );
}
