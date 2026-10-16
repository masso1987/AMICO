import { NextResponse, type NextRequest } from 'next/server';
import { apiUrl, clearSession, getToken } from '@/lib/session';

/** Sign out on every device, including this one. */
export async function POST(req: NextRequest) {
  const token = await getToken();
  if (token) {
    await fetch(apiUrl('/auth/staff/sessions/revoke'), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' },
      cache: 'no-store',
    }).catch(() => undefined);
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}
