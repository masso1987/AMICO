'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PRODUCT_GROUP_INFO, type ProductGroup } from '@amico/contracts';
import { useI18n } from '@/i18n/client';
import { pick } from '@/i18n/core';
import { callApi, errorText } from '@/lib/client';
import { fcfa, when } from '@/lib/format';

export interface AdminOffer {
  id: string;
  titleEn: string;
  titleFr: string;
  bodyEn: string;
  bodyFr: string;
  operator: 'MTN' | 'ORANGE' | null;
  badgeEn: string | null;
  badgeFr: string | null;
  ctaKind: 'NONE' | 'BUNDLE' | 'SERVICE' | 'URL';
  ctaTarget: string | null;
  imageKey: string | null;
  startsAt: string;
  endsAt: string | null;
  sortOrder: number;
  active: boolean;
}
export interface BundleOption { id: string; operator: string; name: string; price: number; deletedAt?: string | null }

const GROUPS = Object.keys(PRODUCT_GROUP_INFO) as ProductGroup[];

/** datetime-local value in the browser's zone. */
function local(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function OfferEditor({ offer, bundles, onDone }: { offer?: AdminOffer; bundles: BundleOption[]; onDone?: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [f, setF] = useState({
    titleEn: offer?.titleEn ?? '',
    titleFr: offer?.titleFr ?? '',
    bodyEn: offer?.bodyEn ?? '',
    bodyFr: offer?.bodyFr ?? '',
    operator: offer?.operator ?? '',
    badgeEn: offer?.badgeEn ?? '',
    badgeFr: offer?.badgeFr ?? '',
    ctaKind: offer?.ctaKind ?? 'SERVICE',
    ctaTarget: offer?.ctaTarget ?? 'BUNDLES',
    startsAt: local(offer?.startsAt ?? null),
    endsAt: local(offer?.endsAt ?? null),
    sortOrder: String(offer?.sortOrder ?? 0),
    active: offer?.active ?? true,
    reason: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const body = {
        titleEn: f.titleEn.trim(), titleFr: f.titleFr.trim(), bodyEn: f.bodyEn.trim(), bodyFr: f.bodyFr.trim(),
        operator: f.operator || null, badgeEn: f.badgeEn.trim() || null, badgeFr: f.badgeFr.trim() || null,
        ctaKind: f.ctaKind, ctaTarget: f.ctaKind === 'NONE' ? null : f.ctaTarget.trim() || null,
        ...(f.startsAt ? { startsAt: new Date(f.startsAt).toISOString() } : {}),
        endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
        sortOrder: Number(f.sortOrder) || 0, active: f.active, reason: f.reason.trim(),
      };
      const saved = await callApi<{ id: string }>(offer ? `admin/offers/${offer.id}` : 'admin/offers', { method: offer ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      if (file) {
        const form = new FormData();
        form.append('file', file);
        await callApi(`admin/offers/${saved.id}/image`, { method: 'POST', body: form });
      }
      setMsg({ ok: true, text: offer ? t('offers.saved') : t('offers.created') });
      if (!offer) setF({ ...f, titleEn: '', titleFr: '', bodyEn: '', bodyFr: '', reason: '' });
      setFile(null);
      router.refresh();
      onDone?.();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const id = offer?.id ?? 'new';
  return (
    <form className="aform cols" onSubmit={submit} noValidate>
      <div className="field"><label htmlFor={`${id}-ten`}>{t('offers.titleEn')}</label><input id={`${id}-ten`} type="text" maxLength={80} value={f.titleEn} onChange={set('titleEn')} /></div>
      <div className="field"><label htmlFor={`${id}-tfr`}>{t('offers.titleFr')}</label><input id={`${id}-tfr`} type="text" maxLength={80} value={f.titleFr} onChange={set('titleFr')} /></div>
      <div className="field"><label htmlFor={`${id}-ben`}>{t('offers.bodyEn')}</label><textarea id={`${id}-ben`} rows={2} maxLength={240} value={f.bodyEn} onChange={set('bodyEn')} /></div>
      <div className="field"><label htmlFor={`${id}-bfr`}>{t('offers.bodyFr')}</label><textarea id={`${id}-bfr`} rows={2} maxLength={240} value={f.bodyFr} onChange={set('bodyFr')} /></div>
      <div className="field">
        <label htmlFor={`${id}-op`}>{t('offers.network')}</label>
        <select id={`${id}-op`} value={f.operator} onChange={set('operator')}>
          <option value="">{t('offers.bothNetworks')}</option>
          <option value="MTN">MTN</option>
          <option value="ORANGE">Orange</option>
        </select>
      </div>
      <div className="field"><label htmlFor={`${id}-sort`}>{t('offers.sort')}</label><input id={`${id}-sort`} type="text" inputMode="numeric" value={f.sortOrder} onChange={set('sortOrder')} /><span className="hint">{t('offers.sortHint')}</span></div>
      <div className="field"><label htmlFor={`${id}-bgen`}>{t('offers.badgeEn')}</label><input id={`${id}-bgen`} type="text" maxLength={24} value={f.badgeEn} onChange={set('badgeEn')} placeholder="Popular" /></div>
      <div className="field"><label htmlFor={`${id}-bgfr`}>{t('offers.badgeFr')}</label><input id={`${id}-bgfr`} type="text" maxLength={24} value={f.badgeFr} onChange={set('badgeFr')} placeholder="Populaire" /></div>
      <div className="field">
        <label htmlFor={`${id}-cta`}>{t('offers.button')}</label>
        <select id={`${id}-cta`} value={f.ctaKind} onChange={(e) => setF({ ...f, ctaKind: e.target.value as AdminOffer['ctaKind'], ctaTarget: e.target.value === 'SERVICE' ? 'BUNDLES' : e.target.value === 'BUNDLE' ? (bundles[0]?.id ?? '') : '' })}>
          {(['SERVICE', 'BUNDLE', 'URL', 'NONE'] as const).map((k) => <option key={k} value={k}>{t(`offers.cta.${k}` as 'offers.cta.NONE')}</option>)}
        </select>
      </div>
      <div className="field">
        {f.ctaKind === 'SERVICE' && (
          <>
            <label htmlFor={`${id}-tg`}>{t('offers.opens')}</label>
            <select id={`${id}-tg`} value={f.ctaTarget} onChange={set('ctaTarget')}>
              {GROUPS.map((g) => <option key={g} value={g}>{pick(locale, PRODUCT_GROUP_INFO[g].en, PRODUCT_GROUP_INFO[g].fr)}</option>)}
            </select>
          </>
        )}
        {f.ctaKind === 'BUNDLE' && (
          <>
            <label htmlFor={`${id}-tb`}>{t('offers.opens')}</label>
            <select id={`${id}-tb`} value={f.ctaTarget} onChange={set('ctaTarget')}>
              {bundles.filter((b) => !b.deletedAt).map((b) => <option key={b.id} value={b.id}>{b.operator} · {b.name} · {fcfa(b.price)}</option>)}
            </select>
          </>
        )}
        {f.ctaKind === 'URL' && (
          <>
            <label htmlFor={`${id}-tu`}>{t('offers.url')}</label>
            <input id={`${id}-tu`} type="text" placeholder="https://" value={f.ctaTarget} onChange={set('ctaTarget')} />
          </>
        )}
      </div>
      <div className="field"><label htmlFor={`${id}-st`}>{t('offers.startsAt')}</label><input id={`${id}-st`} type="datetime-local" value={f.startsAt} onChange={set('startsAt')} /><span className="hint">{t('offers.startsHint')}</span></div>
      <div className="field"><label htmlFor={`${id}-en`}>{t('offers.endsAt')}</label><input id={`${id}-en`} type="datetime-local" value={f.endsAt} onChange={set('endsAt')} /><span className="hint">{t('offers.endsHint')}</span></div>
      <div className="field">
        <label htmlFor={`${id}-img`}>{t('offers.image')}</label>
        <input id={`${id}-img`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <span className="hint">{t('offers.imageHint')}</span>
      </div>
      <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> {t('offers.active')}</label>
      <div className="field wide"><label htmlFor={`${id}-r`}>{t('common.reason')}</label><input id={`${id}-r`} type="text" value={f.reason} onChange={set('reason')} /></div>
      {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? t('common.working') : offer ? t('common.save') : t('offers.publish')}</button>
    </form>
  );
}

export function OfferRow({ offer, bundles, manage }: { offer: AdminOffer; bundles: BundleOption[]; manage: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const now = Date.now();
  const live = offer.active && new Date(offer.startsAt).getTime() <= now && (!offer.endsAt || new Date(offer.endsAt).getTime() > now);

  async function remove() {
    const reason = window.prompt(t('offers.deleteReason'));
    if (!reason || reason.trim().length < 5) return;
    try {
      await callApi(`admin/offers/${offer.id}`, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) });
      router.refresh();
    } catch (e) {
      setErr(errorText(e, t));
    }
  }

  return (
    <li className="offer-item">
      <div className="offer-line">
        <div className="thumb" style={offer.imageKey ? { backgroundImage: `url(/api/proxy/offers/${offer.id}/image?v=${offer.imageKey.slice(0, 8)})` } : undefined} aria-hidden />
        <div className="grow">
          <strong>{pick(locale, offer.titleEn, offer.titleFr)}</strong>
          <div className="muted small">
            <span className={`badge ${live ? 'tone-good' : ''}`}>{live ? t('offers.live') : offer.active ? t('offers.scheduled') : t('offers.hidden')}</span>{' '}
            {offer.operator ?? t('offers.bothNetworks')} · {t(`offers.cta.${offer.ctaKind}` as 'offers.cta.NONE')}
            {offer.endsAt ? ` · ${t('offers.until', { at: when(offer.endsAt, locale) })}` : ''}
          </div>
        </div>
        {manage && (
          <span className="row-actions">
            <button className="btn btn-quiet btn-sm" onClick={() => setOpen((o) => !o)}>{open ? t('common.close') : t('common.edit')}</button>
            <button className="btn btn-danger btn-sm" onClick={remove}>{t('common.delete')}</button>
          </span>
        )}
      </div>
      {err && <p className="msg err">{err}</p>}
      {open && <div className="offer-edit"><OfferEditor offer={offer} bundles={bundles} onDone={() => setOpen(false)} /></div>}
    </li>
  );
}
