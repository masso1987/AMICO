import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { Badge, KV, PageHead, SimTag } from '@/components/ui';
import { getT } from '@/i18n/server';
import { ASSET_LABEL, fcfa, num, phone, when } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('txn.title') };
}

interface Detail {
  id: string; reference: string; state: string; isSimulated: boolean; riskLevel: string; createdAt: string;
  amount: number; customerPays: number; platformFee: number; providerFee: number; providerFeeCollectedBy: string;
  payoutInstructionAmount: number; expectedDelivered: number; senderMsisdn: string; recipientMsisdn: string;
  cancelRequestedAt?: string | null; cancelReason?: string | null;
  acceptedTerms: { pricingRuleVersion: number; providerFeeRuleVersion: number | null; acceptedAt: string; quote: { calculationMethod: string; conversionRatePpm: number; assumptions: string[] } };
  service: { code: string; name: string; sourceAsset: string; destinationAsset: string; processingMethod: string };
  manualVerification: { id: string; status: string } | null;
  history: Array<{ id: string; fromState: string | null; toState: string; actorType: string; reason: string | null; createdAt: string }>;
  operations: Array<{ id: string; kind: string; status: string; amount: number; providerCode: string; providerReference: string | null; idempotencyKey: string; statusChecks: number; failureReason: string | null; createdAt: string }>;
  journals: Array<{ id: string; kind: string; book: string; memo: string; createdAt: string; entries: Array<{ id: string; debit: number; credit: number; account: { code: string } }> }>;
  refunds: Array<{ id: string; amount: number; status: string; reason: string; createdAt: string; kind?: string; feeRetained?: number }>;
}

export default async function TransactionDetail(props: PageProps<'/transactions/[id]'>) {
  const { t, locale } = await getT();
  const { id } = await props.params;
  const [d, staff] = await Promise.all([load<Detail>(`/admin/transactions/${id}`), getStaff()]);
  const rate = d.acceptedTerms?.quote?.conversionRatePpm ?? 1_000_000;
  const refundable = ['FAILED', 'UNDER_REVIEW'].includes(d.state) && can(staff, 'REFUND_REQUEST');

  return (
    <>
      <PageHead back={{ href: '/transactions', label: t('txn.back') }} title={d.reference} sub={<>{d.service.name} <SimTag on={d.isSimulated} /></>}>
        <Badge value={d.state} label={stateLabel(t, d.state)} />
      </PageHead>

      {d.cancelRequestedAt && (
        <p className="note" role="status">{t('txn.cancelAsked', { at: when(d.cancelRequestedAt, locale), reason: d.cancelReason || '—' })}</p>
      )}

      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <h2>{t('txn.terms')}</h2>
            <KV
              rows={[
                [t('quote.amount'), fcfa(d.amount)],
                [t('txns.customerPays'), fcfa(d.customerPays)],
                [t('quote.platformFee'), fcfa(d.platformFee)],
                [t('quote.providerFee'), `${fcfa(d.providerFee)} (${d.providerFeeCollectedBy === 'PLATFORM' ? t('pfees.byAmico') : t('pfees.byOperator')})`],
                ...(rate !== 1_000_000 ? [[t('txn.rate'), `${(rate / 10_000).toFixed(2)}%`] as [string, string]] : []),
                [t('txn.payout'), fcfa(d.payoutInstructionAmount)],
                [t('txn.receives'), t('txn.receivesIn', { amount: fcfa(d.expectedDelivered), asset: ASSET_LABEL[d.service.destinationAsset] ?? '' })],
                [t('txn.from'), phone(d.senderMsisdn)],
                [t('txn.to'), phone(d.recipientMsisdn)],
                [t('txn.rule'), `v${d.acceptedTerms.pricingRuleVersion}${d.acceptedTerms.providerFeeRuleVersion ? ` · ${t('txn.opRule', { v: d.acceptedTerms.providerFeeRuleVersion })}` : ''}`],
                [t('txn.accepted'), when(d.acceptedTerms.acceptedAt, locale)],
                [t('txn.risk'), d.riskLevel === 'HIGH' ? <span key="r" className="risk-high">{t('txns.highValue')}</span> : t('txn.normal')],
              ]}
            />
            <p className="muted small" style={{ marginBottom: 0 }}>{d.acceptedTerms.quote.calculationMethod}</p>
          </section>

          <section className="card">
            <h2>{t('txn.operations')}</h2>
            {d.operations.length === 0 ? (
              <p className="muted">{t('txn.noOps')}</p>
            ) : (
              <div className="table-wrap flat">
                <table className="t">
                  <thead>
                    <tr><th>{t('txn.kind')}</th><th>{t('pricing.status')}</th><th className="num">{t('quote.amount')}</th><th>{t('txn.providerRef')}</th><th>{t('txn.checks')}</th></tr>
                  </thead>
                  <tbody>
                    {d.operations.map((o) => (
                      <tr key={o.id}>
                        <td>{o.kind}<div className="sub mono">{o.idempotencyKey.split(':').slice(1).join(':')}</div></td>
                        <td><Badge value={o.status === 'SUCCEEDED' ? 'COMPLETED' : o.status} label={o.status} />{o.failureReason && <div className="sub">{o.failureReason}</div>}</td>
                        <td className="num">{fcfa(o.amount)}</td>
                        <td className="mono">{o.providerReference ?? '—'}</td>
                        <td>{o.statusChecks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>{t('txn.ledger')}</h2>
            {d.journals.length === 0 ? (
              <p className="muted">{t('txn.noLedger')}</p>
            ) : (
              d.journals.map((j) => (
                <div key={j.id} style={{ marginBottom: 12 }}>
                  <strong>{j.kind}</strong> <span className="muted small">{j.book === 'REAL' ? t('reports.realBook') : t('reports.simBook')}, {when(j.createdAt, locale)}</span>
                  <table className="t">
                    <thead><tr><th>{t('reports.account')}</th><th className="num">{t('txn.debit')}</th><th className="num">{t('txn.credit')}</th></tr></thead>
                    <tbody>
                      {j.entries.map((e) => (
                        <tr key={e.id}>
                          <td className="mono">{e.account.code}</td>
                          <td className="num">{e.debit ? num(e.debit) : ''}</td>
                          <td className="num">{e.credit ? num(e.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </section>
        </div>

        <div className="stack">
          {d.manualVerification && (
            <p className="note info">
              {t('txn.airtimeCheck')} <Badge value={d.manualVerification.status} label={stateLabel(t, d.manualVerification.status)} />{' '}
              <Link href={`/verifications/${d.manualVerification.id}`}>{t('txn.openCheck')}</Link>
            </p>
          )}

          {refundable && d.refunds.every((r) => !['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status)) && (
            <section className="card">
              <h2>{t('txn.requestRefund')}</h2>
              <p className="muted small" style={{ marginTop: 0 }}>{t('txn.refundHelp')}</p>
              <ActionForm
                path={`admin/transactions/${d.id}/refunds`}
                fields={[
                  { name: 'amount', label: t('txn.refundAmount', { full: fcfa(d.customerPays) }), kind: 'fcfa' },
                  { name: 'reason', label: t('common.reason'), kind: 'textarea', required: true },
                ]}
                submit={t('txn.requestRefund')}
                done={t('txn.refundRequested')}
              />
            </section>
          )}

          {d.refunds.length > 0 && (
            <section className="card">
              <h2>{t('nav.refunds')}</h2>
              {d.refunds.map((r) => (
                <p key={r.id} style={{ margin: '0 0 6px' }}>
                  <Badge value={r.status} label={stateLabel(t, r.status)} /> {fcfa(r.amount)}
                  {r.feeRetained ? <span className="muted small"> ({t('refunds.feeKept', { fee: fcfa(r.feeRetained) })})</span> : null}{' '}
                  <span className="muted small">{r.reason}</span> <Link href="/refunds">{t('txn.manage')}</Link>
                </p>
              ))}
            </section>
          )}

          <section className="card">
            <h2>{t('txn.history')}</h2>
            <ol className="timeline">
              {d.history.map((h) => (
                <li key={h.id}>
                  <span className="when">{when(h.createdAt, locale)}</span>
                  <span>
                    <Badge value={h.toState} label={stateLabel(t, h.toState)} /> <span className="why">{t(`actor.${h.actorType}` as 'actor.STAFF')}: {h.reason}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
