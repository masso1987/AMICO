import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RouteList, type ServiceSummary } from '@/components/RouteList';
import { ApiError, apiFetch } from '@/lib/session';

export const metadata: Metadata = { title: 'Exchange' };

export default async function ExchangeHome() {
  let me: { fullName: string };
  let services: ServiceSummary[];
  try {
    [me, services] = await Promise.all([apiFetch<{ fullName: string }>('/auth/customer/me'), apiFetch<ServiceSummary[]>('/services')]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login?next=/app');
    throw e;
  }
  const first = me.fullName.split(' ')[0];

  return (
    <>
      <h1 className="page-title">Hello {first}, what would you like to do?</h1>
      <p className="lede">Pick a route. You’ll see the full cost and the amount that arrives before anything is charged.</p>
      {services.length ? (
        <RouteList services={services} linkBase="/app/send" />
      ) : (
        <div className="alert alert-info">No exchanges are open right now. Check back soon.</div>
      )}
    </>
  );
}
