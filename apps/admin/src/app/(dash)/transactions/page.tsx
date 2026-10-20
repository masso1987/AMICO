import Link from 'next/link';
import { Badge, Empty, PageHead, SimTag } from '@/components/ui';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/core';
import { fcfa, phone, when } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import { load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.transactions') };
}

interface Txn {
  id: string; reference: string; state: string; customerPays: number; expectedDelivered: number; platformFee: number;
  senderMsisdn: string; recipientMsisdn: string; isSimulated: boolean; riskLevel: string; createdAt: string; service: { code: string };
  cancelRequestedAt?: string | null;
}

const VIEWS: Array<{ key: string; label: MessageKey }> = [
  { key: '', label: 'common.all' },
  { key: 'UNDER_REVIEW,FAILED,REFUND_PENDING', label: 'txns.exceptions' },
  { key: 'AWAITING_SOURCE_PAYMENT,PAYMENT_PROCESSING,AWAITING_MANUAL_VERIFICATION,SOURCE_VERIFIED,PAYOUT_PROCESSING,DELIVERY_PENDING', label: 'txns.inProgress' },
  { key: 'COMPLETED', label: 'txns.completed' },
  { key: 'REJECTED,REFUNDED', label: 'txns.closed' },
];

export default async function Transactions(props: PageProps<'/transactions'>) {
  const { t, locale } = await getT();
  const sp = await props.searchParams;
  const state = typeof sp.state === 'string' ? sp.state : '';
  const search = typeof sp.search === 'string' ? sp.search : '';
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(state ? { state } : {}), ...(search ? { search } : {}) });
  const data = await load<{ total: number; items: Txn[] }>(`/admin/transactions?${qs}`);
  const pages = Math.max(1, Math.ceil(data.total / 25));
  const link = (p: Record<string, string | number>) => `/transactions?${new URLSearchParams({ ...(state ? { state } : {}), ...(search ? { search } : {}), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) })}`;

  return (
    <>
      <PageHead title={t('nav.transactions')} sub={t('txns.matching', { n: data.total })}>
        <form action="/transactions" className="search-form">
          {state && <input type="hidden" name="state" value={state} />}
          <input type="text" name="search" defaultValue={search} placeholder={t('txns.searchPlaceholder')} aria-label={t('txns.search')} />
          <button className="btn btn-quiet" type="submit">{t('txns.search')}</button>
        </form>
      </PageHead>
      <nav className="filters" aria-label={t('pricing.status')}>
        {VIEWS.map((v) => (
          <Link key={v.label} href={v.key ? `/transactions?state=${v.key}` : '/transactions'} aria-current={v.key === state ? 'true' : undefined}>
            {t(v.label)}
          </Link>
        ))}
      </nav>
      {data.items.length === 0 ? (
        <Empty>{t('txns.none')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t('txns.reference')}</th>
                <th>{t('pricing.service')}</th>
                <th>{t('pricing.status')}</th>
                <th className="num">{t('txns.customerPays')}</th>
                <th className="num">{t('reports.delivered')}</th>
                <th className="num">{t('quote.platformFee')}</th>
                <th>{t('txns.fromTo')}</th>
                <th>{t('txns.created')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((x) => (
                <tr key={x.id} className="row-link">
                  <td>
                    <Link href={`/transactions/${x.id}`} className="mono">{x.reference}</Link>
                    <SimTag on={x.isSimulated} />
                    {x.riskLevel === 'HIGH' && <div className="sub risk-high">{t('txns.highValue')}</div>}
                    {x.cancelRequestedAt && <div className="sub review-text">{t('txns.cancelAsked')}</div>}
                  </td>
                  <td>{x.service.code}</td>
                  <td><Badge value={x.state} label={stateLabel(t, x.state)} /></td>
                  <td className="num">{fcfa(x.customerPays)}</td>
                  <td className="num">{fcfa(x.expectedDelivered)}</td>
                  <td className="num">{fcfa(x.platformFee)}</td>
                  <td className="sub">{phone(x.senderMsisdn)} → {phone(x.recipientMsisdn)}</td>
                  <td className="sub nowrap">{when(x.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="filters" style={{ marginTop: 12 }} aria-label={t('common.pages')}>
          {page > 1 && <Link href={link({ page: page - 1 })}>{t('common.newer')}</Link>}
          <span style={{ padding: '5px 4px', color: 'var(--muted)' }}>{t('common.pageOf', { page, pages })}</span>
          {page < pages && <Link href={link({ page: page + 1 })}>{t('common.older')}</Link>}
        </nav>
      )}
    </>
  );
}
