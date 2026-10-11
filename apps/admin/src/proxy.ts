import { NextResponse, type NextRequest } from 'next/server';

/** Optimistic check only: the API authorizes every request. */
export function proxy(req: NextRequest) {
  if (!req.cookies.has('amico_staff')) {
    const url = new URL('/login', req.url);
    if (req.nextUrl.pathname !== '/') url.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!login|api|_next|icon|apple-icon|favicon).*)'] };
