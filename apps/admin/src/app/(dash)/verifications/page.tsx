import Link from 'next/link';
import { Badge, Empty, PageHead, SimTag } from '@/components/ui';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/core';
import { ago, ASSET_LABEL, fcfa, phone } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import { load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.verifications') };
}

interface Item {
  id: string; status: string; expectedAmount: number; customerReference: string | null; submittedAt: string | null; requiresDualApproval: boolean;
  transaction: { id: string; reference: string; state: string; createdAt: string; riskLevel: string; isSimulated: boolean; senderMsisdn: string; cancelRequestedAt?: string | null; service: { code: string; name: string; sourceAsset: string } };
}

const VIEWS: Array<{ key: string; label: MessageKey }> = [
  { key: 'PENDING', label: 'verifs.pending' },
  { key: 'AWAITING_SECOND_APPROVAL', label: 'verifs.second' },
  { key: 'ON_HOLD,ESCALATED', label: 'verifs.held' },
  { key: 'CONFIRMED,REJECTED', label: 'verifs.closed' },
];

export default async function Queue(props: PageProps<'/verifications'>) {
  const { t, locale } = await getT();
  const sp = await props.searchParams;
  const status = typeof sp.status === 'string' ? sp.status : 'PENDING';
  const items = await load<Item[]>(`/admin/verifications?status=${encodeURIComponent(status)}`);

  return (
    <>
      <PageHead title={t('nav.verifications')} sub={t('verifs.sub')} />
      <nav className="filters" aria-label={t('pricing.status')}>
        {VIEWS.map((v) => (
          <Link key={v.key} href={`/verifications?status=${v.key}`} aria-current={v.key === status ? 'true' : undefined}>
            {t(v.label)}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <Empty>{t('verifs.none')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t('verifs.waiting')}</th>
                <th>{t('txns.reference')}</th>
                <th>{t('verifs.airtime')}</th>
                <th className="num">{t('verifs.expected')}</th>
                <th>{t('txn.from')}</th>
                <th>{t('verifs.smsRef')}</th>
                <th>{t('pricing.status')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="row-link">
                  <td>{ago(v.submittedAt, locale)}</td>
                  <td>
                    <Link href={`/verifications/${v.id}`} className="mono">{v.transaction.reference}</Link>
                    <SimTag on={v.transaction.isSimulated} />
                    <div className="sub">{v.transaction.service.name}</div>
                    {v.transaction.cancelRequestedAt && <div className="sub review-text">{t('txns.cancelAsked')}</div>}
                  </td>
                  <td>{ASSET_LABEL[v.transaction.service.sourceAsset]}</td>
                  <td className="num">
                    <strong>{fcfa(v.expectedAmount)}</strong>
                    {v.requiresDualApproval && <div className="sub risk-high">{t('verifs.twoApprovers')}</div>}
                  </td>
                  <td>{phone(v.transaction.senderMsisdn)}</td>
                  <td className="mono">{v.customerReference ?? '—'}</td>
                  <td><Badge value={v.status} label={stateLabel(t, v.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
