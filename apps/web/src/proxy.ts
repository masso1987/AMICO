import { NextResponse, type NextRequest } from 'next/server';

/** Optimistic check only: real authorization happens in the API on every call. */
export function proxy(req: NextRequest) {
  if (!req.cookies.has('amico_session')) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/app/:path*'] };
