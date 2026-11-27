import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'athena_session';

/** Routes anyone may open without a session. */
const PUBLIC_PREFIXES = ['/sign-in', '/verify/'];

/**
 * Optimistic gate: visitors without a session cookie are sent to sign in.
 * The API still validates every request; a stale cookie is caught client side on the first 401.
 * Cookie holders are never bounced away from /sign-in, so an expired cookie cannot loop.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except the API, Next internals, metadata files and anything with a file extension.
    '/((?!api/|socket\\.io/|_next/|favicon\\.ico|icon\\.svg|apple-icon|manifest|robots\\.txt|sitemap\\.xml|.*\\.[a-zA-Z0-9]+$).*)',
  ],
};
