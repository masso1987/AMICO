'use client';

import { useI18n } from '@/i18n/client';
import { pick, type MessageKey } from '@/i18n/core';
import { dataSize, fcfa } from '@/lib/format';
import type { Bundle } from '@/lib/products';

export function bundleFacts(b: Bundle, t: (k: MessageKey, v?: Record<string, string | number>) => string, locale: 'en' | 'fr'): string {
  const parts: string[] = [];
  if (b.dataMb) parts.push(dataSize(b.dataMb, locale));
  if (b.voiceMinutes) parts.push(t('bundle.minutes', { n: b.voiceMinutes }));
  if (b.smsCount) parts.push(t('bundle.sms', { n: b.smsCount }));
  return parts.join(' · ');
}

export function validityText(b: Pick<Bundle, 'validity' | 'validityDays'>, t: (k: MessageKey, v?: Record<string, string | number>) => string): string {
  if (b.validityDays === 1) return t('bundle.oneDay');
  if (b.validityDays) return t('bundle.days', { n: b.validityDays });
  return t(`validity.${b.validity}` as MessageKey);
}

/** One bundle tile. As a button when selectable, otherwise a link. */
export function BundleCard({ bundle, selected, onSelect, href }: { bundle: Bundle; selected?: boolean; onSelect?: () => void; href?: string }) {
  const { t, locale } = useI18n();
  const inner = (
    <>
      <div className="top">
        <span className={`op-tag ${bundle.operator}`}>{bundle.operator === 'MTN' ? 'MTN' : 'Orange'}</span>
        <span className="validity">{validityText(bundle, t)}</span>
      </div>
      <span className="name">{pick(locale, bundle.name, bundle.nameFr)}</span>
      <span className="facts">{bundleFacts(bundle, t, locale) || t(`category.${bundle.category}` as MessageKey)}</span>
      <span className="price money">{fcfa(bundle.price)}</span>
    </>
  );
  if (href) {
    return (
      <a className="bundle" href={href}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className="bundle" aria-pressed={selected} onClick={onSelect}>
      {inner}
    </button>
  );
}
