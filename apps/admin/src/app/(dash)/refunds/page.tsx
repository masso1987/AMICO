import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Empty, PageHead } from '@/components/ui';
import { fcfa, when } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Refunds' };

interface Refund {
  id: string; amount: number; reason: string; status: string; requestedById: string; approvedById: string | null; evidenceNote: string | null;
  createdAt: string; transactionId: string; transaction: { reference: string; state: string };
}

export default async function Refunds() {
  const [list, staff] = await Promise.all([load<Refund[]>('/admin/refunds'), getStaff()]);
  return (
    <>
      <PageHead
        title="Refunds"
        sub="Requested by one person, approved by another. Mobile money refunds go back through the operator; airtime refunds are returned by hand and confirmed here."
      />
      {list.length === 0 ? (
        <Empty>No refunds yet. Request one from a failed or under-review transaction.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Transaction</th><th className="num">Amount</th><th>Reason</th><th>Status</th><th>Requested</th><th style={{ width: 320 }}>Action</th></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="mono" href={`/transactions/${r.transactionId}`}>{r.transaction.reference}</Link>
                    <div className="sub"><Badge value={r.transaction.state} /></div>
                  </td>
                  <td className="num">{fcfa(r.amount)}</td>
                  <td>{r.reason}{r.evidenceNote && <div className="sub">Returned: {r.evidenceNote}</div>}</td>
                  <td><Badge value={r.status} /></td>
                  <td className="sub">{when(r.createdAt)}{r.requestedById === staff.id ? ' (you)' : ''}</td>
                  <td>
                    {r.status === 'REQUESTED' && can(staff, 'REFUND_APPROVE') && r.requestedById !== staff.id && (
                      <ActionForm path={`admin/refunds/${r.id}/approve`} submit="Approve refund" confirm={`Approve a refund of ${fcfa(r.amount)}?`} compact />
                    )}
                    {r.status === 'REQUESTED' && r.requestedById === staff.id && <span className="sub">Waiting for a colleague to approve.</span>}
                    {r.status === 'APPROVED' && r.transaction.state === 'REFUND_PENDING' && can(staff, 'REFUND_REQUEST') && (
                      <ActionForm
                        path={`admin/refunds/${r.id}/confirm-manual`}
                        fields={[{ name: 'evidenceNote', label: 'How the airtime was returned', kind: 'text', required: true, placeholder: 'e.g. Sent 5 000 FCFA airtime back to 6 51…, SMS ref …' }]}
                        submit="Confirm returned"
                        compact
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
