/** Display helpers only. Every amount shown was computed by the API. */

const nf = new Intl.NumberFormat('fr-CM', { maximumFractionDigits: 0 });

export const fcfa = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${nf.format(n)} FCFA`);
export const num = (n: number) => nf.format(n);

export function phone(msisdn: string | null | undefined): string {
  if (!msisdn) return '—';
  const local = msisdn.startsWith('237') ? msisdn.slice(3) : msisdn;
  return local.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5');
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Douala' }).format(new Date(iso));
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export const ASSET_LABEL: Record<string, string> = {
  MTN_MOMO: 'MTN MoMo',
  ORANGE_MONEY: 'Orange Money',
  MTN_AIRTIME: 'MTN airtime',
  ORANGE_AIRTIME: 'Orange airtime',
  MTN_DATA: 'MTN data',
  ORANGE_DATA: 'Orange data',
};

export type Tone = 'neutral' | 'wait' | 'good' | 'bad' | 'review';

/** Staff see the exact state name plus a tone, so nothing is hidden behind friendly wording. */
export const STATE_TONE: Record<string, Tone> = {
  CREATED: 'neutral',
  QUOTE_PENDING_CONFIRMATION: 'neutral',
  AWAITING_SOURCE_PAYMENT: 'wait',
  PAYMENT_PROCESSING: 'wait',
  AWAITING_MANUAL_VERIFICATION: 'wait',
  SOURCE_VERIFIED: 'wait',
  PAYOUT_PROCESSING: 'wait',
  DELIVERY_PENDING: 'wait',
  COMPLETED: 'good',
  REFUNDED: 'good',
  REJECTED: 'bad',
  FAILED: 'bad',
  REFUND_PENDING: 'review',
  UNDER_REVIEW: 'review',
  // verification statuses
  PENDING: 'wait',
  AWAITING_SECOND_APPROVAL: 'review',
  ON_HOLD: 'review',
  ESCALATED: 'review',
  CONFIRMED: 'good',
  AWAITING_CUSTOMER_REFERENCE: 'neutral',
  // rules / refunds
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'review',
  ACTIVE: 'good',
  RETIRED: 'neutral',
  REQUESTED: 'review',
  APPROVED: 'wait',
  PROCESSING: 'wait',
  ENABLED: 'good',
  DISABLED: 'neutral',
};

export const pretty = (code: string) => code.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
