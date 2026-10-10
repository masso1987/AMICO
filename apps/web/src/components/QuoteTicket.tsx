'use client';

import { useEffect, useState } from 'react';
import { fcfa, phone } from '@/lib/format';

export interface Quote {
  id: string;
  kind: 'QUOTE' | 'ESTIMATED_QUOTE';
  label: string;
  simulated: boolean;
  service: { code: string; name: string; processingMethod: string };
  source: { asset: string; label: string; msisdn: string; amount: number };
  destination: { asset: string; label: string; recipient: string };
  amount: number;
  conversionRate: number | null;
  platformFee: number;
  providerFee: { amount: number; status: string; collectedBy: string };
  totalPayable: number;
  expectedReceived: number;
  pricingRuleVersion: number;
  assumptions: string[];
  restrictions: string[];
  expiresAt: string;
}

function useCountdown(expiresAt: string) {
  const [left, setLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(expiresAt).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return Math.max(0, left);
}

/** The quote as a paper slip: every number comes from the API, nothing is computed here. */
export function QuoteTicket({ quote, children, onExpired }: { quote: Quote; children?: React.ReactNode; onExpired?: () => void }) {
  const left = useCountdown(quote.expiresAt);
  const expired = left === 0;
  useEffect(() => {
    if (expired) onExpired?.();
  }, [expired, onExpired]);
  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  const providerLabel =
    quote.providerFee.status === 'ESTIMATE' ? 'Operator fee (estimate)' : 'Operator fee';

  return (
    <section className="ticket" aria-labelledby="quote-title" aria-live="polite">
      <div className="ticket-head">
        <h2 id="quote-title">{quote.kind === 'ESTIMATED_QUOTE' ? 'Estimated quote' : 'Quote'}</h2>
        <span className="ticket-kind">
          Not yet confirmed
          {quote.simulated ? <><br />Simulation</> : null}
        </span>
      </div>

      <dl>
        <dt>You send from</dt>
        <dd>{quote.source.label}</dd>
        <dt>Your number</dt>
        <dd>{phone(quote.source.msisdn)}</dd>
        <dt>Recipient gets</dt>
        <dd>{quote.destination.label}</dd>
        <dt>Recipient number</dt>
        <dd>{phone(quote.destination.recipient)}</dd>
      </dl>

      <hr />

      <dl>
        <dt>Amount</dt>
        <dd>{fcfa(quote.amount)}</dd>
        {quote.conversionRate !== null && (
          <>
            <dt>Airtime value rate</dt>
            <dd>{Math.round(quote.conversionRate * 100)}%</dd>
          </>
        )}
        <dt>AMICO fee</dt>
        <dd>{fcfa(quote.platformFee)}</dd>
        <dt>{providerLabel}</dt>
        <dd>{fcfa(quote.providerFee.amount)}</dd>
      </dl>

      <hr />

      <dl className="total">
        <dt>You pay</dt>
        <dd>{fcfa(quote.totalPayable)}</dd>
      </dl>

      <div className="receive">
        <div className="label">Recipient receives</div>
        <div className="amount money">{fcfa(quote.expectedReceived)}</div>
      </div>

      {(quote.assumptions.length > 0 || quote.restrictions.length > 0) && (
        <ul className="notes">
          {[...quote.assumptions, ...quote.restrictions].map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className={`stamp${expired ? ' expired' : ''}`} role="timer">
        {expired ? 'Quote expired' : `Valid for ${mm}:${ss}`}
      </div>

      {children}
    </section>
  );
}
