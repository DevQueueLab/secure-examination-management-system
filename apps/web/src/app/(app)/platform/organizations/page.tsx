import type { Metadata } from 'next';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Organizations" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Organizations"
        subtitle="Institutions and competition organizers on Athena."
        breadcrumbs={[{ label: "Platform", href: "/platform" }, { label: "Organizations" }]}
      />
      <EmptyState
        icon={<Building2 />}
        title="No organizations yet"
        description="Each organization gets its own people, roles, question bank and exams, fully isolated from the others."
      />
    </>
  );
}
