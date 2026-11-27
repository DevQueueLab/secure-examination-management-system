import type { Metadata } from 'next';
import { FileUp } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Import questions" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Import questions"
        subtitle="Bring questions in from a spreadsheet."
        breadcrumbs={[{ label: "Question bank", href: "/questions" }, { label: "Import" }]}
      />
      <EmptyState
        icon={<FileUp />}
        title="Import from CSV"
        description="Upload a file, map its columns and review every row before anything is saved."
      />
    </>
  );
}
