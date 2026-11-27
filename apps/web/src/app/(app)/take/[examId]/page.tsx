import type { Metadata } from 'next';
import { Lobby } from '@/features/candidate/lobby';

export const metadata: Metadata = { title: 'Exam lobby' };

export default async function LobbyPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <Lobby examId={examId} />;
}
