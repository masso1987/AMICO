'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PRODUCT_GROUP_INFO, productGroupOf, ROUTE_DEFINITIONS, type ProductGroup } from '@amico/contracts';
import { useI18n } from '@/i18n/client';
import { pick } from '@/i18n/core';
import { callApi, errorText } from '@/lib/client';
import { when } from '@/lib/format';

export interface Window {
  id: string;
  serviceCodes: string[];
  startsAt: string;
  endsAt: string | null;
  messageEn: string;
  messageFr: string;
  notifyCustomers: boolean;
  notifyLeadMinutes: number;
  customersNotifiedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

const GROUPS = Object.keys(PRODUCT_GROUP_INFO) as ProductGroup[];

function phase(w: Window, now: number): 'live' | 'upcoming' | 'ended' {
  if (w.endedAt || (w.endsAt && new Date(w.endsAt).getTime() <= now)) return 'ended';
  return new Date(w.startsAt).getTime() > now ? 'upcoming' : 'live';
}

/** Schedule or start maintenance for the whole app or chosen services, with customer notices in both languages. */
export function MaintenanceBoard({ windows, canManage }: { windows: Window[]; canManage: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const [scope, setScope] = useState<'ALL' | 'SERVICES'>('ALL');
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [startNow, setStartNow] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [messageEn, setMessageEn] = useState('');
  const [messageFr, setMessageFr] = useState('');
  const [notify, setNotify] = useState(true);
  const [lead, setLead] = useState('60');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const byGroup = useMemo(() => GROUPS.map((g) => ({ g, routes: ROUTE_DEFINITIONS.filter((r) => productGroupOf(r) === g) })), []);
  const covered = new Set([...groups.flatMap((g) => byGroup.find((x) => x.g === g)!.routes.map((r) => r.code)), ...codes]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (scope === 'SERVICES' && covered.size === 0) return setMsg({ ok: false, text: t('maint.err.pick') });
    if (!startNow && !startsAt) return setMsg({ ok: false, text: t('maint.err.start') });
    setBusy(true);
    try {
      await callApi('admin/maintenance', {
        method: 'POST',
        body: JSON.stringify({
          scope,
          productGroups: scope === 'SERVICES' ? groups : [],
          serviceCodes: scope === 'SERVICES' ? codes : [],
          ...(startNow ? {} : { startsAt: new Date(startsAt).toISOString() }),
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          messageEn: messageEn.trim(),
          messageFr: messageFr.trim(),
          notifyCustomers: notify,
          notifyLeadMinutes: Number(lead) || 0,
          reason: reason.trim(),
        }),
      });
      setMsg({ ok: true, text: startNow ? t('maint.startedOk') : t('maint.scheduledOk') });
      setMessageEn('');
      setMessageFr('');
      setReason('');
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function end(w: Window) {
    const why = window.prompt(t('maint.endReason'));
    if (!why || why.trim().length < 5) return;
    try {
      await callApi(`admin/maintenance/${w.id}/end`, { method: 'POST', body: JSON.stringify({ reason: why.trim() }) });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    }
  }

  const list = [...windows].sort((a, b) => ['live', 'upcoming', 'ended'].indexOf(phase(a, now)) - ['live', 'upcoming', 'ended'].indexOf(phase(b, now)));

  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="windows">
        <h2 id="windows">{t('maint.windows')}</h2>
        {list.length ? (
          <ul className="window-list">
            {list.map((w) => {
              const p = phase(w, now);
              return (
                <li key={w.id} className={p}>
                  <div className="row-between">
                    <span className={`badge ${p === 'live' ? 'tone-bad' : p === 'upcoming' ? 'tone-review' : ''}`}>{t(`maint.phase.${p}` as 'maint.phase.live')}</span>
                    <span className="muted small">
                      {w.endsAt ? t('maint.range', { from: when(w.startsAt, locale), to: when(w.endsAt, locale) }) : t('maint.fromOnly', { from: when(w.startsAt, locale) })}
                    </span>
                  </div>
                  <p className="w-msg">{pick(locale, w.messageEn, w.messageFr)}</p>
                  <p className="muted small">
                    {w.serviceCodes.length === 0 ? t('maint.scopeAll') : t('maint.scopeSome', { n: w.serviceCodes.length })}
                    {' · '}
                    {w.notifyCustomers ? (w.customersNotifiedAt ? t('maint.notified', { at: when(w.customersNotifiedAt, locale) }) : t('maint.willNotify', { n: w.notifyLeadMinutes })) : t('maint.noNotice')}
                  </p>
                  {canManage && p !== 'ended' && (
                    <button className="btn btn-danger btn-sm" onClick={() => end(w)}>
                      {p === 'live' ? t('maint.endNow') : t('maint.cancel')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="good-line">✓ {t('maint.allOpen')}</p>
        )}
      </section>

      {canManage && (
        <section className="card" aria-labelledby="new-window">
          <h2 id="new-window">{t('maint.new')}</h2>
          <form className="aform" onSubmit={create} noValidate>
            <div className="field">
              <span className="label">{t('maint.scope')}</span>
              <div className="seg">
                <button type="button" aria-pressed={scope === 'ALL'} onClick={() => setScope('ALL')}>{t('maint.scope.ALL')}</button>
                <button type="button" aria-pressed={scope === 'SERVICES'} onClick={() => setScope('SERVICES')}>{t('maint.scope.SERVICES')}</button>
              </div>
            </div>
            {scope === 'SERVICES' && (
              <fieldset className="roles">
                <legend>{t('maint.whichServices')}</legend>
                {byGroup.map(({ g, routes }) => (
                  <div key={g} className="svc-group">
                    <label className="check">
                      <input type="checkbox" checked={groups.includes(g)} onChange={(e) => setGroups(e.target.checked ? [...groups, g] : groups.filter((x) => x !== g))} />
                      <strong>{pick(locale, PRODUCT_GROUP_INFO[g].en, PRODUCT_GROUP_INFO[g].fr)}</strong>
                    </label>
                    {!groups.includes(g) && (
                      <div className="svc-codes">
                        {routes.map((r) => (
                          <label key={r.code} className="check small">
                            <input type="checkbox" checked={codes.includes(r.code)} onChange={(e) => setCodes(e.target.checked ? [...codes, r.code] : codes.filter((x) => x !== r.code))} />
                            {r.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <span className="hint">{t('maint.covered', { n: covered.size })}</span>
              </fieldset>
            )}
            <label className="check">
              <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> {t('maint.startNow')}
            </label>
            <div className="cols-2">
              {!startNow && (
                <div className="field">
                  <label htmlFor="m-start">{t('maint.startsAt')}</label>
                  <input id="m-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </div>
              )}
              <div className="field">
                <label htmlFor="m-end">{t('maint.endsAt')}</label>
                <input id="m-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                <span className="hint">{t('maint.endsHint')}</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="m-en">{t('maint.messageEn')}</label>
              <textarea id="m-en" rows={2} maxLength={300} value={messageEn} onChange={(e) => setMessageEn(e.target.value)} placeholder={t('maint.placeholderEn')} />
            </div>
            <div className="field">
              <label htmlFor="m-fr">{t('maint.messageFr')}</label>
              <textarea id="m-fr" rows={2} maxLength={300} value={messageFr} onChange={(e) => setMessageFr(e.target.value)} placeholder={t('maint.placeholderFr')} />
            </div>
            <label className="check">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {t('maint.notify')}
            </label>
            {notify && (
              <div className="field">
                <label htmlFor="m-lead">{t('maint.lead')}</label>
                <input id="m-lead" type="text" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ''))} />
                <span className="hint">{t('maint.leadHint')}</span>
              </div>
            )}
            <div className="field">
              <label htmlFor="m-reason">{t('common.reason')}</label>
              <input id="m-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? t('common.working') : startNow ? t('maint.submitNow') : t('maint.submitLater')}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
