import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/session';
import { dateTime, fcfa, STATE_COPY } from '@/lib/format';

export const metadata: Metadata = { title: 'History' };

interface Page {
  page: number;
  pageSize: number;
  total: number;
  items: { id: string; reference: string; service: { name: string }; state: string; customerPays: number; expectedDelivered: number; simulated: boolean; createdAt: string }[];
}

export default async function History(props: PageProps<'/app/history'>) {
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  let data: Page;
  try {
    data = await apiFetch<Page>(`/transactions?page=${page}&pageSize=20`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login?next=/app/history');
    throw e;
  }
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <h1 className="page-title">History</h1>
      {data.items.length === 0 ? (
        <>
          <p className="lede">You haven’t made an exchange yet.</p>
          <Link className="btn btn-primary" href="/app">
            Start an exchange
          </Link>
        </>
      ) : (
        <>
          <p className="lede">{data.total} exchanges. Select one to see its progress or receipt.</p>
          <table className="history">
            <thead>
              <tr>
                <th>Exchange</th>
                <th className="hide-sm">Date</th>
                <th>Status</th>
                <th className="num">Received</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => {
                const c = STATE_COPY[t.state] ?? { title: t.state, tone: 'wait' };
                return (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/app/transactions/${t.id}`}>{t.service.name}</Link>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {t.reference} {t.simulated && <span className="sim-tag">Simulation</span>}
                      </div>
                    </td>
                    <td className="hide-sm muted">{dateTime(t.createdAt)}</td>
                    <td>
                      <span className={`pill tone-${c.tone}`}>{c.title}</span>
                    </td>
                    <td className="num money">{fcfa(t.expectedDelivered)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pages > 1 && (
            <nav style={{ display: 'flex', gap: 12, marginTop: 20 }} aria-label="Pages">
              {page > 1 && <Link href={`/app/history?page=${page - 1}`}>Newer</Link>}
              <span className="muted">
                Page {page} of {pages}
              </span>
              {page < pages && <Link href={`/app/history?page=${page + 1}`}>Older</Link>}
            </nav>
          )}
        </>
      )}
    </>
  );
}
