'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      className="mt-10"
      icon={<TriangleAlert />}
      title="This page hit a problem"
      description={error.digest ? `Try again. If it keeps happening, share this reference: ${error.digest}` : 'Try again. If it keeps happening, reload the page.'}
      action={
        <Button variant="filled" onClick={reset}>
          <RefreshCw aria-hidden /> Try again
        </Button>
      }
    />
  );
}
