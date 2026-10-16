import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from '@/i18n/core';
import { apiUrl, setSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cookie = req.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookie) ? cookie : DEFAULT_LOCALE;
  const res = await fetch(apiUrl('/auth/customer/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify({ phone: body.phone, fullName: body.fullName, password: body.password, locale }),
  }).catch(() => null);
  if (!res) return NextResponse.json({ code: 'UPSTREAM_UNAVAILABLE', message: 'AMICO is unreachable' }, { status: 502 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  await setSession(data.accessToken);
  return NextResponse.json({ ok: true });
}
