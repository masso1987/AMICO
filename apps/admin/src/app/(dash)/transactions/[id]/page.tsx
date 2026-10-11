import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { Badge, KV, PageHead, SimTag } from '@/components/ui';
import { ASSET_LABEL, fcfa, num, phone, when } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Transaction' };

interface Detail {
  id: string; reference: string; state: string; isSimulated: boolean; riskLevel: string; createdAt: string;
  amount: number; customerPays: number; platformFee: number; providerFee: number; providerFeeCollectedBy: string;
  payoutInstructionAmount: number; expectedDelivered: number; senderMsisdn: string; recipientMsisdn: string;
  acceptedTerms: { pricingRuleVersion: number; providerFeeRuleVersion: number | null; acceptedAt: string; quote: { calculationMethod: string; conversionRatePpm: number; assumptions: string[] } };
  service: { code: string; name: string; sourceAsset: string; destinationAsset: string; processingMethod: string };
  manualVerification: { id: string; status: string } | null;
  history: Array<{ id: string; fromState: string | null; toState: string; actorType: string; reason: string | null; createdAt: string }>;
  operations: Array<{ id: string; kind: string; status: string; amount: number; providerCode: string; providerReference: string | null; idempotencyKey: string; statusChecks: number; failureReason: string | null; createdAt: string }>;
  journals: Array<{ id: string; kind: string; book: string; memo: string; createdAt: string; entries: Array<{ id: string; debit: number; credit: number; account: { code: string } }> }>;
  refunds: Array<{ id: string; amount: number; status: string; reason: string; createdAt: string }>;
}

export default async function TransactionDetail(props: PageProps<'/transactions/[id]'>) {
  const { id } = await props.params;
  const [t, staff] = await Promise.all([load<Detail>(`/admin/transactions/${id}`), getStaff()]);
  const rate = t.acceptedTerms?.quote?.conversionRatePpm ?? 1_000_000;
  const refundable = ['FAILED', 'UNDER_REVIEW'].includes(t.state) && can(staff, 'REFUND_REQUEST');

  return (
    <>
      <PageHead back={{ href: '/transactions', label: 'Back to transactions' }} title={t.reference} sub={<>{t.service.name} <SimTag on={t.isSimulated} /></>}>
        <Badge value={t.state} />
      </PageHead>

      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <h2>Accepted terms</h2>
            <KV
              rows={[
                ['Amount', fcfa(t.amount)],
                ['Customer pays', fcfa(t.customerPays)],
                ['AMICO fee', fcfa(t.platformFee)],
                ['Operator fee', `${fcfa(t.providerFee)} (${t.providerFeeCollectedBy === 'PLATFORM' ? 'collected by AMICO' : 'deducted by operator'})`],
                ...(rate !== 1_000_000 ? [['Conversion rate', `${(rate / 10_000).toFixed(2)}%`] as [string, string]] : []),
                ['Payout instruction', fcfa(t.payoutInstructionAmount)],
                ['Recipient receives', `${fcfa(t.expectedDelivered)} in ${ASSET_LABEL[t.service.destinationAsset]}`],
                ['From', phone(t.senderMsisdn)],
                ['To', phone(t.recipientMsisdn)],
                ['Pricing rule', `v${t.acceptedTerms.pricingRuleVersion}${t.acceptedTerms.providerFeeRuleVersion ? `, operator fee rule v${t.acceptedTerms.providerFeeRuleVersion}` : ''}`],
                ['Accepted', when(t.acceptedTerms.acceptedAt)],
                ['Risk', t.riskLevel === 'HIGH' ? <span key="r" className="risk-high">High value</span> : 'Normal'],
              ]}
            />
            <p className="sub" style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 0 }}>{t.acceptedTerms.quote.calculationMethod}</p>
          </section>

          <section className="card">
            <h2>Provider operations</h2>
            {t.operations.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--muted)' }}>No provider calls yet.</p>
            ) : (
              <table className="t">
                <thead>
                  <tr><th>Kind</th><th>Status</th><th className="num">Amount</th><th>Provider ref</th><th>Checks</th></tr>
                </thead>
                <tbody>
                  {t.operations.map((o) => (
                    <tr key={o.id}>
                      <td>{o.kind}<div className="sub mono">{o.idempotencyKey.split(':').slice(1).join(':')}</div></td>
                      <td><Badge value={o.status} label={o.status} />{o.failureReason && <div className="sub">{o.failureReason}</div>}</td>
                      <td className="num">{fcfa(o.amount)}</td>
                      <td className="mono">{o.providerReference ?? '—'}</td>
                      <td>{o.statusChecks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <h2>Ledger</h2>
            {t.journals.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--muted)' }}>Nothing posted. Funds are posted when the source is verified.</p>
            ) : (
              t.journals.map((j) => (
                <div key={j.id} style={{ marginBottom: 12 }}>
                  <strong>{j.kind}</strong> <span className="sub" style={{ color: 'var(--muted)' }}>{j.book.toLowerCase()} book, {when(j.createdAt)}</span>
                  <table className="t">
                    <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
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
          {t.manualVerification && (
            <p className="note info">
              Airtime check: <Badge value={t.manualVerification.status} />{' '}
              <Link href={`/verifications/${t.manualVerification.id}`}>Open check</Link>
            </p>
          )}

          {refundable && t.refunds.every((r) => !['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status)) && (
            <section className="card">
              <h2>Request a refund</h2>
              <p className="sub" style={{ color: 'var(--muted)', marginTop: 0 }}>
                A second person must approve it. Refunds are blocked while a payout’s outcome is still uncertain.
              </p>
              <ActionForm
                path={`admin/transactions/${t.id}/refunds`}
                fields={[
                  { name: 'amount', label: `Amount (FCFA, leave empty for the full ${fcfa(t.customerPays)})`, kind: 'fcfa' },
                  { name: 'reason', label: 'Reason', kind: 'textarea', required: true },
                ]}
                submit="Request refund"
                done="Refund requested. It now needs approval."
              />
            </section>
          )}

          {t.refunds.length > 0 && (
            <section className="card">
              <h2>Refunds</h2>
              {t.refunds.map((r) => (
                <p key={r.id} style={{ margin: '0 0 6px' }}>
                  <Badge value={r.status} /> {fcfa(r.amount)} <span className="sub" style={{ color: 'var(--muted)' }}>{r.reason}</span>{' '}
                  <Link href="/refunds">Manage</Link>
                </p>
              ))}
            </section>
          )}

          <section className="card">
            <h2>State history</h2>
            <ol className="timeline">
              {t.history.map((h) => (
                <li key={h.id}>
                  <span className="when">{when(h.createdAt)}</span>
                  <span>
                    <Badge value={h.toState} /> <span className="why">{h.actorType.toLowerCase()}: {h.reason}</span>
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
