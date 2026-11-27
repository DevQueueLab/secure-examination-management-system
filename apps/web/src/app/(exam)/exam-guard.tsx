'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';

export function ExamGuard({ children }: { children: ReactNode }) {
  const { me, isLoading, isError } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isError && !me) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, isError, me, pathname, router]);

  // Offline or API restarting: still render the workspace so it can resume from its local journal.
  // Children must handle `useAuth().me === null` in this state.
  if (!me && isError) return <div className="min-h-dvh bg-bg text-label">{children}</div>;

  if (!me) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-label-secondary">
        <Spinner size={22} label="Opening your exam" />
      </div>
    );
  }
  return <div className="min-h-dvh bg-bg text-label">{children}</div>;
}
