import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Empty, PageHead, SimTag } from '@/components/ui';
import { fcfa, phone, when } from '@/lib/format';
import { load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Transactions' };

interface Txn {
  id: string; reference: string; state: string; customerPays: number; expectedDelivered: number; platformFee: number;
  senderMsisdn: string; recipientMsisdn: string; isSimulated: boolean; riskLevel: string; createdAt: string; service: { code: string };
}

const VIEWS = [
  { key: '', label: 'All' },
  { key: 'UNDER_REVIEW,FAILED,REFUND_PENDING', label: 'Exceptions' },
  { key: 'AWAITING_SOURCE_PAYMENT,PAYMENT_PROCESSING,AWAITING_MANUAL_VERIFICATION,SOURCE_VERIFIED,PAYOUT_PROCESSING,DELIVERY_PENDING', label: 'In progress' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'REJECTED,REFUNDED', label: 'Rejected or refunded' },
];

export default async function Transactions(props: PageProps<'/transactions'>) {
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
      <PageHead title="Transactions" sub={`${data.total} matching`}>
        <form action="/transactions" style={{ display: 'flex', gap: 6 }}>
          {state && <input type="hidden" name="state" value={state} />}
          <input type="text" name="search" defaultValue={search} placeholder="Reference or phone number" aria-label="Search" style={{ width: 240 }} />
          <button className="btn btn-quiet" type="submit">Search</button>
        </form>
      </PageHead>
      <nav className="filters" aria-label="State">
        {VIEWS.map((v) => (
          <Link key={v.label} href={v.key ? `/transactions?state=${v.key}` : '/transactions'} aria-current={v.key === state ? 'true' : undefined}>
            {v.label}
          </Link>
        ))}
      </nav>
      {data.items.length === 0 ? (
        <Empty>No transactions match.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Service</th>
                <th>State</th>
                <th className="num">Customer pays</th>
                <th className="num">Delivered</th>
                <th className="num">AMICO fee</th>
                <th>From → to</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} className="row-link">
                  <td>
                    <Link href={`/transactions/${t.id}`} className="mono">{t.reference}</Link>
                    <SimTag on={t.isSimulated} />
                    {t.riskLevel === 'HIGH' && <div className="sub risk-high">High value</div>}
                  </td>
                  <td>{t.service.code}</td>
                  <td><Badge value={t.state} /></td>
                  <td className="num">{fcfa(t.customerPays)}</td>
                  <td className="num">{fcfa(t.expectedDelivered)}</td>
                  <td className="num">{fcfa(t.platformFee)}</td>
                  <td className="sub">{phone(t.senderMsisdn)} → {phone(t.recipientMsisdn)}</td>
                  <td className="sub">{when(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="filters" style={{ marginTop: 12 }} aria-label="Pages">
          {page > 1 && <Link href={link({ page: page - 1 })}>Newer</Link>}
          <span style={{ padding: '5px 4px', color: 'var(--muted)' }}>Page {page} of {pages}</span>
          {page < pages && <Link href={link({ page: page + 1 })}>Older</Link>}
        </nav>
      )}
    </>
  );
}
