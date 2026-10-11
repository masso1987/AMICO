'use client';

export class ClientApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Browser → /api/proxy bridge. */
export async function callApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/proxy/${path.replace(/^\//, '')}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ClientApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
  }
  if (!res.ok) throw new ClientApiError(res.status, body.code ?? 'ERROR', body.message ?? 'Request failed', body.details);
  return body as T;
}

export function errorText(e: unknown): string {
  if (e instanceof ClientApiError) {
    const details = Array.isArray(e.details)
      ? (e.details as Array<{ path?: string; message?: string } | string>).map((d) => (typeof d === 'string' ? d : `${d.path ? d.path + ': ' : ''}${d.message}`)).join('; ')
      : '';
    return details ? `${e.message}: ${details}` : e.message;
  }
  return 'Can’t reach the AMICO API. Check the connection and try again.';
}
