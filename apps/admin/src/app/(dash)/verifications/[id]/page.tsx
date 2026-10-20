import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { RevealNumber } from '@/components/RevealNumber';
import { Badge, KV, PageHead, SimTag } from '@/components/ui';
import { getT } from '@/i18n/server';
import { ASSET_LABEL, fcfa, phone, pretty, when } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('verif.title') };
}

interface Detail {
  id: string; status: string; version: number; expectedAmount: number; receivingSimId: string; customerReference: string | null; evidenceFileIds: string[];
  submittedAt: string | null; requiresDualApproval: boolean; receivedAmount: number | null; evidenceNote: string | null; reason: string | null;
  firstReviewerId: string | null; firstReviewedAt: string | null; secondApproverId: string | null; secondApprovedAt: string | null;
  receivingSim: { code: string; label: string; operator: string; msisdnMasked: string };
  transaction: {
    id: string; reference: string; state: string; isSimulated: boolean; senderMsisdn: string; recipientMsisdn: string;
    customerPays: number; expectedDelivered: number; riskLevel: string; createdAt: string; cancelRequestedAt?: string | null;
    service: { name: string; sourceAsset: string; destinationAsset: string };
    history: Array<{ id: string; toState: string; reason: string | null; actorType: string; createdAt: string }>;
  };
  audit: Array<{ id: string; action: string; actorId: string | null; createdAt: string; after: unknown }>;
}

export default async function VerificationDetail(props: PageProps<'/verifications/[id]'>) {
  const { t, locale } = await getT();
  const { id } = await props.params;
  const [v, staff] = await Promise.all([load<Detail>(`/admin/verifications/${id}`), getStaff()]);
  const x = v.transaction;
  const open = ['PENDING', 'ON_HOLD', 'ESCALATED'].includes(v.status);
  const secondStep = v.status === 'AWAITING_SECOND_APPROVAL';
  const iAmFirst = v.firstReviewerId === staff.id;
  const at = (p: string) => `admin/verifications/${v.id}/${p}?version=${v.version}`;

  return (
    <>
      <PageHead back={{ href: '/verifications', label: t('verif.back') }} title={t('verif.heading', { ref: x.reference })} sub={<>{x.service.name} <SimTag on={x.isSimulated} /></>}>
        <Badge value={v.status} label={stateLabel(t, v.status)} />
      </PageHead>
      {x.cancelRequestedAt && <p className="note" role="status">{t('verif.cancelAsked')}</p>}

      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <h2>{t('verif.lookFor')}</h2>
            <div className="big-amount">{fcfa(v.expectedAmount)}</div>
            <p className="muted" style={{ margin: '4px 0 14px' }}>
              {t('verif.ofFrom', { asset: ASSET_LABEL[x.service.sourceAsset] ?? '', from: phone(x.senderMsisdn), sim: v.receivingSim.label })}
            </p>
            <KV
              rows={[
                [t('verif.sim'), can(staff, 'SIM_READ_FULL') ? <RevealNumber simId={v.receivingSimId} masked={v.receivingSim.msisdnMasked} defaultReason={`Verifying airtime for ${x.reference}`} /> : <span className="mono">{v.receivingSim.msisdnMasked}</span>],
                [t('verifs.smsRef'), <span className="mono" key="r">{v.customerReference ?? '—'}</span>],
                [t('verif.submitted'), when(v.submittedAt, locale)],
                [t('verif.approval'), v.requiresDualApproval ? <span className="risk-high" key="d">{t('verif.dual')}</span> : t('verif.single')],
              ]}
            />
            {v.evidenceFileIds.length > 0 && (
              <div className="evidence" style={{ marginTop: 14 }}>
                <h2>{t('verif.screenshot')}</h2>
                <p className="note" style={{ marginTop: 0 }}>{t('verif.screenshotNote')}</p>
                {v.evidenceFileIds.map((f) => (
                  <a key={f} href={`/api/proxy/admin/verifications/evidence/${f}`} target="_blank" rel="noreferrer">
                    <img src={`/api/proxy/admin/verifications/evidence/${f}`} alt={t('verif.screenshot')} />
                  </a>
                ))}
              </div>
            )}
          </section>

          {(v.receivedAmount !== null || v.reason) && (
            <section className="card">
              <h2>{t('verif.recorded')}</h2>
              <KV
                rows={[
                  [t('verif.seen'), fcfa(v.receivedAmount)],
                  [t('verif.note'), v.evidenceNote ?? '—'],
                  [t('common.reason'), v.reason ?? '—'],
                  [t('verif.first'), v.firstReviewedAt ? `${when(v.firstReviewedAt, locale)}${iAmFirst ? ` (${t('staff.you')})` : ''}` : '—'],
                  [t('verif.secondApproval'), v.secondApprovedAt ? when(v.secondApprovedAt, locale) : '—'],
                ]}
              />
            </section>
          )}

          <section className="card">
            <h2>{t('txn.title')}</h2>
            <KV
              rows={[
                [t('pricing.status'), <Badge key="s" value={x.state} label={stateLabel(t, x.state)} />],
                [t('txns.customerPays'), fcfa(x.customerPays)],
                [t('txn.receives'), t('txn.receivesIn', { amount: fcfa(x.expectedDelivered), asset: ASSET_LABEL[x.service.destinationAsset] ?? '' })],
                [t('txn.to'), phone(x.recipientMsisdn)],
                [t('verif.details'), <Link key="l" href={`/transactions/${x.id}`}>{t('verif.openTxn')}</Link>],
              ]}
            />
          </section>
        </div>

        <div className="stack">
          {open && can(staff, 'VERIFY_MANUAL') && (
            <>
              <section className="card">
                <h2>{t('verif.received')}</h2>
                {v.status !== 'PENDING' && <p className="note">{t('verif.notPending', { status: stateLabel(t, v.status).toLowerCase() })}</p>}
                <ActionForm
                  path={at('decision')}
                  fixed={{ decision: 'CONFIRM_RECEIVED' }}
                  fields={[
                    { name: 'receivedAmount', label: t('verif.amountSeen'), kind: 'fcfa', required: true, hint: t('verif.amountSeenHint') },
                    { name: 'evidenceNote', label: t('verif.whatChecked'), kind: 'textarea', required: true, placeholder: t('verif.whatCheckedExample') },
                  ]}
                  submit={v.requiresDualApproval ? t('verif.recordFirst') : t('verif.confirmPay')}
                  done={t('common.saved')}
                />
              </section>
              <section className="card">
                <h2>{t('verif.notReceived')}</h2>
                <ActionForm
                  path={at('decision')}
                  fixed={{ decision: 'NOT_RECEIVED' }}
                  fields={[{ name: 'reason', label: t('verif.rejectReason'), kind: 'textarea', required: true }]}
                  submit={t('verif.reject')}
                  variant="danger"
                  confirm={t('verif.rejectConfirm')}
                />
              </section>
              {v.status !== 'ESCALATED' && (
                <section className="card">
                  <h2>{t('verif.escalate')}</h2>
                  <ActionForm
                    path={at('decision')}
                    fixed={{ decision: 'ESCALATE' }}
                    fields={[{ name: 'reason', label: t('verif.escalateReason'), kind: 'textarea', required: true }]}
                    submit={t('verif.escalateSubmit')}
                    variant="quiet"
                  />
                </section>
              )}
            </>
          )}

          {secondStep && (
            <section className="card">
              <h2>{t('verif.secondApproval')}</h2>
              {iAmFirst ? (
                <p className="note">{t('verif.youWereFirst')}</p>
              ) : can(staff, 'VERIFY_SECOND_APPROVAL') ? (
                <ActionForm
                  path={at('second-approval')}
                  fields={[
                    { name: 'receivedAmount', label: t('verif.amountSeen'), kind: 'fcfa', required: true, hint: t('verif.secondHint') },
                    { name: 'evidenceNote', label: t('verif.whatChecked'), kind: 'textarea', required: true },
                  ]}
                  submit={t('verif.approvePay')}
                />
              ) : (
                <p className="note">{t('verif.noPermission')}</p>
              )}
            </section>
          )}

          {!open && !secondStep && <p className="note info">{t('verif.closed')}</p>}

          <section className="card">
            <h2>{t('txn.history')}</h2>
            <ol className="timeline">
              {x.history.map((h) => (
                <li key={h.id}>
                  <span className="when">{when(h.createdAt, locale)}</span>
                  <span>
                    <Badge value={h.toState} label={stateLabel(t, h.toState)} /> <span className="why">{h.reason}</span>
                  </span>
                </li>
              ))}
              {v.audit.map((a) => (
                <li key={a.id}>
                  <span className="when">{when(a.createdAt, locale)}</span>
                  <span className="why">{pretty(a.action.replace('verification.', ''))}{a.actorId === staff.id ? ` (${t('staff.you')})` : ''}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
