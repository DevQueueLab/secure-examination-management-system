import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { LeakTracer } from '@/features/integrity/components/leak-tracer';

export const metadata: Metadata = { title: 'Leak tracer' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?exam=<id>` (from an exam's integrity review) limits the comparison to that exam's papers. */
export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { exam } = await searchParams;
  const examId = typeof exam === 'string' && UUID.test(exam) ? exam : null;
  return (
    <>
      <PageHeader title="Leak tracer" subtitle="Find which paper a leaked question came from, and how sure that is." />
      <LeakTracer examId={examId} />
    </>
  );
}
