import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SendForm } from '@/components/SendForm';
import type { ServiceSummary } from '@/components/RouteList';
import { ApiError, apiFetch } from '@/lib/session';

export const metadata: Metadata = { title: 'New exchange' };

export default async function SendPage(props: PageProps<'/app/send/[code]'>) {
  const { code } = await props.params;
  let services: ServiceSummary[];
  let me: { phone: string };
  try {
    [services, me] = await Promise.all([apiFetch<ServiceSummary[]>('/services'), apiFetch<{ phone: string }>('/auth/customer/me')]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(`/login?next=/app/send/${code}`);
    throw e;
  }
  const service = services.find((s) => s.code === code);
  if (!service) notFound();

  return (
    <>
      <p style={{ margin: '0 0 12px' }}>
        <Link href="/app">Choose another route</Link>
      </p>
      <h1 className="page-title">New exchange</h1>
      <p className="lede">Enter the amount and numbers, then check the quote before you confirm.</p>
      <SendForm service={service} myPhone={me.phone} />
    </>
  );
}
