import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TransactionView, type Txn } from '@/components/TransactionView';
import { getT } from '@/i18n/server';
import { authed } from '@/lib/me';
import { ApiError } from '@/lib/session';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('txn.title') };
}

export default async function Page(props: PageProps<'/app/transactions/[id]'>) {
  const { t } = await getT();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  let txn: Txn;
  try {
    txn = await authed<Txn>(`/transactions/${id}`, `/app/transactions/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  return (
    <>
      <Link href="/app/history" className="back no-print">
        ← {t('nav.history')}
      </Link>
      <TransactionView initial={txn} />
    </>
  );
}
