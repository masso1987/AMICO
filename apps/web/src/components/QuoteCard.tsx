'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { pick, type MessageKey } from '@/i18n/core';
import { fcfa, kindOf, phone } from '@/lib/format';

export interface Quote {
  id: string;
  kind: 'QUOTE' | 'ESTIMATED_QUOTE';
  simulated: boolean;
  service: { code: string; name: string; processingMethod: 'API' | 'MANUAL_SOURCE' };
  source: { asset: string; label: string; msisdn: string; amount: number };
  destination: { asset: string; label: string; recipient: string };
  bundle: { id: string; name: string; nameFr: string; validityDays: number | null; operator: string } | null;
  amount: number;
  conversionRate: number | null;
  platformFee: number;
  providerFee: { amount: number; status: string; collectedBy: string };
  totalPayable: number;
  expectedReceived: number;
  expiresAt: string;
}

function useCountdown(expiresAt: string) {
  const [left, setLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());
  useEffect(() => {
    setLeft(new Date(expiresAt).getTime() - Date.now());
    const id = setInterval(() => setLeft(new Date(expiresAt).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return Math.max(0, left);
}

/** Every number here comes from the API; nothing is computed in the browser. */
export function QuoteCard({ quote, children, onExpired }: { quote: Quote; children?: React.ReactNode; onExpired?: () => void }) {
  const { t, locale } = useI18n();
  const left = useCountdown(quote.expiresAt);
  const expired = left === 0;
  useEffect(() => {
    if (expired) onExpired?.();
  }, [expired, onExpired]);
  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  const srcKind = kindOf(quote.source.asset);
  const dstKind = kindOf(quote.destination.asset);
  const manual = quote.service.processingMethod === 'MANUAL_SOURCE';

  const notes: string[] = [];
  if (manual) notes.push(t('quote.note.manual'));
  if (quote.providerFee.status === 'ESTIMATE') notes.push(t('quote.note.estimate'));
  if (quote.bundle) notes.push(t('quote.note.bundle'));
  notes.push(t('quote.note.nothingMoves'));

  return (
    <section className="quote" aria-labelledby="quote-title">
      <div className="quote-head">
        <h2 id="quote-title">{quote.kind === 'ESTIMATED_QUOTE' ? t('quote.estimated') : t('quote.title')}</h2>
        <span className="quote-kind">
          {t('quote.notConfirmed')}
          {quote.simulated ? (
            <>
              <br />
              {t('common.simulation')}
            </>
          ) : null}
        </span>
      </div>

      <dl>
        <dt>{t(`quote.from.${srcKind}` as MessageKey)}</dt>
        <dd>{t(`asset.${quote.source.asset}` as MessageKey)}</dd>
        <dt>{t('quote.yourNumber')}</dt>
        <dd>{phone(quote.source.msisdn)}</dd>
        {quote.bundle ? (
          <>
            <dt>{t('quote.bundle')}</dt>
            <dd>{pick(locale, quote.bundle.name, quote.bundle.nameFr)}</dd>
          </>
        ) : (
          <>
            <dt>{t('quote.recipientGets')}</dt>
            <dd>{t(`asset.${quote.destination.asset}` as MessageKey)}</dd>
          </>
        )}
        <dt>{t('quote.recipientNumber')}</dt>
        <dd>{phone(quote.destination.recipient)}</dd>
      </dl>

      <hr />

      <dl>
        <dt>{srcKind === 'airtime' ? t('quote.airtimeValue') : quote.bundle ? t('quote.bundlePrice') : t('quote.amount')}</dt>
        <dd>{fcfa(quote.amount)}</dd>
        {quote.conversionRate !== null && (
          <>
            <dt>{t('quote.rate')}</dt>
            <dd>{Math.round(quote.conversionRate * 10000) / 100}%</dd>
          </>
        )}
        <dt>{t('quote.platformFee')}</dt>
        <dd>{fcfa(quote.platformFee)}</dd>
        <dt>{quote.providerFee.status === 'ESTIMATE' ? t('quote.providerFeeEstimate') : t('quote.providerFee')}</dt>
        <dd>{fcfa(quote.providerFee.amount)}</dd>
      </dl>

      <hr />

      <dl className="total">
        <dt>{srcKind === 'airtime' ? t('quote.youTransfer') : t('quote.youPay')}</dt>
        <dd>{fcfa(quote.totalPayable)}</dd>
      </dl>

      <div className="receive">
        <div className="label">{quote.bundle ? t('quote.recipientGetsBundle') : t(`quote.receives.${dstKind}` as MessageKey)}</div>
        <div className={`value money${quote.bundle ? " text" : ""}`}>{quote.bundle ? pick(locale, quote.bundle.name, quote.bundle.nameFr) : fcfa(quote.expectedReceived)}</div>
      </div>

      <ul className="notes">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>

      <div className={`timer${expired ? ' expired' : ''}`} role="timer" aria-live="off">
        {expired ? t('quote.expired') : t('quote.validFor', { time: `${mm}:${ss}` })}
      </div>

      {children}
    </section>
  );
}
