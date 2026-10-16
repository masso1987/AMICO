'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { operatorOfMsisdn } from '@amico/contracts';
import { useI18n } from '@/i18n/client';
import { pick, type MessageKey } from '@/i18n/core';
import { callApi, ClientApiError } from '@/lib/client';
import { errorText } from '@/lib/errors';
import { fcfa, localNumber, operatorOf, toMsisdn } from '@/lib/format';
import type { BundleCatalogue } from '@/lib/products';
import { BundleCard, bundleFacts, validityText } from './BundleCard';
import { QuoteCard, type Quote } from './QuoteCard';

type Op = 'MTN' | 'ORANGE';
const CATEGORIES = ['ALL', 'DATA', 'VOICE', 'SMS', 'COMBO'] as const;
const VALIDITIES = ['ALL', 'DAY', 'WEEK', 'MONTH'] as const;

export function BundleShop({ catalogue, pausedCodes, myPhone, initialBundleId }: { catalogue: BundleCatalogue; pausedCodes: string[]; myPhone: string; initialBundleId?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const myOp = (operatorOfMsisdn(myPhone) ?? 'MTN') as Op;
  const initial = catalogue.bundles.find((b) => b.id === initialBundleId) ?? null;
  const operators = useMemo(() => (['MTN', 'ORANGE'] as Op[]).filter((o) => catalogue.paymentOptions.some((p) => p.operator === o)), [catalogue]);
  const [operator, setOperator] = useState<Op>(initial?.operator ?? (operators.includes(myOp) ? myOp : (operators[0] ?? 'MTN')));
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('ALL');
  const [validity, setValidity] = useState<(typeof VALIDITIES)[number]>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);
  const payOptions = catalogue.paymentOptions.filter((p) => p.operator === operator);
  const [payWith, setPayWith] = useState<string>(() => {
    const opts = catalogue.paymentOptions.filter((p) => p.operator === (initial?.operator ?? operator));
    return (opts.find((p) => operatorOf(p.payWith) === myOp) ?? opts[0])?.payWith ?? 'MTN_MOMO';
  });
  const mine = localNumber(myPhone);
  const [recipient, setRecipient] = useState(myOp === (initial?.operator ?? operator) ? mine : '');
  const [sender, setSender] = useState(operatorOf(payWith) === myOp ? mine : '');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [idemKey, setIdemKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'quote' | 'confirm' | null>(null);
  const [expired, setExpired] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const onExpired = useCallback(() => setExpired(true), []);
  const checkoutRef = useRef<HTMLDivElement>(null);

  const list = catalogue.bundles.filter((b) => b.operator === operator && (category === 'ALL' || b.category === category) && (validity === 'ALL' || b.validity === validity));
  const selected = catalogue.bundles.find((b) => b.id === selectedId && b.operator === operator) ?? null;
  const option = payOptions.find((p) => p.payWith === payWith) ?? payOptions[0];
  const paused = option ? pausedCodes.includes(option.serviceCode) : true;

  function reset() {
    setQuote(null);
    setError(null);
    setAgreed(false);
  }

  function chooseOperator(o: Op) {
    setOperator(o);
    setSelectedId(null);
    const opts = catalogue.paymentOptions.filter((p) => p.operator === o);
    if (!opts.some((p) => p.payWith === payWith)) setPayWith(opts[0]?.payWith ?? payWith);
    if (myOp === o && !recipient) setRecipient(mine);
    reset();
  }

  function choose(id: string) {
    setSelectedId(id);
    reset();
    requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 880px)').matches) checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const recipientOp = operatorOfMsisdn(toMsisdn(recipient));
  const recipientMismatch = recipient.replace(/\D/g, '').length >= 9 && recipientOp !== null && recipientOp !== operator;
  const senderOp = operatorOfMsisdn(toMsisdn(sender));
  const senderMismatch = sender.replace(/\D/g, '').length >= 9 && senderOp !== null && senderOp !== operatorOf(payWith);

  async function getQuote(e?: React.FormEvent) {
    e?.preventDefault();
    if (!selected || !option) return;
    setError(null);
    if (toMsisdn(recipient).length !== 12 || toMsisdn(sender).length !== 12) return setError(t('err.BAD_NUMBER'));
    setBusy('quote');
    try {
      const q = await callApi<Quote>('quotes', {
        method: 'POST',
        body: JSON.stringify({ serviceCode: option.serviceCode, bundleId: selected.id, recipientMsisdn: toMsisdn(recipient), senderMsisdn: toMsisdn(sender) }),
      });
      setQuote(q);
      setIdemKey(crypto.randomUUID());
      setExpired(false);
    } catch (err) {
      setQuote(null);
      setError(errorText(err, t, locale));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!quote) return;
    setBusy('confirm');
    setError(null);
    try {
      const txn = await callApi<{ id: string }>('transactions', {
        method: 'POST',
        headers: { 'idempotency-key': idemKey },
        body: JSON.stringify({ quoteId: quote.id, acceptedTerms: true }),
      });
      router.push(`/app/transactions/${txn.id}`);
    } catch (err) {
      setError(errorText(err, t, locale));
      if (err instanceof ClientApiError && ['QUOTE_EXPIRED', 'PRICING_CHANGED', 'BUNDLE_PRICE_CHANGED'].includes(err.code)) setExpired(true);
      setBusy(null);
    }
  }

  if (operators.length === 0) return <div className="empty">{t('bundles.none')}</div>;

  return (
    <div className="grid-2">
      <div>
        <div className="filters">
          {operators.length > 1 && (
            <div className="segmented" role="group" aria-label={t('bundles.network')} style={{ minWidth: 220 }}>
              {operators.map((o) => (
                <button key={o} type="button" aria-pressed={operator === o} onClick={() => chooseOperator(o)}>
                  <span className={`op op-${o}`}>{t(`op.${o}` as MessageKey)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="chips" role="group" aria-label={t('bundles.category')}>
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
                {t(`category.${c}` as MessageKey)}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label={t('bundles.validity')}>
            {VALIDITIES.map((v) => (
              <button key={v} type="button" className="chip" aria-pressed={validity === v} onClick={() => setValidity(v)}>
                {t(`validity.${v}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        {list.length ? (
          <div className="bundles">
            {list.map((b) => (
              <BundleCard key={b.id} bundle={b} selected={b.id === selectedId} onSelect={() => choose(b.id)} />
            ))}
          </div>
        ) : (
          <div className="empty">{t('bundles.noMatch')}</div>
        )}
      </div>

      <div className="sticky" ref={checkoutRef} aria-live="polite">
        {!selected ? (
          <div className="quote-empty">
            <strong style={{ color: 'var(--ink)', display: 'block', marginBottom: 6 }}>{t('bundles.pickTitle')}</strong>
            {t('bundles.pickBody')}
          </div>
        ) : quote ? (
          <>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <QuoteCard quote={quote} onExpired={onExpired}>
            <div className="no-print" style={{ marginTop: 16, display: 'grid', gap: 12 }}>
              {expired ? (
                <button className="btn btn-primary btn-block" onClick={() => getQuote()} disabled={busy !== null}>
                  {t('form.newQuote')}
                </button>
              ) : (
                <>
                  <label className="check">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    <span>{t('form.agree')}</span>
                  </label>
                  <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy !== null || !agreed}>
                    {busy === 'confirm' ? t('form.confirming') : t('form.confirmPay', { amount: fcfa(quote.totalPayable) })}
                  </button>
                  <button className="btn btn-quiet btn-block" onClick={reset} type="button">
                    {t('bundles.change')}
                  </button>
                </>
              )}
            </div>
          </QuoteCard>
          </>
        ) : (
          <form className="panel" onSubmit={getQuote} noValidate>
            <span className="eyebrow">{t('bundles.selected')}</span>
            <h2 style={{ fontSize: 20, margin: '6px 0 4px' }}>{pick(locale, selected.name, selected.nameFr)}</h2>
            <p className="muted" style={{ marginBottom: 6 }}>
              {[bundleFacts(selected, t, locale), validityText(selected, t)].filter(Boolean).join(' · ')}
            </p>
            <p className="gold money" style={{ fontSize: 24, fontWeight: 700, marginBottom: 18 }}>
              {fcfa(selected.price)}
            </p>

            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            {paused && (
              <div className="alert alert-info" role="status">
                {t('form.paused')}
              </div>
            )}

            <div className="field">
              <label htmlFor="b-recipient">{t('bundles.recipient')}</label>
              <div className="input-group">
                <span>+237</span>
                <input
                  className="input"
                  id="b-recipient"
                  type="tel"
                  inputMode="numeric"
                  placeholder="6XX XX XX XX"
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    reset();
                  }}
                />
              </div>
              {recipientMismatch && (
                <span className="hint" style={{ color: 'var(--review)' }}>
                  {t('form.wrongNetwork', { network: t(`op.${operator}` as MessageKey) })}
                </span>
              )}
            </div>

            {payOptions.length > 1 && (
              <div className="field">
                <span className="label" id="pay-label">
                  {t('bundles.payWith')}
                </span>
                <div className="chips" role="group" aria-labelledby="pay-label">
                  {payOptions.map((p) => (
                    <button
                      key={p.payWith}
                      type="button"
                      className="chip"
                      aria-pressed={p.payWith === payWith}
                      onClick={() => {
                        setPayWith(p.payWith);
                        if (operatorOf(p.payWith) === myOp && !sender) setSender(mine);
                        reset();
                      }}
                    >
                      <span className={`op op-${operatorOf(p.payWith)}`}>{t(`asset.${p.payWith}` as MessageKey)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field">
              <label htmlFor="b-sender">{t('form.sender.money', { asset: t(`asset.${payWith}` as MessageKey) })}</label>
              <div className="input-group">
                <span>+237</span>
                <input
                  className="input"
                  id="b-sender"
                  type="tel"
                  inputMode="numeric"
                  placeholder="6XX XX XX XX"
                  value={sender}
                  onChange={(e) => {
                    setSender(e.target.value);
                    reset();
                  }}
                />
              </div>
              {senderMismatch && (
                <span className="hint" style={{ color: 'var(--review)' }}>
                  {t('form.wrongNetwork', { network: t(`op.${operatorOf(payWith)}` as MessageKey) })}
                </span>
              )}
            </div>

            <button className="btn btn-primary btn-block" type="submit" disabled={busy !== null || paused}>
              {busy === 'quote' ? t('form.gettingQuote') : t('form.getQuote')}
            </button>
            <p className="hint" style={{ marginTop: 10 }}>
              {t('form.quoteFree')}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
