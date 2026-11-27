import { Compass } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/** A 404 inside the shell: the sidebar stays, so the way back is one click away. */
export default function AppNotFound() {
  return (
    <EmptyState
      className="min-h-[calc(100dvh-10rem)]"
      surface={false}
      icon={<Compass />}
      art="column"
      title="This page doesn’t exist"
      description="The link may be old, or the page moved. Your work is safe."
      action={
        <Button asChild variant="filled">
          <Link href="/dashboard">Go to your home</Link>
        </Button>
      }
    />
  );
}
