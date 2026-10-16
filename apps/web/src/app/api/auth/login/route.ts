import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, LOCALE_COOKIE } from '@/i18n/core';
import { apiUrl, setSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(apiUrl('/auth/customer/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify({ phone: body.phone, password: body.password }),
  }).catch(() => null);
  if (!res) return NextResponse.json({ code: 'UPSTREAM_UNAVAILABLE', message: 'AMICO is unreachable' }, { status: 502 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  await setSession(data.accessToken);

  // First visit on this device: use the language saved on the account.
  const out = NextResponse.json({ ok: true });
  if (!req.cookies.has(LOCALE_COOKIE)) {
    const me = await fetch(apiUrl('/auth/customer/me'), { headers: { authorization: `Bearer ${data.accessToken}` } })
      .then((r) => r.json())
      .catch(() => null);
    if (isLocale(me?.locale)) out.cookies.set(LOCALE_COOKIE, me.locale, { path: '/', sameSite: 'lax', maxAge: 365 * 86_400, secure: process.env.NODE_ENV === 'production' });
  }
  return out;
}
