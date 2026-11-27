import type { Metadata } from 'next';
import { Trophy } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Results" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Results"
        subtitle="Published results for exams you have taken."
      />
      <EmptyState
        icon={<Trophy />}
        title="No results yet"
        description="Results appear here as soon as your examiner publishes them."
      />
    </>
  );
}
