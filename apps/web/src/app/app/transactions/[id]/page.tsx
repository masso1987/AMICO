import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { TransactionView, type Txn } from '@/components/TransactionView';
import { ApiError, apiFetch } from '@/lib/session';

export const metadata: Metadata = { title: 'Exchange status' };

export default async function TransactionPage(props: PageProps<'/app/transactions/[id]'>) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  try {
    const t = await apiFetch<Txn>(`/transactions/${id}`);
    return <TransactionView initial={t} />;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(`/login?next=/app/transactions/${id}`);
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}
