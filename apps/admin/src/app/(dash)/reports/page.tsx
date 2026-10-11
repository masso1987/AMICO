import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHead } from '@/components/ui';
import { fcfa, num } from '@/lib/format';
import { load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Reports' };

interface Revenue { rows: Array<{ bucket: string; transactions: number; volume: number; platformFees: number; providerFees: number; delivered: number }> }
interface Recon {
  generatedAt: string;
  books: Array<{ book: string; balanced: boolean; totalDebits: number; totalCredits: number; accounts: Array<{ code: string; debits: number; credits: number; balance: number }> }>;
  exceptions: Record<string, Array<{ id?: string; reference?: string; transactionId?: string; kind?: string; status?: string }>>;
  notes: string;
}

const EXC: Record<string, string> = {
  completedWithoutPayoutJournal: 'Completed but no payout posted',
  fundsHeldOnClosedTransactions: 'Rejected but funds were received',
  uncertainOperations: 'Provider calls with no final answer for over an hour',
  succeededButNotCompleted: 'Delivered by the provider but not marked completed',
};

export default async function Reports(props: PageProps<'/reports'>) {
  const sp = await props.searchParams;
  const period = sp.period === 'month' ? 'month' : 'day';
  const simulated = sp.simulated === 'true' ? 'true' : 'false';
  const from = new Date(Date.now() - (period === 'month' ? 365 : 30) * 86_400_000).toISOString();
  const [rev, recon] = await Promise.all([
    load<Revenue>(`/admin/reports/revenue?period=${period}&simulated=${simulated}&from=${from}`),
    load<Recon>('/admin/reports/reconciliation'),
  ]);
  const totals = rev.rows.reduce((t, r) => ({ n: t.n + r.transactions, v: t.v + r.volume, f: t.f + r.platformFees, p: t.p + r.providerFees }), { n: 0, v: 0, f: 0, p: 0 });
  const q = (p: Record<string, string>) => `/reports?${new URLSearchParams({ period, simulated, ...p })}`;

  return (
    <>
      <PageHead title="Reports" sub="Revenue from completed transactions, and checks that every book balances." />
      <nav className="filters">
        <Link href={q({ period: 'day' })} aria-current={period === 'day' ? 'true' : undefined}>Daily, last 30 days</Link>
        <Link href={q({ period: 'month' })} aria-current={period === 'month' ? 'true' : undefined}>Monthly, last 12 months</Link>
        <Link href={q({ simulated: 'false' })} aria-current={simulated === 'false' ? 'true' : undefined}>Real money</Link>
        <Link href={q({ simulated: 'true' })} aria-current={simulated === 'true' ? 'true' : undefined}>Simulated</Link>
      </nav>

      <section className="card">
        <h2>Revenue{simulated === 'true' ? ' (simulated, not real income)' : ''}</h2>
        {rev.rows.length === 0 ? (
          <Empty>No completed {simulated === 'true' ? 'simulated' : 'real'} transactions in this period.</Empty>
        ) : (
          <table className="t">
            <thead><tr><th>{period === 'day' ? 'Day' : 'Month'}</th><th className="num">Transactions</th><th className="num">Volume paid in</th><th className="num">AMICO fees</th><th className="num">Operator fees</th><th className="num">Delivered</th></tr></thead>
            <tbody>
              {rev.rows.map((r) => (
                <tr key={r.bucket}>
                  <td>{new Date(r.bucket).toLocaleDateString('en-GB', period === 'day' ? { day: '2-digit', month: 'short', year: 'numeric' } : { month: 'long', year: 'numeric' })}</td>
                  <td className="num">{num(r.transactions)}</td>
                  <td className="num">{fcfa(r.volume)}</td>
                  <td className="num"><strong>{fcfa(r.platformFees)}</strong></td>
                  <td className="num">{fcfa(r.providerFees)}</td>
                  <td className="num">{fcfa(r.delivered)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Total</strong></td>
                <td className="num"><strong>{num(totals.n)}</strong></td>
                <td className="num"><strong>{fcfa(totals.v)}</strong></td>
                <td className="num"><strong>{fcfa(totals.f)}</strong></td>
                <td className="num"><strong>{fcfa(totals.p)}</strong></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Reconciliation</h2>
        <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {recon.books.map((b) => (
            <div key={b.book}>
              <p style={{ marginTop: 0 }}>
                <strong>{b.book === 'REAL' ? 'Real-money ledger' : 'Simulated ledger'}</strong>{' '}
                <span className={`badge ${b.balanced ? 'tone-good' : 'tone-bad'}`}>{b.balanced ? 'Balanced' : 'Not balanced'}</span>
              </p>
              <table className="t">
                <thead><tr><th>Account</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  {b.accounts.filter((a) => a.debits || a.credits).map((a) => (
                    <tr key={a.code}><td className="mono">{a.code}</td><td className="num">{num(a.balance)}</td></tr>
                  ))}
                  {b.accounts.every((a) => !a.debits && !a.credits) && <tr><td colSpan={2} className="sub">No postings yet.</td></tr>}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <h2 style={{ marginTop: 18 }}>Exceptions</h2>
        {Object.entries(recon.exceptions).map(([k, list]) => (
          <p key={k} style={{ margin: '4px 0' }}>
            <span className={`badge ${list.length ? 'tone-bad' : 'tone-good'}`}>{list.length}</span> {EXC[k] ?? k}
            {list.slice(0, 10).map((x, i) => (
              <Link key={i} href={`/transactions/${x.id ?? x.transactionId}`} className="mono" style={{ marginLeft: 8 }}>{x.reference ?? x.kind}</Link>
            ))}
          </p>
        ))}
        <p className="sub" style={{ color: 'var(--muted)', fontSize: 13 }}>{recon.notes}</p>
      </section>
    </>
  );
}
