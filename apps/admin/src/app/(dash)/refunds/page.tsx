import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { Badge, Empty, PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { fcfa, when } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.refunds') };
}

interface Refund {
  id: string; amount: number; feeRetained?: number; kind?: string; reason: string; status: string; requestedById: string; approvedById: string | null; evidenceNote: string | null;
  createdAt: string; transactionId: string; transaction: { reference: string; state: string };
}

export default async function Refunds() {
  const { t, locale } = await getT();
  const [list, staff] = await Promise.all([load<Refund[]>('/admin/refunds'), getStaff()]);
  return (
    <>
      <PageHead title={t('nav.refunds')} sub={t('refunds.sub')} />
      {list.length === 0 ? (
        <Empty>{t('refunds.none')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>{t('refunds.txn')}</th><th className="num">{t('refunds.amount')}</th><th>{t('refunds.reason')}</th><th>{t('refunds.status')}</th><th>{t('refunds.requested')}</th><th style={{ width: 320 }}>{t('refunds.action')}</th></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="mono" href={`/transactions/${r.transactionId}`}>{r.transaction.reference}</Link>
                    <div className="sub"><Badge value={r.transaction.state} label={stateLabel(t, r.transaction.state)} /></div>
                  </td>
                  <td className="num">
                    {fcfa(r.amount)}
                    {r.feeRetained ? <div className="sub">{t('refunds.feeKept', { fee: fcfa(r.feeRetained) })}</div> : null}
                  </td>
                  <td>
                    {r.kind && r.kind !== 'STANDARD' && <span className="badge" style={{ marginRight: 6 }}>{t(`refundKind.${r.kind}` as 'refundKind.FAILURE')}</span>}
                    {r.reason}
                    {r.evidenceNote && <div className="sub">{t('refunds.returned', { note: r.evidenceNote })}</div>}
                  </td>
                  <td><Badge value={r.status} label={stateLabel(t, r.status)} /></td>
                  <td className="sub">{when(r.createdAt, locale)}{r.requestedById === staff.id ? ` (${t('staff.you')})` : r.requestedById === 'SYSTEM' ? ` (${t('actor.SYSTEM')})` : ''}</td>
                  <td>
                    {r.status === 'REQUESTED' && can(staff, 'REFUND_APPROVE') && r.requestedById !== staff.id && (
                      <ActionForm path={`admin/refunds/${r.id}/approve`} submit={t('refunds.approve')} confirm={t('refunds.approveConfirm', { amount: fcfa(r.amount) })} compact />
                    )}
                    {r.status === 'REQUESTED' && r.requestedById === staff.id && <span className="sub">{t('refunds.waitingColleague')}</span>}
                    {r.status === 'APPROVED' && r.transaction.state === 'REFUND_PENDING' && can(staff, 'REFUND_REQUEST') && (
                      <ActionForm
                        path={`admin/refunds/${r.id}/confirm-manual`}
                        fields={[{ name: 'evidenceNote', label: t('refunds.howReturned'), kind: 'text', required: true, placeholder: t('refunds.howReturnedExample') }]}
                        submit={t('refunds.confirmReturned')}
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
