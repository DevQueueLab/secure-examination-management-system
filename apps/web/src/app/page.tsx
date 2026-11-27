import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Landing } from '@/features/landing/landing';
import type { DrawMode } from '@/features/landing/paper-draw';

export const metadata: Metadata = {
  title: { absolute: 'Athena, the secure online examination platform' },
  description:
    'Athena runs online exams with server-side time, papers balanced to within 2%, offline answers that survive, an append-only grade ledger and reports anyone can verify.',
};

const DEFAULT_SEED = 20261127;

/** The public landing page. Signed-in visitors see a way back into the app instead of the sign-in link. */
export default async function RootPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [jar, params] = await Promise.all([cookies(), searchParams]);
  const signedIn = jar.has('athena_session');

  // The live paper draw falls back to this form without script: ?deal=<seed>&mode=<balanced|chance>.
  const rawSeed = Number(Array.isArray(params.deal) ? params.deal[0] : params.deal);
  const seed = Number.isInteger(rawSeed) && rawSeed > 0 && rawSeed < 2 ** 31 ? rawSeed : DEFAULT_SEED;
  const mode: DrawMode = params.mode === 'chance' ? 'chance' : 'balanced';

  return <Landing signedIn={signedIn} seed={seed} mode={mode} />;
}
