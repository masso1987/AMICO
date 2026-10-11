import 'server-only';
import { cookies, headers } from 'next/headers';

export const SESSION_COOKIE = 'amico_session';

export function apiUrl(path: string): string {
  const base = process.env.API_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}${path}`;
}

/**
 * The API token lives only in an httpOnly cookie, so page scripts can never read it.
 * Lifetime matches the API's customer token (30 minutes); the API is the real judge of expiry.
 */
export async function setSession(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 60,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side call to the API with the signed-in customer's token. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const fwd = (await headers()).get('x-forwarded-for');
  const res = await fetch(apiUrl(path), {
    ...init,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(fwd ? { 'x-forwarded-for': fwd } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.code ?? 'ERROR', body.message ?? 'Request failed');
  return body as T;
}
