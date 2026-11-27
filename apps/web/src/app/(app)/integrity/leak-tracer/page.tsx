import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { LeakTracer } from '@/features/integrity/components/leak-tracer';

export const metadata: Metadata = { title: 'Leak tracer' };

export default function Page() {
  return (
    <>
      <PageHeader title="Leak tracer" subtitle="Find which paper a leaked question came from, and how sure that is." />
      <LeakTracer />
    </>
  );
}
