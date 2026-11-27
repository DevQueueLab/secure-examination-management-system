import type { Metadata } from 'next';
import { Workspace } from '@/features/workspace/workspace';

export const metadata: Metadata = { title: 'Exam in progress' };

/** The candidate workspace: full screen, local-first, timed by the server. */
export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return <Workspace attemptId={attemptId} />;
}
