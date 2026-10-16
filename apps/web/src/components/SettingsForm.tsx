'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import type { Locale } from '@/i18n/core';
import { callApi } from '@/lib/client';
import { errorText } from '@/lib/errors';
import { dateOnly, phone } from '@/lib/format';
import type { Me } from '@/lib/me';

export function SettingsForm({ me }: { me: Me }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [fullName, setFullName] = useState(me.fullName);
  const [lang, setLang] = useState<Locale>(me.locale);
  const [smsOptIn, setSms] = useState(me.smsOptIn);
  const [whatsappOptIn, setWa] = useState(me.whatsappOptIn);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const patch: Record<string, unknown> = {};
    if (fullName.trim() !== me.fullName) patch.fullName = fullName.trim();
    if (smsOptIn !== me.smsOptIn) patch.smsOptIn = smsOptIn;
    if (whatsappOptIn !== me.whatsappOptIn) patch.whatsappOptIn = whatsappOptIn;
    const langChanged = lang !== locale || lang !== me.locale;
    if (!Object.keys(patch).length && !langChanged) return setMsg({ ok: true, text: t('settings.nothing') });
    if (patch.fullName !== undefined && String(patch.fullName).length < 2) return setMsg({ ok: false, text: t('auth.err.name') });
    setBusy(true);
    try {
      if (Object.keys(patch).length) await callApi('auth/customer/me', { method: 'PATCH', body: JSON.stringify(patch) });
      // The language route saves it on the profile too, and switches this browser.
      if (langChanged) await fetch('/api/lang', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: lang }) });
      setMsg({ ok: true, text: lang === 'fr' ? 'Vos préférences sont enregistrées.' : 'Your preferences are saved.' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t, locale) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-2">
      <form className="panel" onSubmit={save} noValidate>
        {msg && (
          <div className={`alert ${msg.ok ? 'alert-good' : 'alert-error'}`} role={msg.ok ? 'status' : 'alert'}>
            {msg.text}
          </div>
        )}
        <div className="field">
          <label htmlFor="name">{t('auth.fullName')}</label>
          <input className="input" id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </div>
        <div className="field">
          <span className="label" id="lang-label">
            {t('settings.language')}
          </span>
          <div className="segmented" role="group" aria-labelledby="lang-label">
            <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">
              English
            </button>
            <button type="button" aria-pressed={lang === 'fr'} onClick={() => setLang('fr')} lang="fr">
              Français
            </button>
          </div>
          <span className="hint">{t('settings.languageHint')}</span>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 18px' }}>
          <legend className="label" style={{ marginBottom: 8, fontWeight: 600 }}>
            {t('settings.announcements')}
          </legend>
          <label className="check" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={smsOptIn} onChange={(e) => setSms(e.target.checked)} />
            <span>{t('settings.sms')}</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={whatsappOptIn} onChange={(e) => setWa(e.target.checked)} />
            <span>{t('settings.whatsapp')}</span>
          </label>
          <span className="hint" style={{ marginTop: 8 }}>
            {t('settings.transactional')}
          </span>
        </fieldset>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? t('common.wait') : t('settings.save')}
        </button>
      </form>
      <aside className="panel">
        <dl className="kv">
          <dt>{t('auth.phone')}</dt>
          <dd>+237 {phone(me.phone)}</dd>
          <dt>{t('settings.memberSince')}</dt>
          <dd>{dateOnly(me.createdAt, locale)}</dd>
        </dl>
        <p className="hint" style={{ marginTop: 14 }}>
          {t('settings.phoneHint')}
        </p>
      </aside>
    </div>
  );
}
