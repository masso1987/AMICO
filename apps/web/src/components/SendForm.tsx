'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { callApi, ClientApiError } from '@/lib/client';
import { ASSETS, fcfa } from '@/lib/format';
import { QuoteTicket, type Quote } from './QuoteTicket';
import type { ServiceSummary } from './RouteList';

const ERRORS: Record<string, string> = {
  BELOW_MIN_AMOUNT: 'That amount is below the minimum for this route.',
  ABOVE_MAX_AMOUNT: 'That amount is above the maximum for this route.',
  NON_POSITIVE_DELIVERY: 'The fees would be more than the amount. Enter a larger amount.',
  PROVIDER_FEE_UNKNOWN: 'We can’t confirm the operator fee right now, so we can’t give an exact quote. Try again later.',
  SERVICE_UNAVAILABLE: 'This route is closed at the moment. Pick another one or try again later.',
  QUOTE_EXPIRED: 'This quote expired. Get a new one to see current prices.',
  PRICING_CHANGED: 'Prices changed since this quote. Get a new one to see the current amount.',
  QUOTE_ALREADY_USED: 'You already confirmed this quote. Check your history.',
};

function messageFor(e: unknown): string {
  if (e instanceof ClientApiError) {
    if (ERRORS[e.code]) return ERRORS[e.code]!;
    if (e.code === 'VALIDATION_FAILED' && Array.isArray(e.details)) {
      return (e.details as { path: string; message: string }[]).map((d) => d.message).join('. ');
    }
    return e.message;
  }
  return 'Can’t reach AMICO right now. Check your connection and try again.';
}

export function SendForm({ service, myPhone }: { service: ServiceSummary; myPhone: string }) {
  const router = useRouter();
  const from = ASSETS[service.sourceAsset]!;
  const to = ASSETS[service.destinationAsset]!;
  const local = myPhone.replace(/^237/, '');

  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState(to.kind === 'money' ? '' : local);
  const [sender, setSender] = useState(local);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [idempotencyKey, setKey] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'quote' | 'confirm' | null>(null);
  const [expired, setExpired] = useState(false);
  const onExpired = useCallback(() => setExpired(true), []);

  // Any edit invalidates the quote on screen: the customer only confirms what they last saw.
  function edit<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setQuote(null);
      setError(null);
    };
  }

  async function getQuote(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const value = Number(amount.replace(/\s/g, ''));
    if (!Number.isInteger(value) || value <= 0) {
      setError('Enter a whole amount in FCFA, for example 5000.');
      return;
    }
    setBusy('quote');
    try {
      const q = await callApi<Quote>('quotes', {
        method: 'POST',
        body: JSON.stringify({ serviceCode: service.code, amount: value, recipientMsisdn: recipient, senderMsisdn: sender }),
      });
      setQuote(q);
      setKey(crypto.randomUUID());
      setExpired(false);
    } catch (err) {
      setQuote(null);
      setError(messageFor(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!quote) return;
    setBusy('confirm');
    setError(null);
    try {
      const t = await callApi<{ id: string }>('transactions', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ quoteId: quote.id, acceptedTerms: true }),
      });
      router.push(`/app/transactions/${t.id}`);
    } catch (err) {
      setError(messageFor(err));
      if (err instanceof ClientApiError && ['QUOTE_EXPIRED', 'PRICING_CHANGED'].includes(err.code)) setExpired(true);
      setBusy(null);
    }
  }

  return (
    <div className="send-grid">
      <form onSubmit={getQuote} noValidate>
        <div className="route-heading">
          <span className={`op op-${from.operator}`}>{from.label}</span>
          <span className="arrow" aria-label="to">
            ⟶
          </span>
          <span className={`op op-${to.operator}`}>{to.label}</span>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div className="field">
          <label htmlFor="amount">{from.kind === 'airtime' ? 'Airtime you will transfer' : 'Amount you send'}</label>
          <div className="input-prefix">
            <span>FCFA</span>
            <input
              className="input amount-input"
              id="amount"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(e) => edit(setAmount)(e.target.value.replace(/[^\d\s]/g, ''))}
              aria-describedby="amount-hint"
            />
          </div>
          <span className="hint" id="amount-hint">
            Between {fcfa(service.minAmount)} and {fcfa(service.maxAmount)}.
          </span>
        </div>

        <div className="field">
          <label htmlFor="recipient">{to.kind === 'money' ? `Recipient’s ${to.short} number` : 'Number to top up'}</label>
          <div className="input-prefix">
            <span>+237</span>
            <input
              className="input"
              id="recipient"
              type="tel"
              inputMode="numeric"
              placeholder="6XX XX XX XX"
              value={recipient}
              onChange={(e) => edit(setRecipient)(e.target.value)}
            />
          </div>
          <button type="button" className="btn-link" onClick={() => edit(setRecipient)(local)} style={linkStyle}>
            Use my own number
          </button>
        </div>

        <div className="field">
          <label htmlFor="sender">{from.kind === 'airtime' ? `${from.label} number you transfer from` : `Your ${from.short} number that pays`}</label>
          <div className="input-prefix">
            <span>+237</span>
            <input
              className="input"
              id="sender"
              type="tel"
              inputMode="numeric"
              value={sender}
              onChange={(e) => edit(setSender)(e.target.value)}
            />
          </div>
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={busy !== null}>
          {busy === 'quote' ? 'Getting quote…' : quote ? 'Refresh quote' : 'Get quote'}
        </button>
        <p className="muted" style={{ fontSize: 14, marginTop: 12 }}>
          A quote doesn’t charge you anything.
        </p>
      </form>

      <div aria-live="polite">
        {quote ? (
          <QuoteTicket quote={quote} onExpired={onExpired}>
            <div className="ticket-actions no-print">
              {expired ? (
                <button className="btn btn-primary btn-block" onClick={() => getQuote()} disabled={busy !== null}>
                  Get a new quote
                </button>
              ) : (
                <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy !== null}>
                  {busy === 'confirm' ? 'Confirming…' : `Confirm and pay ${fcfa(quote.totalPayable)}`}
                </button>
              )}
            </div>
          </QuoteTicket>
        ) : (
          <div className="ticket-empty">Your quote appears here, with every fee listed, before you confirm.</div>
        )}
      </div>
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  justifySelf: 'start',
  background: 'none',
  border: 0,
  padding: 0,
  color: 'var(--gold-glow)',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};
