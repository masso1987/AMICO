import Link from 'next/link';
import { Badge, PageHead, SimTag } from '@/components/ui';
import { ago, fcfa } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

interface Txn { id: string; reference: string; state: string; customerPays: number; isSimulated: boolean; createdAt: string; service: { code: string } }
interface Page<T> { total: number; items: T[] }

export default async function Overview(props: PageProps<'/'>) {
  const denied = (await props.searchParams).denied === '1';
  const staff = await getStaff();
  const verifs = can(staff, 'VERIFY_MANUAL') ? await load<Array<{ status: string }>>('/admin/verifications') : [];
  const exceptions = can(staff, 'TRANSACTION_READ')
    ? await load<Page<Txn>>('/admin/transactions?state=UNDER_REVIEW,FAILED,REFUND_PENDING&pageSize=10')
    : null;
  const recent = can(staff, 'TRANSACTION_READ') ? await load<Page<Txn>>('/admin/transactions?pageSize=8') : null;
  const recon = can(staff, 'REPORT_READ')
    ? await load<{ books: Array<{ book: string; balanced: boolean }>; exceptions: Record<string, unknown[]> }>('/admin/reports/reconciliation')
    : null;
  const reconIssues = recon ? Object.values(recon.exceptions).reduce((s, l) => s + l.length, 0) : 0;

  const pending = verifs.filter((v) => v.status === 'PENDING').length;
  const second = verifs.filter((v) => v.status === 'AWAITING_SECOND_APPROVAL').length;
  const held = verifs.filter((v) => v.status === 'ON_HOLD' || v.status === 'ESCALATED').length;

  return (
    <>
      <PageHead title={`Good day, ${staff.fullName.split(' ')[0]}`} sub="What needs attention right now." />
      {denied && <p className="note" role="alert">You don’t have access to that page. Ask an administrator if you need it.</p>}

      <div className="grid-3">
        {can(staff, 'VERIFY_MANUAL') && (
          <Link href="/verifications" className={`card stat${pending ? ' attention' : ''}`}>
            <div className="n">{pending}</div>
            <div className="l">Airtime transfers waiting for a check</div>
          </Link>
        )}
        {can(staff, 'VERIFY_MANUAL') && (
          <Link href="/verifications?status=AWAITING_SECOND_APPROVAL" className={`card stat${second ? ' attention' : ''}`}>
            <div className="n">{second}</div>
            <div className="l">Waiting for a second approver</div>
          </Link>
        )}
        {can(staff, 'VERIFY_MANUAL') && (
          <Link href="/verifications?status=ON_HOLD,ESCALATED" className={`card stat${held ? ' alert' : ''}`}>
            <div className="n">{held}</div>
            <div className="l">On hold or escalated</div>
          </Link>
        )}
        {exceptions && (
          <Link href="/transactions?state=UNDER_REVIEW,FAILED,REFUND_PENDING" className={`card stat${exceptions.total ? ' alert' : ''}`}>
            <div className="n">{exceptions.total}</div>
            <div className="l">Transactions under review, failed or refunding</div>
          </Link>
        )}
        {recon && (
          <Link href="/reports" className={`card stat${reconIssues || recon.books.some((b) => !b.balanced) ? ' alert' : ''}`}>
            <div className="n">{reconIssues}</div>
            <div className="l">
              Reconciliation exceptions. Ledgers are {recon.books.every((b) => b.balanced) ? 'balanced' : 'NOT balanced'}.
            </div>
          </Link>
        )}
      </div>

      {recent && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Latest transactions</h2>
          {recent.items.length === 0 ? (
            <p className="sub" style={{ color: 'var(--muted)', margin: 0 }}>No transactions yet.</p>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Service</th>
                  <th>State</th>
                  <th className="num">Customer pays</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recent.items.map((t) => (
                  <tr key={t.id} className="row-link">
                    <td>
                      <Link href={`/transactions/${t.id}`} className="mono">{t.reference}</Link>
                      <SimTag on={t.isSimulated} />
                    </td>
                    <td>{t.service.code}</td>
                    <td><Badge value={t.state} /></td>
                    <td className="num">{fcfa(t.customerPays)}</td>
                    <td className="sub">{ago(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
