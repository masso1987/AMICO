import { NextResponse, type NextRequest } from 'next/server';
import { apiUrl, setSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(apiUrl('/auth/staff/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  await setSession(data.accessToken);
  return NextResponse.json({ ok: true });
}
