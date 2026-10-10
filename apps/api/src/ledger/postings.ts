import type { Asset } from '@amico/contracts';

/**
 * Pure double-entry posting rules. The database independently refuses any
 * unbalanced journal (deferred trigger), so a bug here fails loudly.
 */

export type AccountCode =
  | `WALLET:${Asset}`
  | 'CUSTOMER_PAYABLE'
  | 'PLATFORM_FEE_REVENUE'
  | 'CONVERSION_MARGIN'
  | 'PROVIDER_FEE_PAYABLE';

export const ASSETS: readonly Asset[] = ['MTN_MOMO', 'ORANGE_MONEY', 'MTN_AIRTIME', 'ORANGE_AIRTIME', 'MTN_DATA', 'ORANGE_DATA'];

export const CHART_OF_ACCOUNTS: ReadonlyArray<{ code: AccountCode; name: string; type: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE' }> = [
  ...ASSETS.map((a) => ({ code: `WALLET:${a}` as AccountCode, name: `Holdings — ${a}`, type: 'ASSET' as const })),
  { code: 'CUSTOMER_PAYABLE', name: 'Amounts owed to customers', type: 'LIABILITY' },
  { code: 'PROVIDER_FEE_PAYABLE', name: 'Provider fees collected, owed to providers', type: 'LIABILITY' },
  { code: 'PLATFORM_FEE_REVENUE', name: 'Platform fee revenue', type: 'REVENUE' },
  { code: 'CONVERSION_MARGIN', name: 'Conversion margin and rounding', type: 'REVENUE' },
];

export interface PostingLine {
  account: AccountCode;
  debit: number;
  credit: number;
}

export class UnbalancedPostingError extends Error {}

function assertBalanced(lines: PostingLine[]): PostingLine[] {
  const nonZero = lines.filter((l) => l.debit !== 0 || l.credit !== 0);
  for (const l of nonZero) {
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit) || l.debit < 0 || l.credit < 0 || (l.debit > 0 && l.credit > 0)) {
      throw new UnbalancedPostingError(`Invalid line on ${l.account}`);
    }
  }
  const d = nonZero.reduce((s, l) => s + l.debit, 0);
  const c = nonZero.reduce((s, l) => s + l.credit, 0);
  if (d !== c) throw new UnbalancedPostingError(`Unbalanced posting: debits ${d}, credits ${c}`);
  if (d === 0) throw new UnbalancedPostingError('Empty posting');
  return nonZero;
}

const dr = (account: AccountCode, amount: number): PostingLine => ({ account, debit: amount, credit: 0 });
const cr = (account: AccountCode, amount: number): PostingLine => ({ account, debit: 0, credit: amount });

/** Source funds or airtime confirmed in our hands; we now owe the customer. */
export function sourceReceived(t: { sourceAsset: Asset; customerPays: number }): PostingLine[] {
  return assertBalanced([dr(`WALLET:${t.sourceAsset}`, t.customerPays), cr('CUSTOMER_PAYABLE', t.customerPays)]);
}

/** Delivery verified: settle the customer liability into payout, fees and margin. */
export function payoutCompleted(t: {
  destinationAsset: Asset;
  customerPays: number;
  payoutInstructionAmount: number;
  platformFee: number;
  providerFee: number;
  providerFeeCollectedBy: string;
}): PostingLine[] {
  const providerFeeHeld = t.providerFeeCollectedBy === 'PLATFORM' ? t.providerFee : 0;
  const margin = t.customerPays - t.payoutInstructionAmount - t.platformFee - providerFeeHeld;
  if (margin < 0) throw new UnbalancedPostingError(`Negative conversion margin ${margin}: payout exceeds what the customer paid`);
  return assertBalanced([
    dr('CUSTOMER_PAYABLE', t.customerPays),
    cr(`WALLET:${t.destinationAsset}`, t.payoutInstructionAmount),
    cr('PLATFORM_FEE_REVENUE', t.platformFee),
    cr('PROVIDER_FEE_PAYABLE', providerFeeHeld),
    cr('CONVERSION_MARGIN', margin),
  ]);
}

/** Refund returned to the customer's source account. */
export function refundCompleted(t: { sourceAsset: Asset; amount: number }): PostingLine[] {
  return assertBalanced([dr('CUSTOMER_PAYABLE', t.amount), cr(`WALLET:${t.sourceAsset}`, t.amount)]);
}

/** Mirror image of an earlier journal. Corrections never edit history. */
export function reversalOf(lines: PostingLine[]): PostingLine[] {
  return assertBalanced(lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })));
}
