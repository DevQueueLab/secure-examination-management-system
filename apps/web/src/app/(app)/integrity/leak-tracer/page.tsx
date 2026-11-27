import type { Metadata } from 'next';
import { Fingerprint } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "Leak tracer" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Leak tracer"
        subtitle="Trace leaked exam content back to the paper it came from."
      />
      <EmptyState
        icon={<Fingerprint />}
        title="Paste leaked text to trace it"
        description="Every paper carries an invisible watermark. Athena matches the text and tells you which attempt it came from."
      />
    </>
  );
}
