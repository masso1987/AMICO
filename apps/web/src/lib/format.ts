/** Display helpers. They only format numbers the API computed; no money maths happens here. */

const nf = new Intl.NumberFormat('fr-CM', { maximumFractionDigits: 0 });

export function fcfa(amount: number): string {
  return `${nf.format(amount)} FCFA`;
}

/** 237699112233 → 6 99 11 22 33 */
export function phone(msisdn: string): string {
  const local = msisdn.startsWith('237') ? msisdn.slice(3) : msisdn;
  return local.replace(/^(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5');
}

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export type Operator = 'MTN' | 'ORANGE';

export const ASSETS: Record<string, { operator: Operator; kind: 'money' | 'airtime' | 'data'; label: string; short: string }> = {
  MTN_MOMO: { operator: 'MTN', kind: 'money', label: 'MTN Mobile Money', short: 'MoMo' },
  ORANGE_MONEY: { operator: 'ORANGE', kind: 'money', label: 'Orange Money', short: 'Orange Money' },
  MTN_AIRTIME: { operator: 'MTN', kind: 'airtime', label: 'MTN airtime', short: 'MTN airtime' },
  ORANGE_AIRTIME: { operator: 'ORANGE', kind: 'airtime', label: 'Orange airtime', short: 'Orange airtime' },
  MTN_DATA: { operator: 'MTN', kind: 'data', label: 'MTN data bundle', short: 'MTN data' },
  ORANGE_DATA: { operator: 'ORANGE', kind: 'data', label: 'Orange data bundle', short: 'Orange data' },
};

/** What each transaction state means to the customer, in plain words. */
export const STATE_COPY: Record<string, { title: string; tone: 'wait' | 'action' | 'good' | 'bad' | 'review' }> = {
  CREATED: { title: 'Starting', tone: 'wait' },
  QUOTE_PENDING_CONFIRMATION: { title: 'Waiting for your confirmation', tone: 'action' },
  AWAITING_SOURCE_PAYMENT: { title: 'Waiting for your payment', tone: 'action' },
  PAYMENT_PROCESSING: { title: 'Confirming your payment', tone: 'wait' },
  AWAITING_MANUAL_VERIFICATION: { title: 'Checking your airtime transfer', tone: 'wait' },
  SOURCE_VERIFIED: { title: 'Payment received', tone: 'wait' },
  PAYOUT_PROCESSING: { title: 'Sending to the recipient', tone: 'wait' },
  DELIVERY_PENDING: { title: 'Confirming delivery', tone: 'wait' },
  COMPLETED: { title: 'Delivered', tone: 'good' },
  REJECTED: { title: 'Not completed', tone: 'bad' },
  FAILED: { title: 'Delivery failed', tone: 'bad' },
  REFUND_PENDING: { title: 'Refund in progress', tone: 'review' },
  REFUNDED: { title: 'Refunded', tone: 'good' },
  UNDER_REVIEW: { title: 'Being reviewed by our team', tone: 'review' },
};

/** Past-tense labels for the progress list: what happened at each step. */
export const HISTORY_COPY: Record<string, string> = {
  QUOTE_PENDING_CONFIRMATION: 'Quote accepted',
  AWAITING_SOURCE_PAYMENT: 'Payment requested',
  PAYMENT_PROCESSING: 'Payment prompt sent to your phone',
  AWAITING_MANUAL_VERIFICATION: 'Transfer reference received',
  SOURCE_VERIFIED: 'Payment confirmed',
  PAYOUT_PROCESSING: 'Sending started',
  DELIVERY_PENDING: 'Operator accepted the transfer',
  COMPLETED: 'Delivered to the recipient',
  REJECTED: 'Stopped',
  FAILED: 'Delivery failed',
  REFUND_PENDING: 'Refund started',
  REFUNDED: 'Refunded',
  UNDER_REVIEW: 'Sent to our team for review',
};

export const TERMINAL = ['COMPLETED', 'REJECTED', 'REFUNDED'];
