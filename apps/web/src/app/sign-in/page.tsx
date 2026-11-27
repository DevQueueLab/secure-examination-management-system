import type { Metadata } from 'next';
import { connection } from 'next/server';
import { resolveBrandImage } from '@/features/landing/brand-assets.server';
import { SignInView } from './sign-in-view';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Rendered per request, so a bust dropped into public/brand appears without a rebuild.
  await connection();
  // Read on the server and passed down, so no client component calls useSearchParams() (which would need a
  // Suspense boundary, and a boundary here would stop the wordmark and bust morph from /).
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const next = first(params.next);
  const expired = first(params.reason) === 'expired';
  const marble = resolveBrandImage('athenaMarble');
  const glass = resolveBrandImage('athenaGlass');
  // No Suspense boundary here: the page renders per request, so the search params never suspend, and without a
  // boundary a navigation from / commits the whole page in one transition, which lets the wordmark and bust morph.
  return <SignInView marble={marble} glass={glass} next={next} expired={expired} />;
}
