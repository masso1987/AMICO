'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { pick } from '@/i18n/core';
import { callApi, errorText } from '@/lib/client';
import { fcfa, when } from '@/lib/format';

export interface AdminBundle {
  id: string;
  operator: 'MTN' | 'ORANGE';
  providerCode: string;
  productId: string;
  name: string;
  nameFr: string | null;
  description: string | null;
  category: 'DATA' | 'VOICE' | 'SMS' | 'COMBO';
  validity: 'DAY' | 'WEEK' | 'MONTH' | 'OTHER';
  validityDays: number;
  price: number;
  dataMb: number | null;
  voiceMinutes: number | null;
  smsCount: number | null;
  source: 'PROVIDER' | 'STAFF';
  active: boolean;
  featured: boolean;
  staffEdited: boolean;
  withdrawnAt: string | null;
  lastSyncedAt: string | null;
  _count?: { transactions: number };
}

function contents(b: AdminBundle) {
  const p: string[] = [];
  if (b.dataMb) p.push(b.dataMb >= 1024 ? `${Math.round((b.dataMb / 1024) * 10) / 10} GB` : `${b.dataMb} MB`);
  if (b.voiceMinutes) p.push(`${b.voiceMinutes} min`);
  if (b.smsCount) p.push(`${b.smsCount} SMS`);
  return p.join(' · ') || '—';
}

export function BundleEditor({ bundle, onDone }: { bundle?: AdminBundle; onDone?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({
    operator: bundle?.operator ?? 'MTN',
    productId: bundle?.productId ?? '',
    name: bundle?.name ?? '',
    nameFr: bundle?.nameFr ?? '',
    description: bundle?.description ?? '',
    category: bundle?.category ?? 'DATA',
    validity: bundle?.validity ?? 'WEEK',
    validityDays: String(bundle?.validityDays ?? 7),
    price: String(bundle?.price ?? ''),
    dataMb: bundle?.dataMb != null ? String(bundle.dataMb) : '',
    voiceMinutes: bundle?.voiceMinutes != null ? String(bundle.voiceMinutes) : '',
    smsCount: bundle?.smsCount != null ? String(bundle.smsCount) : '',
    active: bundle?.active ?? true,
    featured: bundle?.featured ?? false,
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const int = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\s/g, '')));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: f.name.trim(), nameFr: f.nameFr.trim() || null, description: f.description.trim() || null,
        category: f.category, validity: f.validity, validityDays: int(f.validityDays), price: int(f.price),
        dataMb: int(f.dataMb), voiceMinutes: int(f.voiceMinutes), smsCount: int(f.smsCount),
        active: f.active, featured: f.featured, reason: f.reason.trim(),
      };
      if (!bundle) Object.assign(body, { operator: f.operator, productId: f.productId.trim() });
      await callApi(bundle ? `admin/bundles/${bundle.id}` : 'admin/bundles', { method: bundle ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setMsg({ ok: true, text: bundle ? t('bundles.saved') : t('bundles.created') });
      router.refresh();
      onDone?.();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const id = bundle?.id ?? 'new';
  return (
    <form className="aform cols" onSubmit={submit} noValidate>
      {!bundle && (
        <>
          <div className="field">
            <label htmlFor={`${id}-op`}>{t('bundles.network')}</label>
            <select id={`${id}-op`} value={f.operator} onChange={set('operator')}>
              <option value="MTN">MTN</option>
              <option value="ORANGE">Orange</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-pid`}>{t('bundles.productId')}</label>
            <input id={`${id}-pid`} type="text" value={f.productId} onChange={set('productId')} />
            <span className="hint">{t('bundles.productIdHint')}</span>
          </div>
        </>
      )}
      <div className="field"><label htmlFor={`${id}-n`}>{t('bundles.nameEn')}</label><input id={`${id}-n`} type="text" value={f.name} onChange={set('name')} /></div>
      <div className="field"><label htmlFor={`${id}-nf`}>{t('bundles.nameFr')}</label><input id={`${id}-nf`} type="text" value={f.nameFr} onChange={set('nameFr')} /></div>
      <div className="field">
        <label htmlFor={`${id}-c`}>{t('bundles.category')}</label>
        <select id={`${id}-c`} value={f.category} onChange={set('category')}>
          {(['DATA', 'VOICE', 'SMS', 'COMBO'] as const).map((c) => <option key={c} value={c}>{t(`category.${c}` as 'category.DATA')}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-v`}>{t('bundles.validity')}</label>
        <select id={`${id}-v`} value={f.validity} onChange={set('validity')}>
          {(['DAY', 'WEEK', 'MONTH', 'OTHER'] as const).map((v) => <option key={v} value={v}>{t(`validity.${v}` as 'validity.DAY')}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor={`${id}-vd`}>{t('bundles.validityDays')}</label><input id={`${id}-vd`} type="text" inputMode="numeric" value={f.validityDays} onChange={set('validityDays')} /></div>
      <div className="field"><label htmlFor={`${id}-p`}>{t('bundles.price')}</label><input id={`${id}-p`} type="text" inputMode="numeric" value={f.price} onChange={set('price')} /></div>
      <div className="field"><label htmlFor={`${id}-d`}>{t('bundles.dataMb')}</label><input id={`${id}-d`} type="text" inputMode="numeric" value={f.dataMb} onChange={set('dataMb')} /><span className="hint">{t('bundles.dataHint')}</span></div>
      <div className="field"><label htmlFor={`${id}-vm`}>{t('bundles.minutes')}</label><input id={`${id}-vm`} type="text" inputMode="numeric" value={f.voiceMinutes} onChange={set('voiceMinutes')} /></div>
      <div className="field"><label htmlFor={`${id}-s`}>{t('bundles.sms')}</label><input id={`${id}-s`} type="text" inputMode="numeric" value={f.smsCount} onChange={set('smsCount')} /></div>
      <div className="field wide"><label htmlFor={`${id}-desc`}>{t('bundles.description')}</label><textarea id={`${id}-desc`} rows={2} maxLength={500} value={f.description} onChange={set('description')} /></div>
      <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> {t('bundles.activeLabel')}</label>
      <label className="check"><input type="checkbox" checked={f.featured} onChange={set('featured')} /> {t('bundles.featuredLabel')}</label>
      {bundle?.source === 'PROVIDER' && <p className="note wide">{t('bundles.providerNote')}</p>}
      <div className="field wide"><label htmlFor={`${id}-r`}>{t('common.reason')}</label><input id={`${id}-r`} type="text" value={f.reason} onChange={set('reason')} /></div>
      {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? t('common.working') : bundle ? t('common.save') : t('bundles.add')}</button>
    </form>
  );
}

export function BundleRow({ bundle: b, manage }: { bundle: AdminBundle; manage: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    const reason = window.prompt(t('bundles.deleteReason'));
    if (!reason || reason.trim().length < 5) return;
    try {
      await callApi(`admin/bundles/${b.id}`, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) });
      router.refresh();
    } catch (e) {
      setErr(errorText(e, t));
    }
  }

  return (
    <Fragment>
      <tr>
        <td>
          <span className={`op-tag ${b.operator}`}>{b.operator === 'MTN' ? 'MTN' : 'Orange'}</span> <strong>{pick(locale, b.name, b.nameFr)}</strong>
          <div className="sub mono">{b.productId} · {b.source === 'PROVIDER' ? t('bundles.fromProvider', { p: b.providerCode }) : t('bundles.addedByStaff')}</div>
        </td>
        <td>{contents(b)}<div className="sub">{t(`category.${b.category}` as 'category.DATA')}</div></td>
        <td>{t('bundles.days', { n: b.validityDays })}</td>
        <td className="num">{fcfa(b.price)}</td>
        <td>
          {b.withdrawnAt ? <span className="badge tone-bad">{t('bundles.withdrawn')}</span> : b.active ? <span className="badge tone-good">{t('bundles.onSale')}</span> : <span className="badge">{t('bundles.hidden')}</span>}
          {b.featured && <span className="badge tone-review" style={{ marginLeft: 4 }}>{t('bundles.featured')}</span>}
          {b.lastSyncedAt && <div className="sub">{t('bundles.synced', { at: when(b.lastSyncedAt, locale) })}</div>}
        </td>
        <td>{b._count?.transactions ?? 0}</td>
        {manage && (
          <td className="nowrap">
            <button className="btn btn-quiet btn-sm" onClick={() => setOpen((o) => !o)}>{open ? t('common.close') : t('common.edit')}</button>{' '}
            <button className="btn btn-danger btn-sm" onClick={remove}>{t('common.delete')}</button>
          </td>
        )}
      </tr>
      {(open || err) && (
        <tr>
          <td colSpan={manage ? 7 : 6} className="edit-cell">
            {err && <p className="msg err">{err}</p>}
            {open && <BundleEditor bundle={b} onDone={() => setOpen(false)} />}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function SyncButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  async function sync() {
    setBusy(true);
    setOut(null);
    try {
      const r = await callApi<Array<{ operator: string; added: number; updated: number; priceChanged: number; withdrawn: number; note?: string }>>('admin/bundles/sync', { method: 'POST', body: JSON.stringify({ reason: 'Manual sync from the admin' }) });
      setOut(r.map((s) => (s.note ? `${s.operator}: ${s.note}` : t('bundles.syncResult', { op: s.operator, added: s.added, updated: s.updated, price: s.priceChanged, withdrawn: s.withdrawn }))).join(' · '));
      router.refresh();
    } catch (e) {
      setOut(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="sync">
      <button className="btn btn-quiet" onClick={sync} disabled={busy}>{busy ? t('common.working') : t('bundles.sync')}</button>
      {out && <span className="small muted">{out}</span>}
    </span>
  );
}
