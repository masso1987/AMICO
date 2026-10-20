'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n/core';
import { callApi, errorText } from '@/lib/client';

export interface SettingField { key: string; kind: 'bool' | 'int' | 'percentBps' | 'list' }

function toText(f: SettingField, v: unknown): string | boolean {
  if (f.kind === 'bool') return Boolean(v);
  if (f.kind === 'percentBps') return String(Number(v) / 100).replace('.', ',');
  if (f.kind === 'list') return (v as string[]).join(', ');
  return String(v);
}

export function SettingForm({ settingKey, value, fields, canEdit }: { settingKey: string; value: Record<string, unknown>; fields: SettingField[]; canEdit: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map((f) => [f.key, toText(f, value[f.key])])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = vals[f.key]!;
      if (f.kind === 'bool') out[f.key] = v;
      else if (f.kind === 'int') out[f.key] = Number(String(v).replace(/\s/g, ''));
      else if (f.kind === 'percentBps') out[f.key] = Math.round(Number(String(v).replace(',', '.')) * 100);
      else out[f.key] = String(v).split(/[\s,;]+/).filter(Boolean);
    }
    setBusy(true);
    try {
      await callApi(`admin/settings/${settingKey}`, { method: 'PATCH', body: JSON.stringify({ value: out, reason: reason.trim() }) });
      setReason('');
      setMsg({ ok: true, text: t('settings.saved') });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const k = (s: string) => `set.${settingKey}.${s}` as MessageKey;
  return (
    <section className="card">
      <h2>{t(k('title'))}</h2>
      <p className="muted small" style={{ marginTop: -6, marginBottom: 12 }}>{t(k('help'))}</p>
      <form className="aform" onSubmit={save} noValidate>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {fields.map((f) =>
            f.kind === 'bool' ? (
              <label key={f.key} className="check">
                <input type="checkbox" checked={Boolean(vals[f.key])} onChange={(e) => setVals({ ...vals, [f.key]: e.target.checked })} /> {t(k(f.key))}
              </label>
            ) : (
              <div key={f.key} className="field">
                <label htmlFor={`${settingKey}-${f.key}`}>{t(k(f.key))}</label>
                <input id={`${settingKey}-${f.key}`} type="text" inputMode={f.kind === 'list' ? 'text' : 'decimal'} value={String(vals[f.key])} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
              </div>
            ),
          )}
          {canEdit && (
            <div className="field">
              <label htmlFor={`${settingKey}-reason`}>{t('common.reason')}</label>
              <input id={`${settingKey}-reason`} type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
        </fieldset>
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
        {canEdit ? <button className="btn btn-primary" disabled={busy}>{busy ? t('common.working') : t('common.save')}</button> : <p className="muted small">{t('settings.readOnly')}</p>}
      </form>
    </section>
  );
}
