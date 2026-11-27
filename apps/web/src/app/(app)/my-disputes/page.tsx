import type { Metadata } from 'next';
import { MessageSquareWarning } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: "My disputes" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="My disputes"
        subtitle="Requests you have raised about a grade or a question."
      />
      <EmptyState
        icon={<MessageSquareWarning />}
        title="No disputes"
        description="If something in a published result looks wrong, open the result and choose Raise a dispute."
        action={<Button asChild variant="gray"><Link href="/results">View results</Link></Button>}
      />
    </>
  );
}
