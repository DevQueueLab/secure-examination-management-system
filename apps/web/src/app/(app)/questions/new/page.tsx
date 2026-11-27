import type { Metadata } from 'next';
import { PenLine } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "New question" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="New question"
        subtitle="Choose a type, write the stem, then set the answer key."
        breadcrumbs={[{ label: "Question bank", href: "/questions" }, { label: "New question" }]}
      />
      <EmptyState
        icon={<PenLine />}
        title="The question editor goes here"
        description="Ten question types, from single choice to code, each with its own marking rules."
      />
    </>
  );
}
