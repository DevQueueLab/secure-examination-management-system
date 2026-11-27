import type { Metadata } from 'next';
import { Library } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Can } from '@/lib/auth';

export const metadata: Metadata = { title: "Question bank" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Question bank"
        subtitle="Reusable questions for every exam in your organization."
        actions={<><Can permission="questions.manage"><Button asChild variant="gray"><Link href="/questions/import">Import</Link></Button></Can><Can permission="questions.manage"><Button asChild variant="filled"><Link href="/questions/new">New question</Link></Button></Can></>}
      />
      <EmptyState
        icon={<Library />}
        title="Your question bank is empty"
        description="Write questions or import them from a CSV. Each one keeps its history and performance statistics."
        action={<Can permission="questions.manage"><Button asChild variant="filled"><Link href="/questions/new">New question</Link></Button></Can>}
      />
    </>
  );
}
