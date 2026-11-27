import type { Metadata } from 'next';
import { DoorOpen } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Exam lobby" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Exam lobby"
        subtitle="Check the rules, your device and the time before you begin."
        breadcrumbs={[{ label: "My exams", href: "/dashboard" }, { label: "Lobby" }]}
      />
      <EmptyState
        icon={<DoorOpen />}
        title="Your exam lobby"
        description="The rules, the honor code and a quick device check appear here before the exam starts."
      />
    </>
  );
}
