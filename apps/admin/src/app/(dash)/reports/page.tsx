import Link from 'next/link';
import { Empty, PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { fcfa, num } from '@/lib/format';
import { tx } from '@/lib/labels';
import { load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.reports') };
}

interface Revenue { rows: Array<{ bucket: string; transactions: number; volume: number; platformFees: number; providerFees: number; delivered: number }> }
interface Recon {
  generatedAt: string;
  books: Array<{ book: string; balanced: boolean; totalDebits: number; totalCredits: number; accounts: Array<{ code: string; debits: number; credits: number; balance: number }> }>;
  exceptions: Record<string, Array<{ id?: string; reference?: string; transactionId?: string; kind?: string; status?: string }>>;
  notes: string;
}

export default async function Reports(props: PageProps<'/reports'>) {
  const { t, locale } = await getT();
  const sp = await props.searchParams;
  const period = sp.period === 'month' ? 'month' : 'day';
  const simulated = sp.simulated === 'true' ? 'true' : 'false';
  const from = new Date(Date.now() - (period === 'month' ? 365 : 30) * 86_400_000).toISOString();
  const [rev, recon] = await Promise.all([
    load<Revenue>(`/admin/reports/revenue?period=${period}&simulated=${simulated}&from=${from}`),
    load<Recon>('/admin/reports/reconciliation'),
  ]);
  const totals = rev.rows.reduce((s, r) => ({ n: s.n + r.transactions, v: s.v + r.volume, f: s.f + r.platformFees, p: s.p + r.providerFees }), { n: 0, v: 0, f: 0, p: 0 });
  const q = (p: Record<string, string>) => `/reports?${new URLSearchParams({ period, simulated, ...p })}`;
  const dateFmt = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', period === 'day' ? { day: '2-digit', month: 'short', year: 'numeric' } : { month: 'long', year: 'numeric' });

  return (
    <>
      <PageHead title={t('nav.reports')} sub={t('reports.sub')} />
      <nav className="filters">
        <Link href={q({ period: 'day' })} aria-current={period === 'day' ? 'true' : undefined}>{t('reports.daily')}</Link>
        <Link href={q({ period: 'month' })} aria-current={period === 'month' ? 'true' : undefined}>{t('reports.monthly')}</Link>
        <Link href={q({ simulated: 'false' })} aria-current={simulated === 'false' ? 'true' : undefined}>{t('reports.real')}</Link>
        <Link href={q({ simulated: 'true' })} aria-current={simulated === 'true' ? 'true' : undefined}>{t('reports.simulated')}</Link>
      </nav>

      <section className="card">
        <h2>{simulated === 'true' ? t('reports.revenueSim') : t('reports.revenue')}</h2>
        {rev.rows.length === 0 ? (
          <Empty>{t('reports.none')}</Empty>
        ) : (
          <div className="table-wrap flat">
            <table className="t">
              <thead><tr><th>{period === 'day' ? t('reports.day') : t('reports.month')}</th><th className="num">{t('kpi.transactions')}</th><th className="num">{t('reports.volume')}</th><th className="num">{t('quote.platformFee')}</th><th className="num">{t('quote.providerFee')}</th><th className="num">{t('reports.delivered')}</th></tr></thead>
              <tbody>
                {rev.rows.map((r) => (
                  <tr key={r.bucket}>
                    <td>{dateFmt.format(new Date(r.bucket))}</td>
                    <td className="num">{num(r.transactions)}</td>
                    <td className="num">{fcfa(r.volume)}</td>
                    <td className="num"><strong>{fcfa(r.platformFees)}</strong></td>
                    <td className="num">{fcfa(r.providerFees)}</td>
                    <td className="num">{fcfa(r.delivered)}</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>{t('reports.total')}</strong></td>
                  <td className="num"><strong>{num(totals.n)}</strong></td>
                  <td className="num"><strong>{fcfa(totals.v)}</strong></td>
                  <td className="num"><strong>{fcfa(totals.f)}</strong></td>
                  <td className="num"><strong>{fcfa(totals.p)}</strong></td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t('reports.recon')}</h2>
        <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
          {recon.books.map((b) => (
            <div key={b.book}>
              <p style={{ marginTop: 0 }}>
                <strong>{b.book === 'REAL' ? t('reports.realBook') : t('reports.simBook')}</strong>{' '}
                <span className={`badge ${b.balanced ? 'tone-good' : 'tone-bad'}`}>{b.balanced ? t('reports.balanced') : t('reports.unbalanced')}</span>
              </p>
              <table className="t">
                <thead><tr><th>{t('reports.account')}</th><th className="num">{t('reports.balance')}</th></tr></thead>
                <tbody>
                  {b.accounts.filter((a) => a.debits || a.credits).map((a) => (
                    <tr key={a.code}><td className="mono">{a.code}</td><td className="num">{num(a.balance)}</td></tr>
                  ))}
                  {b.accounts.every((a) => !a.debits && !a.credits) && <tr><td colSpan={2} className="sub">{t('reports.noPostings')}</td></tr>}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <h2 style={{ marginTop: 18 }}>{t('reports.exceptions')}</h2>
        {Object.entries(recon.exceptions).map(([k, list]) => (
          <p key={k} style={{ margin: '4px 0' }}>
            <span className={`badge ${list.length ? 'tone-bad' : 'tone-good'}`}>{list.length}</span> {tx(t, `exc.${k}`, k)}
            {list.slice(0, 10).map((x, i) => (
              <Link key={i} href={`/transactions/${x.id ?? x.transactionId}`} className="mono" style={{ marginLeft: 8 }}>{x.reference ?? x.kind}</Link>
            ))}
          </p>
        ))}
        <p className="muted small">{recon.notes}</p>
      </section>
    </>
  );
}
