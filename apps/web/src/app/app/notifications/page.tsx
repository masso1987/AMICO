import type { Metadata } from 'next';
import Link from 'next/link';
import { getT } from '@/i18n/server';
import { dateTime } from '@/lib/format';
import { authed } from '@/lib/me';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('nav.messages') };
}

interface Note {
  id: string;
  title: string;
  body: string;
  transactionId: string | null;
  createdAt: string;
}

export default async function Notifications() {
  const { t, locale } = await getT();
  const items = await authed<Note[]>('/notifications', '/app/notifications');
  return (
    <>
      <h1 className="page-title">{t('messages.title')}</h1>
      <p className="lede">{t('messages.lede')}</p>
      {items.length ? (
        <div className="panel" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <ul className="list">
            {items.map((n) => (
              <li key={n.id} style={{ padding: '14px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  <strong>{n.title}</strong>
                  <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                    {dateTime(n.createdAt, locale)}
                  </span>
                </div>
                <p style={{ color: 'var(--ink-2)', marginTop: 4 }}>{n.body}</p>
                {n.transactionId && (
                  <Link href={`/app/transactions/${n.transactionId}`} style={{ fontSize: 14 }}>
                    {t('messages.open')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="empty">{t('messages.none')}</div>
      )}
    </>
  );
}
