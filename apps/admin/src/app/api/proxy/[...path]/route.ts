import { NextResponse, type NextRequest } from 'next/server';
import { apiUrl, clearSession, getToken } from '@/lib/session';

/**
 * Staff bridge: forwards only admin endpoints and the staff profile, with the
 * session token attached. The API checks every permission on every call.
 */
const ALLOWED = [/^admin\/[A-Za-z0-9\-/]+$/, /^auth\/staff\/me$/];

async function forward(req: NextRequest, ctx: RouteContext<'/api/proxy/[...path]'>) {
  const { path } = await ctx.params;
  const joined = path.join('/');
  if (!ALLOWED.some((r) => r.test(joined)) || joined.includes('..')) {
    return NextResponse.json({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
  }
  const token = await getToken();
  if (!token) return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Please sign in' }, { status: 401 });

  const headers = new Headers({ authorization: `Bearer ${token}` });
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers.set('x-forwarded-for', fwd);

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const res = await fetch(apiUrl(`/${joined}${req.nextUrl.search}`), {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) await clearSession();
  const out = new Headers({ 'cache-control': 'no-store' });
  for (const h of ['content-type', 'content-disposition']) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new NextResponse(res.body, { status: res.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
