import type { Metadata } from 'next';
import { PenLine } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Nothing to grade yet" };

export default function Page() {
  return (
    <EmptyState
      icon={<PenLine />}
      title="Nothing to grade yet"
      description="Written responses queue here after candidates submit. Identities stay hidden by default."
    />
  );
}
