'use client';

import type { Permission } from '@athena/shared';
import { LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useAuth } from '@/lib/auth';

/**
 * Renders the page only for people who may use it: platform administrators (`platform`), or holders
 * of any of `anyOf` in the current organization. The API enforces the same rule; this keeps someone
 * who follows an old link from landing on a page of permission errors.
 */
export function AccessGate({
  platform,
  anyOf,
  title,
  reason,
  children,
}: {
  platform?: boolean;
  anyOf?: Permission[];
  title: string;
  reason: string;
  children: ReactNode;
}) {
  const { me, canAny } = useAuth();
  if (!me) return null;
  const allowed = platform ? me.user.isPlatformAdmin : !!me.organization && canAny(anyOf ?? []);
  if (allowed) return <>{children}</>;
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        icon={<LockKeyhole />}
        art="shield"
        title="You don’t have access to this page"
        description={reason}
      />
    </>
  );
}
