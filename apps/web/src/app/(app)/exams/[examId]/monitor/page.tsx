import type { Metadata } from 'next';
import { MonitorView } from '@/features/monitoring/components/monitor-view';

export const metadata: Metadata = { title: 'Live monitor' };

/** Live examination monitoring (FR-3.6). The exam header and section tabs come from the exam layout. */
export default async function MonitorPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <MonitorView examId={examId} />;
}
