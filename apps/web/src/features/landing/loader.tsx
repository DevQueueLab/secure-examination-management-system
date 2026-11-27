import { cookies } from 'next/headers';
import { LoaderClient } from './loader-client';

/* Set by loader-client.tsx when the loader plays; a session cookie, so it lasts as long as the browser session. */
const COOKIE = 'athena_intro';

/**
 * The first-visit loader. Once it has played, the browser carries a session cookie and the server stops sending
 * it, so a reload in the same session paints the hero at once, with no flash of the loader before hydration.
 */
export async function Loader() {
  const jar = await cookies();
  if (jar.get(COOKIE)?.value === '1') return null;
  return <LoaderClient />;
}
