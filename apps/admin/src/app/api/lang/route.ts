import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, LOCALE_COOKIE } from '@/i18n/core';
import { apiUrl, getToken } from '@/lib/session';

/** Switches the dashboard language: a cookie for this browser, and the staff profile (alert SMS follow it). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isLocale(body.locale)) return NextResponse.json({ code: 'VALIDATION_FAILED', message: 'locale must be en or fr' }, { status: 400 });
  const token = await getToken();
  if (token) {
    await fetch(apiUrl('/auth/staff/me'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ locale: body.locale }),
    }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCALE_COOKIE, body.locale, { path: '/', sameSite: 'lax', maxAge: 365 * 86_400, secure: process.env.NODE_ENV === 'production' });
  return res;
}
