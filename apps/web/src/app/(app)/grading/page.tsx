import type { Metadata } from 'next';
import { PenLine } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Grading" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Grading"
        subtitle="Responses waiting for a grader, across your exams."
      />
      <EmptyState
        icon={<PenLine />}
        title="Nothing to grade"
        description="Written answers queue here after candidates submit. Grading is anonymous by default."
      />
    </>
  );
}
