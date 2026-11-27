import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyDisputesView } from '@/features/disputes/components/my-disputes';

export const metadata: Metadata = { title: 'My disputes' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const attemptId = one(sp.attemptId);
  // Result pages link here with the question preselected: go straight to the raise flow.
  if (attemptId) {
    const itemId = one(sp.itemId);
    redirect(`/my-disputes/new?attemptId=${encodeURIComponent(attemptId)}${itemId ? `&itemId=${encodeURIComponent(itemId)}` : ''}`);
  }
  return <MyDisputesView />;
}
