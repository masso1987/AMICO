'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { pick, type MessageKey } from '@/i18n/core';
import { callApi, ClientApiError } from '@/lib/client';
import { errorText } from '@/lib/errors';
import { dateTime, fcfa, kindOf, phone, STATE_TONE, stepOf, TERMINAL } from '@/lib/format';
import { percent } from '@/lib/products';
import { Icon } from './Icon';

export interface Txn {
  id: string;
  reference: string;
  simulated: boolean;
  state: string;
  service: { code: string; name: string; sourceAsset: string; destinationAsset: string };
  group: string;
  bundle: { name: string; nameFr: string; validityDays: number | null } | null;
  cancellation: { requested: boolean; requestedAt: string | null; possible: boolean; fee: number; feeBps: number };
  refunds: { id: string; amount: number; feeRetained: number; kind: string; status: string; createdAt: string }[];
  conversionRate: number | null;
  amount: number;
  customerPays: number;
  platformFee: number;
  providerFee: number;
  expectedDelivered: number;
  recipient: string;
  paymentInstructions:
    | { method: 'MANUAL_AIRTIME_TRANSFER'; sendTo: string; operator: 'MTN' | 'ORANGE'; amount: number }
    | { method: 'PROVIDER_PAYMENT_PROMPT'; amount: number }
    | null;
  manualVerification: { status: string; customerReference: string | null; submittedAt: string | null } | null;
  timeline: { toState: string; reason: string | null; createdAt: string }[];
  receipt: { reference: string; delivered: number; to: string; platformFee: number; providerFee: number; completedAt: string; simulated: boolean } | null;
  createdAt: string;
}

export function TransactionView({ initial }: { initial: Txn }) {
  const { t, locale } = useI18n();
  const [txn, setTxn] = useState(initial);

  const refresh = useCallback(async () => {
    try {
      setTxn(await callApi<Txn>(`transactions/${initial.id}`));
    } catch {
      /* keep the last good view; the next tick retries */
    }
  }, [initial.id]);

  useEffect(() => {
    const manualWaiting = txn.state === 'AWAITING_SOURCE_PAYMENT' && txn.paymentInstructions?.method === 'MANUAL_AIRTIME_TRANSFER';
    if (TERMINAL.includes(txn.state) || manualWaiting) return;
    const slow = ['AWAITING_MANUAL_VERIFICATION', 'UNDER_REVIEW', 'REFUND_PENDING', 'FAILED'].includes(txn.state);
    const id = setInterval(refresh, slow ? 10_000 : 3_000);
    return () => clearInterval(id);
  }, [txn.state, txn.paymentInstructions, refresh]);

  const tone = STATE_TONE[txn.state] ?? 'wait';
  const airtime = kindOf(txn.service.sourceAsset) === 'airtime';
  const step = stepOf(txn.state);
  const what = txn.bundle ? pick(locale, txn.bundle.name, txn.bundle.nameFr) : t(`group.${txn.group}` as MessageKey);
  const cancelledNote = txn.cancellation.requested && !TERMINAL.includes(txn.state);

  return (
    <div className={txn.receipt ? '' : 'grid-2'}>
      <div className="stack">
        <div>
          <span className="eyebrow">{what}</span>
          <div className={`status tone-${tone}`} style={{ marginTop: 6 }}>
            <span className="status-dot" aria-hidden />
            <h1 className="page-title" style={{ margin: 0 }}>
              {t(`state.${txn.state}` as MessageKey)}
            </h1>
          </div>
          <p className="muted">
            {t('txn.reference')} <strong className="money" style={{ color: 'var(--ink)' }}>{txn.reference}</strong>
            {txn.simulated && <span className="sim-tag">{t('common.simulation')}</span>}
          </p>
        </div>

        {!['REJECTED', 'REFUNDED', 'COMPLETED'].includes(txn.state) && (
          <div>
            <div className="steps-bar" aria-hidden>
              <span className={step >= 1 ? 'on' : ''} />
              <span className={step >= 2 ? 'on' : ''} />
              <span className={step >= 3 ? 'on' : ''} />
            </div>
            <div className="steps-labels">
              <span>{airtime ? t('steps.transfer') : t('steps.pay')}</span>
              <span>{t('steps.check')}</span>
              <span>{t('steps.deliver')}</span>
            </div>
          </div>
        )}

        {cancelledNote && (
          <div className="alert alert-info" role="status">
            {t('txn.cancelRequested', { fee: fcfa(txn.cancellation.fee), refund: fcfa(Math.max(0, txn.customerPays - txn.cancellation.fee)) })}
          </div>
        )}

        <StateMessage txn={txn} />

        {txn.paymentInstructions?.method === 'MANUAL_AIRTIME_TRANSFER' && txn.state === 'AWAITING_SOURCE_PAYMENT' && <ManualPayment txn={txn} onSubmitted={setTxn} />}

        {txn.receipt && <Receipt txn={txn} airtime={airtime} />}

        {txn.refunds.length > 0 && (
          <section className="panel" aria-labelledby="refunds-title">
            <h2 id="refunds-title" style={{ fontSize: 17, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Icon name="refund" size={20} /> {t('txn.refunds')}
            </h2>
            <ul className="list">
              {txn.refunds.map((r) => (
                <li key={r.id} style={{ padding: '10px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>
                      {t(`refund.kind.${r.kind}` as MessageKey)}
                      <span className="sub muted" style={{ display: 'block', fontSize: 13 }}>
                        {t(`refund.status.${r.status}` as MessageKey)} · {dateTime(r.createdAt, locale)}
                      </span>
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <strong className="money">{fcfa(r.amount)}</strong>
                      {r.feeRetained > 0 && (
                        <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                          {t('refund.feeKept', { fee: fcfa(r.feeRetained) })}
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="progress">
          <h2 id="progress" style={{ fontSize: 17, marginBottom: 14 }}>
            {t('txn.progress')}
          </h2>
          <ol className="timeline">
            {txn.timeline
              .filter((h) => h.toState !== 'CREATED')
              .map((h, i) => (
                <li key={`${h.toState}-${i}`}>
                  <div>{t(`history.${h.toState}` as MessageKey)}</div>
                  <div className="when">{dateTime(h.createdAt, locale)}</div>
                </li>
              ))}
          </ol>
        </section>

        {txn.cancellation.possible && <CancelBox txn={txn} onDone={setTxn} />}
      </div>

      {!txn.receipt && (
        <aside className="panel sticky" aria-label={t('txn.summary')}>
          <dl className="kv">
            {txn.bundle && (
              <>
                <dt>{t('quote.bundle')}</dt>
                <dd>{pick(locale, txn.bundle.name, txn.bundle.nameFr)}</dd>
              </>
            )}
            <dt>{airtime ? t('quote.youTransfer') : t('quote.youPay')}</dt>
            <dd className="money">{fcfa(txn.customerPays)}</dd>
            {txn.conversionRate !== null && (
              <>
                <dt>{t('quote.rate')}</dt>
                <dd>{Math.round(txn.conversionRate * 10000) / 100}%</dd>
              </>
            )}
            <dt>{t('quote.platformFee')}</dt>
            <dd className="money">{fcfa(txn.platformFee)}</dd>
            <dt>{t('quote.providerFee')}</dt>
            <dd className="money">{fcfa(txn.providerFee)}</dd>
            <dt>{t('quote.recipientNumber')}</dt>
            <dd>{phone(txn.recipient)}</dd>
            {!txn.bundle && (
              <>
                <dt>{t(`quote.receives.${kindOf(txn.service.destinationAsset)}` as MessageKey)}</dt>
                <dd className="money gold">{fcfa(txn.expectedDelivered)}</dd>
              </>
            )}
          </dl>
          <p className="hint" style={{ marginTop: 16 }}>
            {t('txn.termsFixed')}
          </p>
        </aside>
      )}
    </div>
  );
}

function StateMessage({ txn }: { txn: Txn }) {
  const { t } = useI18n();
  if (txn.state === 'AWAITING_SOURCE_PAYMENT' && txn.paymentInstructions?.method === 'PROVIDER_PAYMENT_PROMPT') {
    return <div className="alert alert-info">{t('txn.approvePrompt', { amount: fcfa(txn.paymentInstructions.amount) })}</div>;
  }
  const key = `statemsg.${txn.state}` as MessageKey;
  const text = t(key);
  return text !== key ? <p style={{ maxWidth: '62ch', color: 'var(--ink-2)' }}>{text}</p> : null;
}

function CancelBox({ txn, onDone }: { txn: Txn; onDone: (t: Txn) => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const free = txn.cancellation.fee === 0;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      onDone(await callApi<Txn>(`transactions/${txn.id}/cancel`, { method: 'POST', body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}) }));
      setOpen(false);
    } catch (e) {
      setError(errorText(e, t, locale));
      if (e instanceof ClientApiError && ['TOO_LATE_TO_CANCEL', 'CANNOT_CANCEL'].includes(e.code)) {
        callApi<Txn>(`transactions/${txn.id}`).then(onDone).catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="no-print">
        <button type="button" className="btn btn-danger btn-sm" onClick={() => setOpen(true)}>
          {t('cancel.open')}
        </button>
      </div>
    );
  }

  return (
    <section className="panel no-print" aria-labelledby="cancel-title" style={{ borderColor: 'rgba(255,107,107,.45)' }}>
      <h2 id="cancel-title" style={{ fontSize: 18, marginBottom: 8 }}>
        {t('cancel.title')}
      </h2>
      <p style={{ color: 'var(--ink-2)', marginBottom: 14 }}>
        {free
          ? t('cancel.free')
          : t('cancel.withFee', {
              pct: percent(txn.cancellation.feeBps, locale),
              fee: fcfa(txn.cancellation.fee),
              refund: fcfa(Math.max(0, txn.customerPays - txn.cancellation.fee)),
            })}
      </p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="cancel-reason">{t('cancel.reason')}</label>
        <input className="input" id="cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-danger" onClick={cancel} disabled={busy}>
          {busy ? t('common.wait') : t('cancel.confirm')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} disabled={busy}>
          {t('cancel.keep')}
        </button>
      </div>
    </section>
  );
}

function ManualPayment({ txn, onSubmitted }: { txn: Txn; onSubmitted: (t: Txn) => void }) {
  const { t, locale } = useI18n();
  const p = txn.paymentInstructions as Extract<Txn['paymentInstructions'], { method: 'MANUAL_AIRTIME_TRANSFER' }>;
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(p.sendTo.replace(/^237/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the number stays visible */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (reference.trim().length < 3) return setError(t('manual.err.reference'));
    setBusy(true);
    try {
      const evidenceFileIds: string[] = [];
      if (file) {
        const form = new FormData();
        form.append('file', file);
        const up = await callApi<{ id: string }>('evidence', { method: 'POST', body: form });
        evidenceFileIds.push(up.id);
      }
      onSubmitted(
        await callApi<Txn>(`transactions/${txn.id}/source-reference`, {
          method: 'POST',
          body: JSON.stringify({ customerReference: reference.trim(), evidenceFileIds }),
        }),
      );
    } catch (err) {
      setError(errorText(err, t, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pay-box" aria-labelledby="pay-title">
      <h2 id="pay-title" style={{ fontSize: 18 }}>
        {t('manual.title', { amount: fcfa(p.amount), network: t(`op.${p.operator}` as MessageKey) })}
      </h2>
      <div className="big-number">
        <span className={`op op-${p.operator}`}>{phone(p.sendTo)}</span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={copyNumber}>
          <Icon name={copied ? 'check' : 'copy'} size={18} /> {copied ? t('manual.copied') : t('manual.copy')}
        </button>
      </div>
      <ol className="ol">
        <li>{t('manual.step1')}</li>
        <li>{t('manual.step2', { amount: fcfa(p.amount) })}</li>
        <li>{t('manual.step3')}</li>
      </ol>

      <form onSubmit={submit} style={{ marginTop: 20 }} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="ref">{t('manual.reference')}</label>
          <input className="input" id="ref" value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="proof">{t('manual.proof')}</label>
          <input id="proof" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="hint">{t('manual.proofHint')}</span>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? t('common.wait') : t('manual.submit')}
        </button>
      </form>
    </section>
  );
}

function Receipt({ txn, airtime }: { txn: Txn; airtime: boolean }) {
  const { t, locale } = useI18n();
  const r = txn.receipt!;
  return (
    <section className="quote" aria-labelledby="receipt-title" style={{ maxWidth: 560 }}>
      <div className="quote-head">
        <h2 id="receipt-title">{t('receipt.title')}</h2>
        <span className="quote-kind">
          {r.reference}
          {r.simulated ? (
            <>
              <br />
              {t('common.simulation')}
            </>
          ) : null}
        </span>
      </div>
      <dl>
        <dt>{t('receipt.service')}</dt>
        <dd>{txn.bundle ? pick(locale, txn.bundle.name, txn.bundle.nameFr) : t(`group.${txn.group}` as MessageKey)}</dd>
        <dt>{t('receipt.to')}</dt>
        <dd>{phone(r.to)}</dd>
        <dt>{t('receipt.completed')}</dt>
        <dd>{dateTime(r.completedAt, locale)}</dd>
      </dl>
      <hr />
      <dl>
        <dt>{airtime ? t('quote.youTransfer') : t('quote.youPay')}</dt>
        <dd>{fcfa(txn.customerPays)}</dd>
        {txn.conversionRate !== null && (
          <>
            <dt>{t('quote.rate')}</dt>
            <dd>{Math.round(txn.conversionRate * 10000) / 100}%</dd>
          </>
        )}
        <dt>{t('quote.platformFee')}</dt>
        <dd>{fcfa(r.platformFee)}</dd>
        <dt>{t('quote.providerFee')}</dt>
        <dd>{fcfa(r.providerFee)}</dd>
      </dl>
      <div className="receive">
        <div className="label">{t('receipt.delivered')}</div>
        <div className={`value money${txn.bundle ? " text" : ""}`}>{txn.bundle ? pick(locale, txn.bundle.name, txn.bundle.nameFr) : fcfa(r.delivered)}</div>
      </div>
      <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
        <button className="btn btn-quiet" onClick={() => window.print()}>
          {t('receipt.print')}
        </button>
        <Link href="/app" className="btn btn-primary">
          {t('receipt.again')}
        </Link>
      </div>
    </section>
  );
}
