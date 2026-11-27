import type { Metadata } from 'next';
import { Trophy } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Result" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Result"
        subtitle="Your score, feedback and the answers you gave."
        breadcrumbs={[{ label: "Results", href: "/results" }, { label: "Result" }]}
      />
      <EmptyState
        icon={<Trophy />}
        title="Result details will appear here"
        description="See marks per question, feedback from graders and, if allowed, the correct answers."
      />
    </>
  );
}
