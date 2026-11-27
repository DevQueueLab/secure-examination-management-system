'use client';

import { CloudOff, FileQuestion, Lock, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { errorMessage, isApiError } from '@/lib/api';

/**
 * The one failure state for authoring pages. Not-found and forbidden are final (the API answers 404 for
 * anything outside the caller's tenant or exams), network errors offer a retry.
 */
export function LoadError({
  error,
  onRetry,
  what = 'page',
  backHref,
  backLabel,
  size = 'md',
}: {
  error: unknown;
  onRetry?: () => void;
  what?: string;
  backHref?: string;
  backLabel?: string;
  size?: 'sm' | 'md';
}) {
  const back = backHref ? (
    <Button asChild variant="gray" size={size === 'sm' ? 'sm' : 'md'}>
      <Link href={backHref}>{backLabel ?? 'Go back'}</Link>
    </Button>
  ) : null;

  if (isApiError(error) && error.isNotFound) {
    return (
      <EmptyState
        size={size}
        icon={<FileQuestion />}
        title={`This ${what} doesn’t exist`}
        description={`It may have been removed, or it belongs to someone else. Ask its owner to add you if you need it.`}
        action={back}
      />
    );
  }
  if (isApiError(error) && error.isForbidden) {
    return <EmptyState size={size} icon={<Lock />} title="You don’t have access" description={error.message} action={back} />;
  }
  const offline = isApiError(error) && error.isNetwork;
  return (
    <EmptyState
      size={size}
      icon={offline ? <CloudOff /> : <TriangleAlert />}
      title={offline ? 'Can’t reach Athena' : `Couldn’t load this ${what}`}
      description={offline ? 'Check your connection. Nothing you saved is lost.' : errorMessage(error)}
      action={
        <div className="flex gap-2">
          {onRetry && (
            <Button variant="tinted" size={size === 'sm' ? 'sm' : 'md'} onClick={onRetry}>
              Try again
            </Button>
          )}
          {back}
        </div>
      }
    />
  );
}
