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

/** Browser → this app's /api/proxy bridge. Never talks to the AMICO API directly. */
export async function callApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path.replace(/^\//, '')}`, {
      ...init,
      headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), ...(init.headers ?? {}) },
    });
  } catch {
    throw new ClientApiError(0, 'NETWORK', 'Network error');
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new ClientApiError(401, 'UNAUTHENTICATED', 'Your session ended');
  }
  if (!res.ok) throw new ClientApiError(res.status, body.code ?? 'ERROR', body.message ?? 'Something went wrong', body.details);
  return body as T;
}
