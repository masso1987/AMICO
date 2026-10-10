/**
 * Transaction state machine. This whitelist is the only definition of which
 * transitions are legal; the API refuses anything not listed here.
 */

export const TransactionState = {
  CREATED: 'CREATED',
  QUOTE_PENDING_CONFIRMATION: 'QUOTE_PENDING_CONFIRMATION',
  AWAITING_SOURCE_PAYMENT: 'AWAITING_SOURCE_PAYMENT',
  AWAITING_MANUAL_VERIFICATION: 'AWAITING_MANUAL_VERIFICATION',
  SOURCE_VERIFIED: 'SOURCE_VERIFIED',
  PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
  PAYOUT_PROCESSING: 'PAYOUT_PROCESSING',
  DELIVERY_PENDING: 'DELIVERY_PENDING',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
  UNDER_REVIEW: 'UNDER_REVIEW',
} as const;
export type TransactionState = (typeof TransactionState)[keyof typeof TransactionState];

const S = TransactionState;

export const TRANSITIONS: Readonly<Record<TransactionState, readonly TransactionState[]>> = {
  [S.CREATED]: [S.QUOTE_PENDING_CONFIRMATION, S.REJECTED],
  [S.QUOTE_PENDING_CONFIRMATION]: [S.AWAITING_SOURCE_PAYMENT, S.REJECTED],
  [S.AWAITING_SOURCE_PAYMENT]: [S.PAYMENT_PROCESSING, S.AWAITING_MANUAL_VERIFICATION, S.REJECTED],
  // A declined collection means no money arrived: REJECTED, not FAILED (nothing to refund).
  [S.PAYMENT_PROCESSING]: [S.SOURCE_VERIFIED, S.REJECTED, S.UNDER_REVIEW],
  [S.AWAITING_MANUAL_VERIFICATION]: [S.SOURCE_VERIFIED, S.UNDER_REVIEW, S.REJECTED],
  // Review outcomes: source cleared, rejected (nothing received), refund, or a payout
  // whose uncertain outcome was resolved by status query / reconciliation.
  [S.UNDER_REVIEW]: [S.SOURCE_VERIFIED, S.REJECTED, S.REFUND_PENDING, S.DELIVERY_PENDING, S.FAILED],
  [S.SOURCE_VERIFIED]: [S.PAYOUT_PROCESSING],
  [S.PAYOUT_PROCESSING]: [S.DELIVERY_PENDING, S.UNDER_REVIEW, S.FAILED],
  [S.DELIVERY_PENDING]: [S.COMPLETED, S.FAILED, S.UNDER_REVIEW],
  [S.FAILED]: [S.REFUND_PENDING],
  [S.REFUND_PENDING]: [S.REFUNDED, S.UNDER_REVIEW],
  [S.COMPLETED]: [],
  [S.REJECTED]: [],
  [S.REFUNDED]: [],
};

export const TERMINAL_STATES: readonly TransactionState[] = [S.COMPLETED, S.REJECTED, S.REFUNDED];

/** States in which the customer's source funds/airtime are confirmed to be held by the business. */
export const FUNDS_HELD_STATES: readonly TransactionState[] = [
  S.SOURCE_VERIFIED,
  S.PAYOUT_PROCESSING,
  S.DELIVERY_PENDING,
];

export function canTransition(from: TransactionState, to: TransactionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: TransactionState,
    public readonly to: TransactionState,
  ) {
    super(`Illegal transaction transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: TransactionState, to: TransactionState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export function isTerminal(state: TransactionState): boolean {
  return TERMINAL_STATES.includes(state);
}
