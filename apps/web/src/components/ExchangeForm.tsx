'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { operatorOfMsisdn } from '@amico/contracts';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n/core';
import { callApi, ClientApiError } from '@/lib/client';
import { errorText } from '@/lib/errors';
import { fcfa, kindOf, localNumber, num, operatorOf, toMsisdn } from '@/lib/format';
import type { Group, SellRate, ServiceSummary } from '@/lib/products';
import { ratePct } from '@/lib/products';
import { QuoteCard, type Quote } from './QuoteCard';

const QUICK = [1000, 2000, 5000, 10000, 25000, 50000];

interface Props {
  group: Group;
  services: ServiceSummary[];
  pausedCodes: string[];
  myPhone: string;
  initialCode?: string;
  rates?: SellRate[];
}

/** Amount-based purchase: airtime, sell credit, airtime swap and MoMo ⇄ Orange Money. */
export function ExchangeForm({ group, services, pausedCodes, myPhone, initialCode, rates = [] }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const sources = useMemo(() => [...new Set(services.map((s) => s.sourceAsset))], [services]);
  const first = services.find((s) => s.code === initialCode) ?? services[0]!;
  const [source, setSource] = useState(first.sourceAsset);
  const [dest, setDest] = useState(first.destinationAsset);
  const service = services.find((s) => s.sourceAsset === source && s.destinationAsset === dest) ?? services.find((s) => s.sourceAsset === source)!;
  const dests = services.filter((s) => s.sourceAsset === source).map((s) => s.destinationAsset);

  const myOp = operatorOfMsisdn(myPhone);
  const mine = localNumber(myPhone);
  const ownIf = (asset: string) => (myOp === operatorOf(asset) ? mine : '');

  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState(group === 'MONEY_EXCHANGE' ? '' : ownIf(first.destinationAsset));
  const [sender, setSender] = useState(ownIf(first.sourceAsset));
  const [touched, setTouched] = useState({ recipient: false, sender: false });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [idemKey, setIdemKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'quote' | 'confirm' | null>(null);
  const [expired, setExpired] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const onExpired = useCallback(() => setExpired(true), []);

  const paused = pausedCodes.includes(service.code);
  const srcKind = kindOf(service.sourceAsset);
  const dstKind = kindOf(service.destinationAsset);
  const rate = rates.find((r) => r.serviceCode === service.code);

  function reset() {
    setQuote(null);
    setError(null);
    setAgreed(false);
  }

  function chooseSource(a: string) {
    const nextDest = services.some((s) => s.sourceAsset === a && s.destinationAsset === dest) ? dest : services.find((s) => s.sourceAsset === a)!.destinationAsset;
    setSource(a);
    setDest(nextDest);
    if (!touched.sender) setSender(ownIf(a));
    if (!touched.recipient && group !== 'MONEY_EXCHANGE') setRecipient(ownIf(nextDest));
    reset();
  }

  function chooseDest(a: string) {
    setDest(a);
    if (!touched.recipient && group !== 'MONEY_EXCHANGE') setRecipient(ownIf(a));
    reset();
  }

  function onRecipient(v: string) {
    setRecipient(v);
    setTouched((x) => ({ ...x, recipient: true }));
    reset();
    // Buying airtime: follow the network of the number typed.
    if (group === 'BUY_AIRTIME') {
      const op = operatorOfMsisdn(toMsisdn(v));
      if (op && op !== operatorOf(dest)) {
        const match = services.find((s) => s.sourceAsset === source && operatorOf(s.destinationAsset) === op);
        if (match) setDest(match.destinationAsset);
      }
    }
  }

  const recipientOp = operatorOfMsisdn(toMsisdn(recipient));
  const senderOp = operatorOfMsisdn(toMsisdn(sender));
  const recipientMismatch = recipient.replace(/\D/g, '').length >= 9 && recipientOp !== null && recipientOp !== operatorOf(service.destinationAsset);
  const senderMismatch = sender.replace(/\D/g, '').length >= 9 && senderOp !== null && senderOp !== operatorOf(service.sourceAsset);

  async function getQuote(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const value = Number(amount.replace(/\D/g, ''));
    if (!Number.isInteger(value) || value <= 0) return setError(t('form.err.amount'));
    if (value < service.minAmount || value > service.maxAmount) return setError(t('form.err.range', { min: fcfa(service.minAmount), max: fcfa(service.maxAmount) }));
    if (toMsisdn(recipient).length !== 12 || toMsisdn(sender).length !== 12) return setError(t('err.BAD_NUMBER'));
    setBusy('quote');
    try {
      const q = await callApi<Quote>('quotes', {
        method: 'POST',
        body: JSON.stringify({ serviceCode: service.code, amount: value, recipientMsisdn: toMsisdn(recipient), senderMsisdn: toMsisdn(sender) }),
      });
      setQuote(q);
      setIdemKey(crypto.randomUUID());
      setExpired(false);
      setAgreed(false);
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
      if (err instanceof ClientApiError && ['QUOTE_EXPIRED', 'PRICING_CHANGED'].includes(err.code)) setExpired(true);
      setBusy(null);
    }
  }

  const quick = QUICK.filter((q) => q >= service.minAmount && q <= service.maxAmount);
  const fromLabel = t(`form.${group}.from` as MessageKey);
  const toLabel = t(`form.${group}.to` as MessageKey);

  return (
    <div className="grid-2">
      <form onSubmit={getQuote} noValidate className="panel">
        <div className="steps-bar" aria-hidden>
          <span className="on" />
          <span className={quote ? 'on' : ''} />
          <span />
        </div>
        <div className="steps-labels" aria-hidden style={{ marginBottom: 20 }}>
          <span>{t('steps.details')}</span>
          <span>{t('steps.quote')}</span>
          <span>{t('steps.pay')}</span>
        </div>

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

        {sources.length > 1 && (
          <div className="field">
            <span className="label" id="from-label">
              {fromLabel}
            </span>
            <div className="chips" role="group" aria-labelledby="from-label">
              {sources.map((a) => (
                <button key={a} type="button" className="chip" aria-pressed={a === source} onClick={() => chooseSource(a)}>
                  <span className={`op op-${operatorOf(a)}`}>{t(`asset.${a}` as MessageKey)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span className="label" id="to-label">
            {toLabel}
          </span>
          <div className="chips" role="group" aria-labelledby="to-label">
            {dests.map((a) => (
              <button key={a} type="button" className="chip" aria-pressed={a === dest} onClick={() => chooseDest(a)}>
                <span className={`op op-${operatorOf(a)}`}>{t(`asset.${a}` as MessageKey)}</span>
              </button>
            ))}
          </div>
          {group === 'SELL_CREDIT' && rate && <span className="hint gold">{t('sell.rateHint', { rate: ratePct(rate.ratePercent, locale) })}</span>}
        </div>

        <div className="field">
          <label htmlFor="amount">{t(`form.amount.${srcKind}` as MessageKey)}</label>
          <div className="input-group">
            <input
              className="input amount"
              id="amount"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, '');
                setAmount(d ? num(Number(d)) : '');
                reset();
              }}
              aria-describedby="amount-hint"
            />
            <span>FCFA</span>
          </div>
          <span className="hint" id="amount-hint">
            {t('form.range', { min: fcfa(service.minAmount), max: fcfa(service.maxAmount) })}
          </span>
          {quick.length > 0 && (
            <div className="chips" style={{ marginTop: 4 }}>
              {quick.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setAmount(num(q));
                    reset();
                  }}
                >
                  {num(q)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="recipient">{t(`form.recipient.${dstKind}` as MessageKey)}</label>
          <div className="input-group">
            <span>+237</span>
            <input className="input" id="recipient" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="6XX XX XX XX" value={recipient} onChange={(e) => onRecipient(e.target.value)} />
          </div>
          {recipientMismatch ? (
            <span className="hint" style={{ color: 'var(--review)' }}>
              {t('form.wrongNetwork', { network: t(`op.${operatorOf(service.destinationAsset)}` as MessageKey) })}
            </span>
          ) : (
            mine &&
            recipient !== mine && (
              <button type="button" className="linkish" onClick={() => onRecipient(mine)}>
                {t('form.useMine')}
              </button>
            )
          )}
        </div>

        <div className="field">
          <label htmlFor="sender">{t(`form.sender.${srcKind}` as MessageKey, { asset: t(`asset.${service.sourceAsset}` as MessageKey) })}</label>
          <div className="input-group">
            <span>+237</span>
            <input
              className="input"
              id="sender"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="6XX XX XX XX"
              value={sender}
              onChange={(e) => {
                setSender(e.target.value);
                setTouched((x) => ({ ...x, sender: true }));
                reset();
              }}
            />
          </div>
          {senderMismatch && (
            <span className="hint" style={{ color: 'var(--review)' }}>
              {t('form.wrongNetwork', { network: t(`op.${operatorOf(service.sourceAsset)}` as MessageKey) })}
            </span>
          )}
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={busy !== null || paused}>
          {busy === 'quote' ? t('form.gettingQuote') : quote ? t('form.refreshQuote') : t('form.getQuote')}
        </button>
        <p className="hint" style={{ marginTop: 10 }}>
          {t('form.quoteFree')}
        </p>
      </form>

      <div aria-live="polite" className="sticky">
        {quote ? (
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
                    <span>{srcKind === 'airtime' ? t('form.agree.manual') : t('form.agree')}</span>
                  </label>
                  <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy !== null || !agreed}>
                    {busy === 'confirm' ? t('form.confirming') : srcKind === 'airtime' ? t('form.confirmManual') : t('form.confirmPay', { amount: fcfa(quote.totalPayable) })}
                  </button>
                </>
              )}
            </div>
          </QuoteCard>
        ) : (
          <div className="quote-empty">
            <strong style={{ color: 'var(--ink)', display: 'block', marginBottom: 6 }}>{t('form.emptyTitle')}</strong>
            {t('form.emptyBody')}
          </div>
        )}
      </div>
    </div>
  );
}
