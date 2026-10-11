import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Empty, PageHead, SimTag } from '@/components/ui';
import { ago, ASSET_LABEL, fcfa, phone } from '@/lib/format';
import { load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Airtime checks' };

interface Item {
  id: string;
  status: string;
  expectedAmount: number;
  customerReference: string | null;
  submittedAt: string | null;
  requiresDualApproval: boolean;
  transaction: { id: string; reference: string; state: string; createdAt: string; riskLevel: string; isSimulated: boolean; senderMsisdn: string; service: { code: string; name: string; sourceAsset: string } };
}

const VIEWS = [
  { key: 'PENDING', label: 'Waiting for a check' },
  { key: 'AWAITING_SECOND_APPROVAL', label: 'Second approval' },
  { key: 'ON_HOLD,ESCALATED', label: 'On hold or escalated' },
  { key: 'CONFIRMED,REJECTED', label: 'Closed' },
];

export default async function Queue(props: PageProps<'/verifications'>) {
  const sp = await props.searchParams;
  const status = typeof sp.status === 'string' ? sp.status : 'PENDING';
  const items = await load<Item[]>(`/admin/verifications?status=${encodeURIComponent(status)}`);

  return (
    <>
      <PageHead
        title="Airtime checks"
        sub="Customers who say they transferred airtime to a normal SIM. Confirm only what you can see on the SIM itself: a reference or screenshot is not proof."
      />
      <nav className="filters" aria-label="Status">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`/verifications?status=${v.key}`} aria-current={v.key === status ? 'true' : undefined}>
            {v.label}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <Empty>Nothing here. New transfers appear as soon as a customer submits their reference.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Waiting since</th>
                <th>Reference</th>
                <th>Airtime</th>
                <th className="num">Expected</th>
                <th>From</th>
                <th>Customer’s SMS reference</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="row-link">
                  <td>
                    {ago(v.submittedAt)}
                  </td>
                  <td>
                    <Link href={`/verifications/${v.id}`} className="mono">{v.transaction.reference}</Link>
                    <SimTag on={v.transaction.isSimulated} />
                    <div className="sub">{v.transaction.service.name}</div>
                  </td>
                  <td>{ASSET_LABEL[v.transaction.service.sourceAsset]}</td>
                  <td className="num">
                    <strong>{fcfa(v.expectedAmount)}</strong>
                    {v.requiresDualApproval && <div className="sub risk-high">Two approvers</div>}
                  </td>
                  <td>{phone(v.transaction.senderMsisdn)}</td>
                  <td className="mono">{v.customerReference ?? '—'}</td>
                  <td><Badge value={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
