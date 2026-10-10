import { NextResponse, type NextRequest } from 'next/server';
import { apiUrl, clearSession, getToken } from '@/lib/session';

/**
 * Backend-for-frontend bridge: the browser calls /api/proxy/<path>, this handler
 * attaches the session token and forwards to the AMICO API. Only customer
 * endpoints are reachable from here; admin routes belong to the admin dashboard.
 */
const ALLOWED = [
  /^services$/,
  /^quotes$/,
  /^transactions$/,
  /^transactions\/[0-9a-f-]{36}$/,
  /^transactions\/[0-9a-f-]{36}\/source-reference$/,
  /^evidence$/,
  /^notifications$/,
  /^auth\/customer\/me$/,
];

async function forward(req: NextRequest, ctx: RouteContext<'/api/proxy/[...path]'>) {
  const { path } = await ctx.params;
  const joined = path.join('/');
  if (!ALLOWED.some((r) => r.test(joined))) {
    return NextResponse.json({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
  }
  const token = await getToken();
  if (!token && joined !== 'services') {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Please sign in' }, { status: 401 });
  }

  const headers = new Headers();
  for (const h of ['content-type', 'idempotency-key', 'accept']) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (token) headers.set('authorization', `Bearer ${token}`);
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers.set('x-forwarded-for', fwd);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const res = await fetch(apiUrl(`/${joined}${req.nextUrl.search}`), {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    cache: 'no-store',
  });

  if (res.status === 401) await clearSession();
  return new NextResponse(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}

export const GET = forward;
export const POST = forward;
