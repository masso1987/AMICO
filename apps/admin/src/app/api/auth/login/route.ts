import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import QRCode from 'qrcode';
import { isLocale, LOCALE_COOKIE } from '@/i18n/core';
import { apiUrl, setSession } from '@/lib/session';

/**
 * Staff sign-in bridge. The API's short-lived challenge token stays in an
 * httpOnly cookie between steps; the browser only learns which step is next.
 *
 *   { step: 'password', email, password }
 *   { step: 'totp', code }
 *   { step: 'new-password', newPassword }
 */
const CHALLENGE_COOKIE = 'amico_staff_challenge';
const PATHS = { password: '/auth/staff/login', totp: '/auth/staff/login/totp', 'new-password': '/auth/staff/login/password' } as const;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const step = body.step as keyof typeof PATHS;
  if (!(step in PATHS)) return NextResponse.json({ code: 'BAD_REQUEST', message: 'Unknown step' }, { status: 400 });

  const jar = await cookies();
  const challenge = jar.get(CHALLENGE_COOKIE)?.value;
  if (step !== 'password' && !challenge) return NextResponse.json({ code: 'CHALLENGE_EXPIRED', message: 'Sign-in took too long. Start again.' }, { status: 401 });

  const payload =
    step === 'password' ? { email: body.email, password: body.password }
    : step === 'totp' ? { challenge, code: String(body.code ?? '').replace(/\s/g, '') }
    : { challenge, newPassword: body.newPassword };

  const res = await fetch(apiUrl(PATHS[step]), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.code === 'CHALLENGE_EXPIRED') jar.delete(CHALLENGE_COOKIE);
    return NextResponse.json({ code: data.code, message: data.message, details: data.details }, { status: res.status });
  }

  if (data.next === 'DONE') {
    jar.delete(CHALLENGE_COOKIE);
    await setSession(data.accessToken);
    // First sign-in on this browser: use the language saved on the staff account.
    if (!jar.has(LOCALE_COOKIE)) {
      const me = await fetch(apiUrl('/auth/staff/me'), { headers: { authorization: `Bearer ${data.accessToken}` }, cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null);
      if (isLocale(me?.locale)) jar.set(LOCALE_COOKIE, me.locale, { path: '/', sameSite: 'lax', maxAge: 365 * 86_400, secure: process.env.NODE_ENV === 'production' });
    }
    return NextResponse.json({ next: 'DONE' });
  }

  jar.set(CHALLENGE_COOKIE, data.challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: 5 * 60,
  });
  if (data.next === 'TOTP_ENROLL') {
    const qrSvg = await QRCode.toString(data.otpauthUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0e1424', light: '#ffffff' } });
    return NextResponse.json({ next: 'TOTP_ENROLL', qrSvg, secret: data.secret });
  }
  return NextResponse.json({ next: data.next });
}
