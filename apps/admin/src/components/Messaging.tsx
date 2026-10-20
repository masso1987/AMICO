'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROUTE_DEFINITIONS } from '@amico/contracts';
import { useI18n } from '@/i18n/client';
import { pick } from '@/i18n/core';
import { callApi, errorText } from '@/lib/client';
import { when } from '@/lib/format';
import { componentLabel } from '@/lib/labels';

interface FieldSpec { key: string; en: string; fr: string; hintEn?: string; hintFr?: string; kind: 'text' | 'select' | 'textarea'; options?: string[] }
export interface Channel {
  channel: 'SMS_MTN' | 'SMS_ORANGE' | 'WHATSAPP';
  enabled: boolean;
  live: boolean;
  driver: string;
  drivers: Array<{ kind: string; label: string; secretFields: string[]; fields: FieldSpec[] }>;
  settings: Record<string, unknown>;
  secretsSet: Record<string, boolean>;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

const SECRET_LABEL: Record<string, { en: string; fr: string }> = {
  clientId: { en: 'Client ID', fr: 'Client ID' },
  clientSecret: { en: 'Client secret', fr: 'Secret client' },
  authValue: { en: 'Auth header value (API key)', fr: 'Valeur de l’en-tête (clé API)' },
  accessToken: { en: 'Access token', fr: 'Jeton d’accès' },
};

function toMsisdn(v: string) {
  const d = v.replace(/\D/g, '');
  return d.length === 9 ? `237${d}` : d;
}

/** One gateway: driver, settings, write-only secrets, live/test switch and a test send. */
export function GatewayCard({ channel }: { channel: Channel }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [driver, setDriver] = useState(channel.driver);
  const [enabled, setEnabled] = useState(channel.enabled);
  const [live, setLive] = useState(channel.live);
  const [settings, setSettings] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(channel.settings).map(([k, v]) => [k, String(v ?? '')])));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const spec = channel.drivers.find((d) => d.kind === driver) ?? channel.drivers[0]!;
  const sameDriver = driver === channel.driver;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (reason.trim().length < 5) return setMsg({ ok: false, text: t('common.reasonNeeded') });
    if (live && !channel.live && !window.confirm(t('gw.confirmLive'))) return;
    setBusy('save');
    try {
      const filled = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim()));
      const cleanSettings = Object.fromEntries(spec.fields.map((f) => [f.key, settings[f.key] ?? '']).filter(([, v]) => v !== ''));
      await callApi(`admin/messaging/channels/${channel.channel}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled, live, driver, settings: cleanSettings, ...(Object.keys(filled).length ? { secrets: filled } : {}), reason: reason.trim() }),
      });
      setSecrets({});
      setReason('');
      setMsg({ ok: true, text: t('gw.saved') });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setMsg(null);
    if (toMsisdn(to).length !== 12) return setMsg({ ok: false, text: t('err.BAD_NUMBER') });
    setBusy('test');
    try {
      const r = await callApi<{ ok: boolean; live: boolean; error: string | null }>(`admin/messaging/channels/${channel.channel}/test`, { method: 'POST', body: JSON.stringify({ to: toMsisdn(to) }) });
      setMsg(r.ok ? { ok: true, text: r.live ? t('gw.testSent') : t('gw.testMode') } : { ok: false, text: t('gw.testFailed', { error: r.error ?? '' }) });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card gateway" aria-labelledby={`gw-${channel.channel}`}>
      <div className="row-between">
        <h2 id={`gw-${channel.channel}`}>
          <span className={`op-dot ${channel.channel}`} aria-hidden /> {componentLabel(t, `MESSAGING:${channel.channel}`, channel.channel)}
        </h2>
        <span>
          <span className={`badge ${channel.enabled ? 'tone-good' : ''}`}>{channel.enabled ? t('gw.on') : t('gw.off')}</span>{' '}
          <span className={`badge ${channel.live ? 'tone-bad' : 'tone-wait'}`}>{channel.live ? t('gw.live') : t('gw.test')}</span>
        </span>
      </div>
      {channel.lastTestAt && (
        <p className={`small ${channel.lastTestOk ? 'good-text' : 'bad-text'}`}>
          {channel.lastTestOk ? t('gw.lastTestOk', { at: when(channel.lastTestAt, locale) }) : t('gw.lastTestBad', { at: when(channel.lastTestAt, locale), error: channel.lastTestError ?? '' })}
        </p>
      )}
      <form className="aform cols" onSubmit={save} noValidate>
        {channel.drivers.length > 1 && (
          <div className="field">
            <label htmlFor={`d-${channel.channel}`}>{t('gw.driver')}</label>
            <select id={`d-${channel.channel}`} value={driver} onChange={(e) => setDriver(e.target.value)}>
              {channel.drivers.map((d) => (
                <option key={d.kind} value={d.kind}>{d.label}</option>
              ))}
            </select>
          </div>
        )}
        {channel.drivers.length === 1 && (
          <div className="field">
            <span className="label">{t('gw.driver')}</span>
            <span>{spec.label}</span>
          </div>
        )}
        {spec.fields.map((f) => (
          <div key={f.key} className={`field${f.kind === 'textarea' ? ' wide' : ''}`}>
            <label htmlFor={`${channel.channel}-${f.key}`}>{pick(locale, f.en, f.fr)}</label>
            {f.kind === 'select' ? (
              <select id={`${channel.channel}-${f.key}`} value={settings[f.key] ?? f.options?.[0] ?? ''} onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}>
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.kind === 'textarea' ? (
              <textarea id={`${channel.channel}-${f.key}`} rows={3} value={settings[f.key] ?? ''} onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })} />
            ) : (
              <input id={`${channel.channel}-${f.key}`} type="text" value={settings[f.key] ?? ''} onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })} />
            )}
            {(f.hintEn || f.hintFr) && <span className="hint">{pick(locale, f.hintEn ?? '', f.hintFr ?? '')}</span>}
          </div>
        ))}
        {spec.secretFields.map((k) => (
          <div key={k} className="field">
            <label htmlFor={`${channel.channel}-s-${k}`}>{pick(locale, SECRET_LABEL[k]?.en ?? k, SECRET_LABEL[k]?.fr ?? k)}</label>
            <input id={`${channel.channel}-s-${k}`} type="password" autoComplete="new-password" value={secrets[k] ?? ''} onChange={(e) => setSecrets({ ...secrets, [k]: e.target.value })} placeholder={sameDriver && channel.secretsSet[k] ? t('gw.secretKept') : t('gw.secretMissing')} />
          </div>
        ))}
        <div className="field wide switches">
          <label className="check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t('gw.enable')}
          </label>
          <label className="check">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> {t('gw.liveLabel')}
          </label>
          <span className="hint">{t('gw.liveHint')}</span>
        </div>
        <div className="field wide">
          <label htmlFor={`${channel.channel}-reason`}>{t('common.reason')}</label>
          <input id={`${channel.channel}-reason`} type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
        <div className="btn-row wide">
          <button className="btn btn-primary" type="submit" disabled={busy !== null}>
            {busy === 'save' ? t('common.working') : t('common.save')}
          </button>
          <span className="test-send">
            <input type="tel" inputMode="numeric" placeholder="6XX XX XX XX" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('gw.testTo')} />
            <button className="btn btn-quiet" type="button" onClick={test} disabled={busy !== null}>
              {busy === 'test' ? t('common.working') : t('gw.sendTest')}
            </button>
          </span>
        </div>
      </form>
    </section>
  );
}

/** One message to one number. */
export function DirectSend() {
  const { t } = useI18n();
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState('SMS');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (toMsisdn(to).length !== 12) return setMsg({ ok: false, text: t('err.BAD_NUMBER') });
    setBusy(true);
    try {
      await callApi('admin/messaging/send', { method: 'POST', body: JSON.stringify({ to: toMsisdn(to), body: body.trim(), channel }) });
      setMsg({ ok: true, text: t('send.queued') });
      setBody('');
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card narrow">
      <h2>{t('send.title')}</h2>
      <form className="aform" onSubmit={send} noValidate>
        <div className="field">
          <label htmlFor="ds-to">{t('send.to')}</label>
          <input id="ds-to" type="tel" inputMode="numeric" placeholder="6XX XX XX XX" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ds-ch">{t('send.channel')}</label>
          <select id="ds-ch" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {['SMS', 'WHATSAPP_THEN_SMS', 'SMS_MTN', 'SMS_ORANGE', 'WHATSAPP'].map((c) => (
              <option key={c} value={c}>{t(`send.ch.${c}` as 'send.ch.SMS')}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ds-body">{t('send.body')}</label>
          <textarea id="ds-body" rows={4} maxLength={640} value={body} onChange={(e) => setBody(e.target.value)} />
          <span className="hint">{t('send.count', { n: body.length, sms: Math.max(1, Math.ceil(body.length / 160)) })}</span>
        </div>
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? t('common.working') : t('send.submit')}
        </button>
      </form>
    </section>
  );
}

type AudienceKind = 'ALL' | 'ACTIVE_30D' | 'OPEN_TRANSACTIONS' | 'SERVICE_USERS' | 'NUMBERS';

/** Bulk SMS / WhatsApp in both languages: each customer gets their own language. */
export function BroadcastForm() {
  const { t } = useI18n();
  const [kind, setKind] = useState<AudienceKind>('ACTIVE_30D');
  const [codes, setCodes] = useState<string[]>([]);
  const [numbers, setNumbers] = useState('');
  const [channel, setChannel] = useState<'AUTO' | 'SMS' | 'WHATSAPP'>('AUTO');
  const [bodyEn, setBodyEn] = useState('');
  const [bodyFr, setBodyFr] = useState('');
  const [preview, setPreview] = useState<{ recipients: number; french: number; whatsapp: number } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function audience() {
    if (kind === 'SERVICE_USERS') return { kind, serviceCodes: codes };
    if (kind === 'NUMBERS') return { kind, numbers: [...new Set(numbers.split(/[\s,;]+/).map(toMsisdn).filter((n) => n.length === 12))] };
    return { kind };
  }

  async function doPreview() {
    setMsg(null);
    setBusy('preview');
    try {
      setPreview(await callApi('admin/messaging/broadcasts/preview', { method: 'POST', body: JSON.stringify({ audience: audience() }) }));
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(null);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!preview) return setMsg({ ok: false, text: t('bc.previewFirst') });
    if (!window.confirm(t('bc.confirm', { n: preview.recipients }))) return;
    setBusy('send');
    try {
      const b = await callApi<{ recipients: number }>('admin/messaging/broadcasts', { method: 'POST', body: JSON.stringify({ audience: audience(), channel, bodyEn: bodyEn.trim(), bodyFr: bodyFr.trim() }) });
      setMsg({ ok: true, text: t('bc.sent', { n: b.recipients }) });
      setPreview(null);
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <h2>{t('bc.title')}</h2>
      <form className="aform" onSubmit={send} noValidate>
        <div className="field">
          <label htmlFor="bc-aud">{t('bc.audience')}</label>
          <select id="bc-aud" value={kind} onChange={(e) => { setKind(e.target.value as AudienceKind); setPreview(null); }}>
            {(['ALL', 'ACTIVE_30D', 'OPEN_TRANSACTIONS', 'SERVICE_USERS', 'NUMBERS'] as const).map((k) => (
              <option key={k} value={k}>{t(`bc.aud.${k}` as 'bc.aud.ALL')}</option>
            ))}
          </select>
        </div>
        {kind === 'SERVICE_USERS' && (
          <fieldset className="roles">
            <legend>{t('bc.services')}</legend>
            <div className="svc-codes">
              {ROUTE_DEFINITIONS.map((r) => (
                <label key={r.code} className="check small">
                  <input type="checkbox" checked={codes.includes(r.code)} onChange={(e) => { setCodes(e.target.checked ? [...codes, r.code] : codes.filter((c) => c !== r.code)); setPreview(null); }} />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {kind === 'NUMBERS' && (
          <div className="field">
            <label htmlFor="bc-num">{t('bc.numbers')}</label>
            <textarea id="bc-num" rows={3} value={numbers} onChange={(e) => { setNumbers(e.target.value); setPreview(null); }} placeholder="670000000, 690000000" />
          </div>
        )}
        <div className="field">
          <label htmlFor="bc-ch">{t('bc.channel')}</label>
          <select id="bc-ch" value={channel} onChange={(e) => setChannel(e.target.value as 'AUTO')}>
            {(['AUTO', 'SMS', 'WHATSAPP'] as const).map((c) => (
              <option key={c} value={c}>{t(`bc.ch.${c}` as 'bc.ch.AUTO')}</option>
            ))}
          </select>
        </div>
        <div className="cols-2">
          <div className="field">
            <label htmlFor="bc-en">{t('bc.bodyEn')}</label>
            <textarea id="bc-en" rows={4} maxLength={640} value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} />
            <span className="hint">{t('send.count', { n: bodyEn.length, sms: Math.max(1, Math.ceil(bodyEn.length / 160)) })}</span>
          </div>
          <div className="field">
            <label htmlFor="bc-fr">{t('bc.bodyFr')}</label>
            <textarea id="bc-fr" rows={4} maxLength={640} value={bodyFr} onChange={(e) => setBodyFr(e.target.value)} />
            <span className="hint">{t('send.count', { n: bodyFr.length, sms: Math.max(1, Math.ceil(bodyFr.length / 160)) })}</span>
          </div>
        </div>
        {preview && (
          <p className="note info">{t('bc.preview', { n: preview.recipients, fr: preview.french, en: preview.recipients - preview.french, wa: preview.whatsapp })}</p>
        )}
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-quiet" onClick={doPreview} disabled={busy !== null}>
            {busy === 'preview' ? t('common.working') : t('bc.countRecipients')}
          </button>
          <button className="btn btn-primary" disabled={busy !== null || !preview || preview.recipients === 0}>
            {busy === 'send' ? t('common.working') : t('bc.send')}
          </button>
        </div>
      </form>
    </section>
  );
}
