import type { Metadata } from 'next';
import Link from 'next/link';
import { TxnRow, type TxnSummary } from '@/components/TxnRow';
import { getT } from '@/i18n/server';
import { authed } from '@/lib/me';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('nav.history') };
}

const PAGE_SIZE = 20;

export default async function History(props: PageProps<'/app/history'>) {
  const { t } = await getT();
  const sp = await props.searchParams;
  const page = Math.max(1, Number.parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const data = await authed<{ items: TxnSummary[]; total: number }>(`/transactions?page=${page}&pageSize=${PAGE_SIZE}`, '/app/history');
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  return (
    <>
      <h1 className="page-title">{t('history.title')}</h1>
      <p className="lede">{t('history.lede')}</p>
      {data.items.length ? (
        <div className="panel" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <ul className="list">
            {data.items.map((x) => (
              <li key={x.id}>
                <TxnRow txn={x} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="empty">
          {t('home.noneYet')}{' '}
          <Link href="/app">{t('history.start')}</Link>
        </div>
      )}
      {pages > 1 && (
        <nav className="chips" aria-label={t('history.pages')} style={{ marginTop: 18 }}>
          {page > 1 && (
            <Link className="chip" href={`/app/history?page=${page - 1}`}>
              ← {t('history.newer')}
            </Link>
          )}
          <span className="chip" aria-current="true">
            {t('history.pageOf', { page, pages })}
          </span>
          {page < pages && (
            <Link className="chip" href={`/app/history?page=${page + 1}`}>
              {t('history.older')} →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
