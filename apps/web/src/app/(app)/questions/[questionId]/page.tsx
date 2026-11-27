import type { Metadata } from 'next';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Question" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Question"
        subtitle="Content, answer key, history and how it has performed."
        breadcrumbs={[{ label: "Question bank", href: "/questions" }, { label: "Question" }]}
      />
      <EmptyState
        icon={<FileText />}
        title="Question details will appear here"
        description="Edit the question, review its revisions and see how candidates answered it."
      />
    </>
  );
}
