import { NextResponse, type NextRequest } from 'next/server';
import { apiUrl, clearSession, getToken } from '@/lib/session';

/**
 * Backend-for-frontend bridge: the browser calls /api/proxy/<path>, this handler
 * attaches the session token and forwards to the AMICO API. Only customer
 * endpoints are reachable from here; admin routes belong to the admin dashboard.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTES: { path: RegExp; methods: string[]; public?: boolean }[] = [
  { path: /^services$/, methods: ['GET'], public: true },
  { path: /^status$/, methods: ['GET'], public: true },
  { path: /^public\/(config|sell-credit)$/, methods: ['GET'], public: true },
  { path: /^offers$/, methods: ['GET'], public: true },
  { path: new RegExp(`^offers/${UUID}/image$`), methods: ['GET'], public: true },
  { path: /^bundles$/, methods: ['GET'], public: true },
  { path: /^quotes$/, methods: ['POST'] },
  { path: /^transactions$/, methods: ['GET', 'POST'] },
  { path: new RegExp(`^transactions/${UUID}$`), methods: ['GET'] },
  { path: new RegExp(`^transactions/${UUID}/(source-reference|cancel)$`), methods: ['POST'] },
  { path: /^evidence$/, methods: ['POST'] },
  { path: /^notifications$/, methods: ['GET'] },
  { path: /^auth\/customer\/me$/, methods: ['GET', 'PATCH'] },
];

async function forward(req: NextRequest, ctx: RouteContext<'/api/proxy/[...path]'>) {
  const { path } = await ctx.params;
  const joined = path.join('/');
  const route = ROUTES.find((r) => r.path.test(joined));
  if (!route) return NextResponse.json({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
  if (!route.methods.includes(req.method)) return NextResponse.json({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, { status: 405 });

  const token = await getToken();
  if (!token && !route.public) return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Please sign in' }, { status: 401 });

  const headers = new Headers();
  for (const h of ['content-type', 'idempotency-key', 'accept']) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (token) headers.set('authorization', `Bearer ${token}`);
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers.set('x-forwarded-for', fwd);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let res: Response;
  try {
    res = await fetch(apiUrl(`/${joined}${req.nextUrl.search}`), {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ code: 'UPSTREAM_UNAVAILABLE', message: 'AMICO is unreachable' }, { status: 502 });
  }

  if (res.status === 401 && token) await clearSession();
  const isImage = joined.startsWith('offers/') && res.ok;
  return new NextResponse(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
      'cache-control': isImage ? 'public, max-age=86400' : 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
