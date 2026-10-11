import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { ApiError, apiFetch } from './session';

export interface Staff {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

/** Current staff member, fetched once per request. Redirects to sign-in when the session is gone. */
export const getStaff = cache(async (): Promise<Staff> => {
  try {
    return await apiFetch<Staff>('/auth/staff/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    throw e;
  }
});

/** Server-side API call: 401 goes to sign-in, 403 back to the overview, 404 to not-found. */
export async function load<T>(path: string): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    if (e instanceof ApiError && e.status === 403) redirect('/?denied=1');
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export function can(staff: Staff, ...perms: string[]) {
  return perms.every((p) => staff.permissions.includes(p));
}
