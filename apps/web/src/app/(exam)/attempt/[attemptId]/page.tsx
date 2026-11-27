import { NotebookPen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AthenaMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Exam in progress' };

/** The candidate workspace. The feature build replaces the body; the frame stays minimal and full screen. */
export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  await params;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="material hairline-b sticky top-0 z-20 pt-safe">
        <div className="flex h-13 items-center gap-3 px-4 sm:px-6">
          <AthenaMark size={24} />
          <p className="min-w-0 flex-1 truncate text-headline text-label">Examination</p>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Leave</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-10">
        <EmptyState
          icon={<NotebookPen />}
          title="Your exam workspace"
          description="Questions, the timer, your answers and the navigator appear here. Answers save as you type, even offline."
        />
      </main>
    </div>
  );
}
