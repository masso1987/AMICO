'use client';

import type { Locale, MessageKey, T } from '@/i18n/core';
import { DICTIONARIES } from '@/i18n/core';
import { ClientApiError } from './client';

/** Turns an API error into a sentence in the customer's language. */
export function errorText(e: unknown, t: T, locale: Locale): string {
  if (!(e instanceof ClientApiError)) return t('err.NETWORK');
  if (e.code === 'MAINTENANCE') {
    const d = e.details as { messageEn?: string; messageFr?: string } | undefined;
    const m = locale === 'fr' ? d?.messageFr : d?.messageEn;
    if (m) return m;
  }
  if (e.status === 429) return t('err.RATE_LIMITED');
  const key = `err.${e.code}` as MessageKey;
  if (key in DICTIONARIES.en) return t(key);
  if (e.code === 'VALIDATION_FAILED' && Array.isArray(e.details)) {
    const fields = (e.details as { path?: string }[]).map((d) => d.path ?? '').join(' ');
    if (/Msisdn|phone|recipient|sender/i.test(fields)) return t('err.BAD_NUMBER');
    return t('err.VALIDATION_FAILED');
  }
  return locale === 'en' ? e.message : t('err.GENERIC');
}
