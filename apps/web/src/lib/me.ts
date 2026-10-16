import 'server-only';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './session';

export interface Me {
  id: string;
  phone: string;
  fullName: string;
  phoneVerified: boolean;
  locale: 'en' | 'fr';
  smsOptIn: boolean;
  whatsappOptIn: boolean;
  createdAt: string;
}

/** Calls the API as the signed-in customer; a dead session goes back to sign-in. */
export async function authed<T>(path: string, back: string): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(`/login?next=${encodeURIComponent(back)}`);
    throw e;
  }
}

export function getMe(back: string) {
  return authed<Me>('/auth/customer/me', back);
}
