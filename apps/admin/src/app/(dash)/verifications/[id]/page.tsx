import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { RevealNumber } from '@/components/RevealNumber';
import { Badge, KV, PageHead, SimTag } from '@/components/ui';
import { ASSET_LABEL, fcfa, phone, pretty, when } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Airtime check' };

interface Detail {
  id: string;
  status: string;
  version: number;
  expectedAmount: number;
  receivingSimId: string;
  customerReference: string | null;
  evidenceFileIds: string[];
  submittedAt: string | null;
  requiresDualApproval: boolean;
  receivedAmount: number | null;
  evidenceNote: string | null;
  reason: string | null;
  firstReviewerId: string | null;
  firstReviewedAt: string | null;
  secondApproverId: string | null;
  secondApprovedAt: string | null;
  receivingSim: { code: string; label: string; operator: string; msisdnMasked: string };
  transaction: {
    id: string; reference: string; state: string; isSimulated: boolean; senderMsisdn: string; recipientMsisdn: string;
    customerPays: number; expectedDelivered: number; riskLevel: string; createdAt: string;
    service: { name: string; sourceAsset: string; destinationAsset: string };
    history: Array<{ id: string; toState: string; reason: string | null; actorType: string; createdAt: string }>;
  };
  audit: Array<{ id: string; action: string; actorId: string | null; createdAt: string; after: unknown }>;
}

export default async function VerificationDetail(props: PageProps<'/verifications/[id]'>) {
  const { id } = await props.params;
  const [v, staff] = await Promise.all([load<Detail>(`/admin/verifications/${id}`), getStaff()]);
  const t = v.transaction;
  const open = ['PENDING', 'ON_HOLD', 'ESCALATED'].includes(v.status);
  const secondStep = v.status === 'AWAITING_SECOND_APPROVAL';
  const iAmFirst = v.firstReviewerId === staff.id;
  const at = (p: string) => `admin/verifications/${v.id}/${p}?version=${v.version}`;

  return (
    <>
      <PageHead
        back={{ href: '/verifications', label: 'Back to airtime checks' }}
        title={`Check ${t.reference}`}
        sub={<>{t.service.name} <SimTag on={t.isSimulated} /></>}
      >
        <Badge value={v.status} />
      </PageHead>

      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <h2>What to look for on the SIM</h2>
            <div className="big-amount">{fcfa(v.expectedAmount)}</div>
            <p style={{ margin: '4px 0 14px', color: 'var(--muted)' }}>
              of {ASSET_LABEL[t.service.sourceAsset]} from <strong>{phone(t.senderMsisdn)}</strong>, received on {v.receivingSim.label}
            </p>
            <KV
              rows={[
                ['Receiving SIM', can(staff, 'SIM_READ_FULL') ? <RevealNumber simId={v.receivingSimId} masked={v.receivingSim.msisdnMasked} defaultReason={`Verifying airtime for ${t.reference}`} /> : <span className="mono">{v.receivingSim.msisdnMasked}</span>],
                ['Customer’s SMS reference', <span className="mono" key="r">{v.customerReference ?? '—'}</span>],
                ['Submitted', when(v.submittedAt)],
                ['Approval', v.requiresDualApproval ? <span className="risk-high" key="d">Two different approvers required</span> : 'One approver'],
              ]}
            />
            {v.evidenceFileIds.length > 0 && (
              <div className="evidence" style={{ marginTop: 14 }}>
                <h2>Customer’s screenshot</h2>
                <p className="note" style={{ marginTop: 0 }}>Supporting material only. Check the SIM itself before confirming.</p>
                {v.evidenceFileIds.map((f) => (
                  <a key={f} href={`/api/proxy/admin/verifications/evidence/${f}`} target="_blank" rel="noreferrer">
                    <img src={`/api/proxy/admin/verifications/evidence/${f}`} alt="Customer evidence" />
                  </a>
                ))}
              </div>
            )}
          </section>

          {(v.receivedAmount !== null || v.reason) && (
            <section className="card">
              <h2>Recorded so far</h2>
              <KV
                rows={[
                  ['Amount seen on SIM', fcfa(v.receivedAmount)],
                  ['Evidence note', v.evidenceNote ?? '—'],
                  ['Reason', v.reason ?? '—'],
                  ['First review', v.firstReviewedAt ? `${when(v.firstReviewedAt)}${iAmFirst ? ' (you)' : ''}` : '—'],
                  ['Second approval', v.secondApprovedAt ? when(v.secondApprovedAt) : '—'],
                ]}
              />
            </section>
          )}

          <section className="card">
            <h2>Transaction</h2>
            <KV
              rows={[
                ['State', <Badge key="s" value={t.state} />],
                ['Customer pays', fcfa(t.customerPays)],
                ['Recipient receives', `${fcfa(t.expectedDelivered)} in ${ASSET_LABEL[t.service.destinationAsset]}`],
                ['Recipient', phone(t.recipientMsisdn)],
                ['Details', <Link key="l" href={`/transactions/${t.id}`}>Open transaction</Link>],
              ]}
            />
          </section>
        </div>

        <div className="stack">
          {open && can(staff, 'VERIFY_MANUAL') && (
            <>
              <section className="card">
                <h2>Airtime received</h2>
                {v.status !== 'PENDING' && <p className="note">This check is {pretty(v.status).toLowerCase()}. Confirm only once the issue is resolved.</p>}
                <ActionForm
                  path={at('decision')}
                  fixed={{ decision: 'CONFIRM_RECEIVED' }}
                  fields={[
                    { name: 'receivedAmount', label: 'Amount you see on the SIM (FCFA)', kind: 'fcfa', required: true, hint: 'Type what the SIM shows, not the expected amount. A different amount puts the transaction on hold.' },
                    { name: 'evidenceNote', label: 'What you checked', kind: 'textarea', required: true, placeholder: 'e.g. Balance SMS 09:42 from 6 51 23 45 67, +5 000 FCFA' },
                  ]}
                  submit={v.requiresDualApproval ? 'Record first approval' : 'Confirm and pay out'}
                  done="Recorded."
                />
              </section>
              <section className="card">
                <h2>Not received</h2>
                <ActionForm
                  path={at('decision')}
                  fixed={{ decision: 'NOT_RECEIVED' }}
                  fields={[{ name: 'reason', label: 'Reason (the customer is told the transfer wasn’t found)', kind: 'textarea', required: true }]}
                  submit="Reject transfer"
                  variant="danger"
                  confirm="Reject this transfer? The customer will be told we could not find it."
                />
              </section>
              {v.status !== 'ESCALATED' && (
                <section className="card">
                  <h2>Escalate</h2>
                  <ActionForm
                    path={at('decision')}
                    fixed={{ decision: 'ESCALATE' }}
                    fields={[{ name: 'reason', label: 'What needs a closer look', kind: 'textarea', required: true }]}
                    submit="Escalate to review"
                    variant="quiet"
                  />
                </section>
              )}
            </>
          )}

          {secondStep && (
            <section className="card">
              <h2>Second approval</h2>
              {iAmFirst ? (
                <p className="note">You recorded the first approval. A different colleague must check the SIM and approve.</p>
              ) : can(staff, 'VERIFY_SECOND_APPROVAL') ? (
                <ActionForm
                  path={at('second-approval')}
                  fields={[
                    { name: 'receivedAmount', label: 'Amount you see on the SIM (FCFA)', kind: 'fcfa', required: true, hint: 'Check the SIM yourself. If it differs from the first approver, the transaction goes on hold.' },
                    { name: 'evidenceNote', label: 'What you checked', kind: 'textarea', required: true },
                  ]}
                  submit="Approve and pay out"
                />
              ) : (
                <p className="note">You don’t have permission to give the second approval.</p>
              )}
            </section>
          )}

          {!open && !secondStep && <p className="note info">This check is closed. No further action is possible here.</p>}

          <section className="card">
            <h2>History</h2>
            <ol className="timeline">
              {t.history.map((h) => (
                <li key={h.id}>
                  <span className="when">{when(h.createdAt)}</span>
                  <span>
                    <Badge value={h.toState} /> <span className="why">{h.reason}</span>
                  </span>
                </li>
              ))}
              {v.audit.map((a) => (
                <li key={a.id}>
                  <span className="when">{when(a.createdAt)}</span>
                  <span className="why">{pretty(a.action.replace('verification.', ''))}{a.actorId === staff.id ? ' (you)' : ''}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
