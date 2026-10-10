'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { callApi, ClientApiError } from '@/lib/client';
import { ASSETS, dateTime, fcfa, HISTORY_COPY, phone, STATE_COPY, TERMINAL } from '@/lib/format';

export interface Txn {
  id: string;
  reference: string;
  simulated: boolean;
  simulationNotice: string | null;
  state: string;
  service: { code: string; name: string; sourceAsset: string; destinationAsset: string };
  conversionRate: number | null;
  amount: number;
  customerPays: number;
  platformFee: number;
  providerFee: number;
  expectedDelivered: number;
  recipient: string;
  paymentInstructions:
    | { method: 'MANUAL_AIRTIME_TRANSFER'; sendTo: string; operator: string; amount: number; steps: string[] }
    | { method: 'PROVIDER_PAYMENT_PROMPT'; amount: number; steps: string[] }
    | null;
  manualVerification: { status: string; customerReference: string | null; submittedAt: string | null } | null;
  timeline: { toState: string; reason: string | null; createdAt: string }[];
  receipt: { reference: string; delivered: number; to: string; platformFee: number; providerFee: number; completedAt: string; simulated: boolean } | null;
  createdAt: string;
}

/** States where nothing changes until the customer acts — no need to poll. */
const WAITING_ON_CUSTOMER = ['AWAITING_SOURCE_PAYMENT'];

export function TransactionView({ initial }: { initial: Txn }) {
  const [t, setT] = useState(initial);

  const refresh = useCallback(async () => {
    try {
      setT(await callApi<Txn>(`transactions/${initial.id}`));
    } catch {
      /* keep the last good view; the next tick retries */
    }
  }, [initial.id]);

  useEffect(() => {
    const manualWaiting = t.state === 'AWAITING_SOURCE_PAYMENT' && t.paymentInstructions?.method === 'MANUAL_AIRTIME_TRANSFER';
    if (TERMINAL.includes(t.state) || manualWaiting) return;
    const id = setInterval(refresh, t.state === 'AWAITING_MANUAL_VERIFICATION' || t.state === 'UNDER_REVIEW' ? 10_000 : 3_000);
    return () => clearInterval(id);
  }, [t.state, t.paymentInstructions, refresh]);

  const copy = STATE_COPY[t.state] ?? { title: t.state, tone: 'wait' as const };

  const airtime = ASSETS[t.service.sourceAsset]?.kind === 'airtime';

  return (
    <div className={`two-col${t.receipt ? ' single' : ''}`}>
      <div className="stack">
        <div>
          <div className={`status tone-${copy.tone}`}>
            <span className="status-dot" aria-hidden />
            <h1 className="page-title" style={{ margin: 0 }}>
              {copy.title}
            </h1>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {t.service.name}, reference <strong className="money">{t.reference}</strong>
          </p>
        </div>

        <StateMessage t={t} />

        {t.paymentInstructions?.method === 'MANUAL_AIRTIME_TRANSFER' && t.state === 'AWAITING_SOURCE_PAYMENT' && (
          <ManualPayment t={t} onSubmitted={setT} />
        )}

        {t.receipt && <Receipt t={t} airtime={airtime} />}

        <section aria-labelledby="progress">
          <h2 id="progress" style={{ fontSize: 17, marginBottom: 14 }}>
            Progress
          </h2>
          <ol className="timeline">
            {t.timeline
              .filter((h) => h.toState !== 'CREATED')
              .map((h, i) => (
                <li key={`${h.toState}-${i}`}>
                  <div>{HISTORY_COPY[h.toState] ?? h.toState}</div>
                  <div className="when">{dateTime(h.createdAt)}</div>
                </li>
              ))}
          </ol>
        </section>
      </div>

      {!t.receipt && (
      <aside className="panel" aria-label="Summary">
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 10, columnGap: 16 }}>
          <dt className="muted">{airtime ? 'Airtime you transfer' : 'You pay'}</dt>
          <dd className="money" style={{ margin: 0, textAlign: 'right', fontWeight: 700 }}>
            {fcfa(t.customerPays)}
          </dd>
          {t.conversionRate !== null && (
            <>
              <dt className="muted">Airtime value rate</dt>
              <dd className="money" style={{ margin: 0, textAlign: 'right' }}>
                {Math.round(t.conversionRate * 100)}%
              </dd>
            </>
          )}
          <dt className="muted">AMICO fee</dt>
          <dd className="money" style={{ margin: 0, textAlign: 'right' }}>
            {fcfa(t.platformFee)}
          </dd>
          <dt className="muted">Operator fee</dt>
          <dd className="money" style={{ margin: 0, textAlign: 'right' }}>
            {fcfa(t.providerFee)}
          </dd>
          <dt className="muted">Recipient</dt>
          <dd style={{ margin: 0, textAlign: 'right' }}>{phone(t.recipient)}</dd>
          <dt className="muted">Recipient receives</dt>
          <dd className="money" style={{ margin: 0, textAlign: 'right', fontWeight: 700, color: 'var(--gold-glow)' }}>
            {fcfa(t.expectedDelivered)}
          </dd>
        </dl>
        <p className="muted" style={{ fontSize: 14, margin: '16px 0 0' }}>
          These are the terms you accepted. They don’t change, even if prices change later.
        </p>
      </aside>
      )}
    </div>
  );
}

function StateMessage({ t }: { t: Txn }) {
  const m: Record<string, string> = {
    PAYMENT_PROCESSING: 'Approve the payment prompt on your phone. This page updates by itself.',
    AWAITING_MANUAL_VERIFICATION:
      'We got your reference. A team member is checking that the airtime reached our number. This usually takes a few minutes during opening hours.',
    SOURCE_VERIFIED: 'Your payment is confirmed. We’re sending it to the recipient now.',
    PAYOUT_PROCESSING: 'We’re sending it to the recipient now.',
    DELIVERY_PENDING: 'The operator accepted the transfer. We’re confirming it reached the recipient.',
    UNDER_REVIEW:
      'Something needs a closer look, for example the amount received didn’t match. Nothing is lost: our team will contact you or resolve it shortly.',
    FAILED: 'The operator couldn’t deliver this transfer. Our team will refund you or retry. You don’t need to do anything.',
    REFUND_PENDING: 'We’re returning your money to the number you paid from.',
    REFUNDED: 'Your money was returned to the number you paid from.',
    REJECTED: 'This exchange didn’t go ahead. If any money left your account, contact support with the reference above.',
  };
  if (t.state === 'AWAITING_SOURCE_PAYMENT' && t.paymentInstructions?.method === 'PROVIDER_PAYMENT_PROMPT') {
    return <div className="alert alert-info">Approve the payment prompt on your phone for {fcfa(t.paymentInstructions.amount)}.</div>;
  }
  return m[t.state] ? <p style={{ margin: 0, maxWidth: '62ch' }}>{m[t.state]}</p> : null;
}

function ManualPayment({ t, onSubmitted }: { t: Txn; onSubmitted: (t: Txn) => void }) {
  const p = t.paymentInstructions as Extract<Txn['paymentInstructions'], { method: 'MANUAL_AIRTIME_TRANSFER' }>;
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyNumber() {
    await navigator.clipboard?.writeText(p.sendTo.replace(/^237/, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (reference.trim().length < 3) {
      setError('Enter the reference from your operator’s confirmation SMS.');
      return;
    }
    setBusy(true);
    try {
      const evidenceFileIds: string[] = [];
      if (file) {
        const form = new FormData();
        form.append('file', file);
        const up = await callApi<{ id: string }>('evidence', { method: 'POST', body: form });
        evidenceFileIds.push(up.id);
      }
      const next = await callApi<Txn>(`transactions/${t.id}/source-reference`, {
        method: 'POST',
        body: JSON.stringify({ customerReference: reference.trim(), evidenceFileIds }),
      });
      onSubmitted(next);
    } catch (err) {
      setError(
        err instanceof ClientApiError && err.code === 'UNSUPPORTED_FILE'
          ? 'Upload a JPEG, PNG or PDF screenshot, or leave it out.'
          : err instanceof ClientApiError
            ? err.message
            : 'Can’t reach AMICO right now. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pay-box" aria-labelledby="pay-title">
      <h2 id="pay-title" style={{ fontSize: 18 }}>
        Transfer {fcfa(p.amount)} of airtime to
      </h2>
      <div className="big-number">
        <span className={`op op-${p.operator}`}>{phone(p.sendTo)}</span>
        <button type="button" className="btn btn-quiet" style={{ minHeight: 38, fontSize: 14 }} onClick={copyNumber}>
          {copied ? 'Copied' : 'Copy number'}
        </button>
      </div>
      <ol className="steps">
        <li>Use your operator’s own credit-transfer service, from the number you entered.</li>
        <li>Send exactly {fcfa(p.amount)}. A different amount puts the exchange on hold.</li>
        <li>Keep the confirmation SMS, then enter its reference below.</li>
      </ol>

      <form onSubmit={submit} style={{ marginTop: 20 }} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="ref">Reference from the SMS</label>
          <input className="input" id="ref" value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="proof">Screenshot of the SMS (optional)</label>
          <input id="proof" type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="hint">Helps us find your transfer faster. We still check the airtime on our side.</span>
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'I’ve sent the airtime'}
        </button>
      </form>
    </section>
  );
}

function Receipt({ t, airtime }: { t: Txn; airtime: boolean }) {
  const r = t.receipt!;
  return (
    <section className="ticket" aria-labelledby="receipt-title">
      <div className="ticket-head">
        <h2 id="receipt-title">Receipt</h2>
        <span className="ticket-kind">
          {r.reference}
          {r.simulated ? <><br />Simulation</> : null}
        </span>
      </div>
      <dl>
        <dt>Service</dt>
        <dd>{t.service.name}</dd>
        <dt>Delivered to</dt>
        <dd>{phone(r.to)}</dd>
        <dt>Completed</dt>
        <dd>{dateTime(r.completedAt)}</dd>
      </dl>
      <hr />
      <dl>
        <dt>{airtime ? 'Airtime you transferred' : 'You paid'}</dt>
        <dd>{fcfa(t.customerPays)}</dd>
        {t.conversionRate !== null && (
          <>
            <dt>Airtime value rate</dt>
            <dd>{Math.round(t.conversionRate * 100)}%</dd>
          </>
        )}
        <dt>AMICO fee</dt>
        <dd>{fcfa(r.platformFee)}</dd>
        <dt>Operator fee</dt>
        <dd>{fcfa(r.providerFee)}</dd>
      </dl>
      <div className="receive">
        <div className="label">Delivered</div>
        <div className="amount money">{fcfa(r.delivered)}</div>
      </div>
      <div className="ticket-actions no-print">
        <button className="btn btn-quiet" style={{ color: 'var(--paper-ink)', borderColor: 'rgba(0,0,0,.25)' }} onClick={() => window.print()}>
          Print or save receipt
        </button>
        <Link href="/app" className="btn btn-primary">
          New exchange
        </Link>
      </div>
    </section>
  );
}
