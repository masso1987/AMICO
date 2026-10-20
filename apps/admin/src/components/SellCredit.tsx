'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { callApi, errorText } from '@/lib/client';
import { fcfa, num, when } from '@/lib/format';

interface RuleView { id: string; version: number; ratePercent: number; minAmount: number; maxAmount: number; createdById: string; effectiveFrom: string }
export interface SellRoute { serviceCode: string; name: string; status: string; active: RuleView | null; pending: RuleView[] }

/** One buy-back rate and one range for every sell-credit route, drafted here and approved by a second person. */
export function SellCredit({ routes, meId, canApprove }: { routes: SellRoute[]; meId: string; canApprove: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const current = routes.find((r) => r.active)?.active;
  const [rate, setRate] = useState(current ? String(current.ratePercent) : '85');
  const [min, setMin] = useState(String(current?.minAmount ?? 1000));
  const [max, setMax] = useState(String(current?.maxAmount ?? 500000));
  const [from, setFrom] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pending = routes.flatMap((r) => r.pending.map((p) => ({ ...p, serviceCode: r.serviceCode, name: r.name })));
  const approvable = pending.filter((p) => p.createdById !== meId);
  const rates = new Set(routes.filter((r) => r.active).map((r) => r.active!.ratePercent));
  const sample = Number(rate.replace(',', '.'));

  async function draft(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy('draft');
    try {
      await callApi('admin/pricing/sell-credit', {
        method: 'POST',
        body: JSON.stringify({
          ratePercent: Number(rate.replace(',', '.')),
          minAmount: Number(min.replace(/\s/g, '')),
          maxAmount: Number(max.replace(/\s/g, '')),
          ...(from ? { effectiveFrom: new Date(from).toISOString() } : {}),
          changeReason: reason.trim(),
        }),
      });
      setMsg({ ok: true, text: t('sell.drafted') });
      setReason('');
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(null);
    }
  }

  async function approveAll() {
    setMsg(null);
    setBusy('approve');
    try {
      await callApi('admin/pricing-rules/approve-many', { method: 'POST', body: JSON.stringify({ ruleIds: approvable.map((p) => p.id) }) });
      setMsg({ ok: true, text: t('sell.approved') });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: string) {
    const why = window.prompt(t('sell.rejectReason'));
    if (!why || why.trim().length < 5) return;
    try {
      await callApi(`admin/pricing-rules/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: why.trim() }) });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    }
  }

  return (
    <div className="stack">
      <div className="kpis-row">
        <div className="card mini-stat">
          <span className="muted small">{t('sell.currentRate')}</span>
          <strong className="gold-text">{rates.size === 1 ? `${[...rates][0]}%` : rates.size ? t('sell.mixed') : '—'}</strong>
          <span className="small muted">{t('sell.sameForAll')}</span>
        </div>
        <div className="card mini-stat">
          <span className="muted small">{t('sell.range')}</span>
          <strong>{current ? `${fcfa(current.minAmount)} – ${fcfa(current.maxAmount)}` : '—'}</strong>
          <span className="small muted">{t('sell.perTransaction')}</span>
        </div>
        <div className="card mini-stat">
          <span className="muted small">{t('sell.pendingDrafts')}</span>
          <strong className={pending.length ? 'review-text' : ''}>{pending.length}</strong>
          <span className="small muted">{t('sell.needsSecond')}</span>
        </div>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="routes">
          <h2 id="routes">{t('sell.routes')}</h2>
          <div className="table-wrap flat">
            <table className="t">
              <thead>
                <tr><th>{t('sell.route')}</th><th className="num">{t('sell.rate')}</th><th className="num">{t('sell.min')}</th><th className="num">{t('sell.max')}</th><th>{t('sell.status')}</th></tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.serviceCode}>
                    <td>{r.name}<div className="sub">{r.active ? t('sell.version', { v: r.active.version, at: when(r.active.effectiveFrom, locale) }) : t('sell.noRule')}</div></td>
                    <td className="num">{r.active ? `${r.active.ratePercent}%` : '—'}</td>
                    <td className="num">{r.active ? num(r.active.minAmount) : '—'}</td>
                    <td className="num">{r.active ? num(r.active.maxAmount) : '—'}</td>
                    <td><span className={`badge ${r.status === 'ENABLED' ? 'tone-good' : ''}`}>{r.status === 'ENABLED' ? t('sell.open') : t('sell.closed')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pending.length > 0 && (
            <>
              <h3 className="sub-h">{t('sell.waiting')}</h3>
              <ul className="plain-list">
                {pending.map((p) => (
                  <li key={p.id} className="row-between">
                    <span>
                      {p.name}: <strong>{p.ratePercent}%</strong>, {num(p.minAmount)} – {num(p.maxAmount)} FCFA
                      <span className="muted small"> · {p.createdById === meId ? t('sell.byYou') : t('sell.byOther')}</span>
                    </span>
                    {canApprove && <button className="btn btn-danger btn-sm" onClick={() => reject(p.id)}>{t('sell.reject')}</button>}
                  </li>
                ))}
              </ul>
              {canApprove && (
                <button className="btn btn-primary" onClick={approveAll} disabled={busy !== null || approvable.length === 0}>
                  {busy === 'approve' ? t('common.working') : t('sell.approveAll', { n: approvable.length })}
                </button>
              )}
              {canApprove && approvable.length < pending.length && <p className="muted small">{t('sell.ownDrafts')}</p>}
            </>
          )}
        </section>

        <section className="card" aria-labelledby="new-rate">
          <h2 id="new-rate">{t('sell.change')}</h2>
          <form className="aform" onSubmit={draft} noValidate>
            <div className="field">
              <label htmlFor="sc-rate">{t('sell.ratePercent')}</label>
              <input id="sc-rate" type="text" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              <span className="hint">{Number.isFinite(sample) && sample > 0 ? t('sell.example', { pay: fcfa(Math.floor((10000 * sample) / 100)) }) : t('sell.rateHint')}</span>
            </div>
            <div className="cols-2">
              <div className="field">
                <label htmlFor="sc-min">{t('sell.min')}</label>
                <input id="sc-min" type="text" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="sc-max">{t('sell.max')}</label>
                <input id="sc-max" type="text" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="sc-from">{t('sell.from')}</label>
              <input id="sc-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="hint">{t('sell.fromHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="sc-reason">{t('common.reason')}</label>
              <input id="sc-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
            <button className="btn btn-primary" disabled={busy !== null}>{busy === 'draft' ? t('common.working') : t('sell.submit')}</button>
            <p className="muted small">{t('sell.makerChecker')}</p>
          </form>
        </section>
      </div>
    </div>
  );
}
