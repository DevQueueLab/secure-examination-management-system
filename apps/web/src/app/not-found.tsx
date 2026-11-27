import { Compass } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <EmptyState
        className="w-full max-w-md"
        icon={<Compass />}
        title="This page doesn’t exist"
        description="The link may be old, or the page moved. Your work is safe."
        action={
          <Button asChild variant="filled">
            <Link href="/dashboard">Go to Athena</Link>
          </Button>
        }
      />
    </main>
  );
}
