import type { Metadata } from 'next';
import { Gauge } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: "Platform overview" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Platform overview"
        subtitle="Tenants, usage and health across Athena."
      />
      <EmptyState
        icon={<Gauge />}
        title="Platform metrics will appear here"
        description="Organization counts, live exams and recent sign-ins show up once tenants start running exams."
        action={<Button asChild variant="gray"><Link href="/platform/organizations">View organizations</Link></Button>}
      />
    </>
  );
}
