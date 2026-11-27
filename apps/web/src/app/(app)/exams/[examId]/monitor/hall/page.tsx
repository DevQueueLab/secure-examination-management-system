import type { Metadata } from 'next';
import { HallDisplay } from '@/features/monitoring/hall/hall-display';

export const metadata: Metadata = { title: 'Hall display' };

/** The exam room's projector view of the live monitor: same data, same access, no candidate names. */
export default async function HallDisplayPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <HallDisplay examId={examId} />;
}
