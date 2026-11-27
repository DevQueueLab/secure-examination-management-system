'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { StaffHome } from '@/features/staff-home/staff-home';
import { homePathFor, useAuth } from '@/lib/auth';
import { CandidateHome } from './candidate-home';

/**
 * /dashboard picks its home by role: candidates (exams.take and no staff permission) get their exams,
 * everyone else the staff home. Platform admins without an organization go to /platform.
 */
export function DashboardSwitch() {
  const { me, audience, isLoading } = useAuth();
  const router = useRouter();
  const toPlatform = !!me && homePathFor(me) === '/platform';

  useEffect(() => {
    if (toPlatform) router.replace('/platform');
  }, [toPlatform, router]);

  if (isLoading || !me || toPlatform) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3 pt-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
    );
  }
  return audience === 'candidate' ? <CandidateHome /> : <StaffHome />;
}
