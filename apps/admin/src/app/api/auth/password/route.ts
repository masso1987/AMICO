import { NextResponse, type NextRequest } from 'next/server';
import { apiUrl, getToken, setSession } from '@/lib/session';

/** Change your own password. Other sessions end; this one gets a fresh token. */
export async function POST(req: NextRequest) {
  const token = await getToken();
  if (!token) return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Please sign in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const res = await fetch(apiUrl('/auth/staff/password'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify({ currentPassword: body.currentPassword, newPassword: body.newPassword }),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ code: data.code, message: data.message, details: data.details }, { status: res.status });
  await setSession(data.accessToken);
  return NextResponse.json({ ok: true });
}
