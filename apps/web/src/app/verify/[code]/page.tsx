import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AthenaWordmark } from '@/components/brand';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Verify a result' };

/** Public: anyone holding a report can check it here, no account needed. */
export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-5">
        <Link href="/sign-in" aria-label="Athena" className="rounded-md">
          <AthenaWordmark size={26} />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-16 pt-6">
        <h1 className="text-title-1 text-label sm:text-large-title">Verify a result</h1>
        <p className="mt-1 text-body text-label-secondary">
          Checking report <span className="font-mono text-label">{decodeURIComponent(code)}</span>
        </p>
        <EmptyState
          className="mt-8"
          icon={<ShieldCheck />}
          title="Verification details will appear here"
          description="A valid report shows the candidate, the exam, the score and the date it was issued, signed by the institution."
        />
      </main>
    </div>
  );
}
