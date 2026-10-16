/** Display helpers. They only format numbers the API computed; no money maths happens here. */
import { ASSET_META, type Asset } from '@amico/contracts';
import type { Locale } from '@/i18n/core';

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** 5000 → "5 000 FCFA" (Cameroon groups thousands with spaces in both languages). */
export function fcfa(amount: number): string {
  return `${nf.format(amount)} FCFA`;
}

export function num(n: number): string {
  return nf.format(n);
}

/** 237699112233 → 6 99 11 22 33 */
export function phone(msisdn: string): string {
  const local = msisdn.replace(/^\+?237/, '');
  return local.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5');
}

/** What the customer typed → 237XXXXXXXXX (the API validates it). */
export function toMsisdn(input: string): string {
  const d = input.replace(/\D/g, '');
  if (d.length === 9) return `237${d}`;
  if (d.length === 12 && d.startsWith('237')) return d;
  if (d.length === 14 && d.startsWith('00237')) return d.slice(2);
  return d;
}

export function localNumber(msisdn: string): string {
  return msisdn.replace(/^\+?237/, '');
}

export function dateTime(iso: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    timeZone: 'Africa/Douala',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function dateOnly(iso: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: 'Africa/Douala', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}

export type Operator = 'MTN' | 'ORANGE';

export function operatorOf(asset: string): Operator {
  return ASSET_META[asset as Asset]?.operator === 'ORANGE' ? 'ORANGE' : 'MTN';
}

export type AssetKind = 'money' | 'airtime' | 'data';

export function kindOf(asset: string): AssetKind {
  const k = ASSET_META[asset as Asset]?.kind;
  return k === 'MOBILE_MONEY' ? 'money' : k === 'AIRTIME' ? 'airtime' : 'data';
}

/** 2048 → "2 GB", 500 → "500 MB" */
export function dataSize(mb: number, locale: Locale): string {
  const unit = locale === 'fr' ? ['Mo', 'Go'] : ['MB', 'GB'];
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1).replace('.', locale === 'fr' ? ',' : '.')} ${unit[1]}`;
  }
  return `${mb} ${unit[0]}`;
}

/** Transaction states where nothing more will happen. */
export const TERMINAL = ['COMPLETED', 'REJECTED', 'REFUNDED'];

export type Tone = 'wait' | 'action' | 'good' | 'bad' | 'review';

export const STATE_TONE: Record<string, Tone> = {
  CREATED: 'wait',
  QUOTE_PENDING_CONFIRMATION: 'action',
  AWAITING_SOURCE_PAYMENT: 'action',
  PAYMENT_PROCESSING: 'wait',
  AWAITING_MANUAL_VERIFICATION: 'wait',
  SOURCE_VERIFIED: 'wait',
  PAYOUT_PROCESSING: 'wait',
  DELIVERY_PENDING: 'wait',
  COMPLETED: 'good',
  REJECTED: 'bad',
  FAILED: 'bad',
  REFUND_PENDING: 'review',
  REFUNDED: 'good',
  UNDER_REVIEW: 'review',
};

/** Which of the three steps (pay, check, deliver) a state has reached. */
export function stepOf(state: string): number {
  if (['AWAITING_SOURCE_PAYMENT', 'CREATED', 'QUOTE_PENDING_CONFIRMATION'].includes(state)) return 1;
  if (['PAYMENT_PROCESSING', 'AWAITING_MANUAL_VERIFICATION', 'UNDER_REVIEW'].includes(state)) return 2;
  if (['SOURCE_VERIFIED', 'PAYOUT_PROCESSING', 'DELIVERY_PENDING', 'FAILED', 'REFUND_PENDING'].includes(state)) return 3;
  return 4;
}
