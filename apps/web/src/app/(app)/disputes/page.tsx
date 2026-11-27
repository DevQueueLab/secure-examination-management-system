import type { Metadata } from 'next';
import { Scale } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Disputes" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle="Candidate requests to review a grade or a question."
      />
      <EmptyState
        icon={<Scale />}
        title="No open disputes"
        description="Disputes arrive with the candidate’s answer, the rubric and the grading history attached."
      />
    </>
  );
}
