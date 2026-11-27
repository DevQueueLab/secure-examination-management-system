import type { Metadata } from 'next';
import { RaiseFlow } from '@/features/disputes/components/raise-flow';

export const metadata: Metadata = { title: 'Raise a dispute' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  return <RaiseFlow attemptId={one(sp.attemptId) ?? null} itemId={one(sp.itemId) ?? null} />;
}
