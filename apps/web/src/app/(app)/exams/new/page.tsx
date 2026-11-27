import type { Metadata } from 'next';
import { ClipboardCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "New exam" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="New exam"
        subtitle="Name it, set the window, then choose how it is delivered."
        breadcrumbs={[{ label: "Exams", href: "/exams" }, { label: "New exam" }]}
      />
      <EmptyState
        icon={<ClipboardCheck />}
        title="The exam builder goes here"
        description="Title, schedule, duration and delivery rules come first; questions and candidates follow."
      />
    </>
  );
}
