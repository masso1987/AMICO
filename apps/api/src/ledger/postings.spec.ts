import { payoutCompleted, refundCompleted, reversalOf, sourceReceived, UnbalancedPostingError } from './postings';

const sum = (lines: { debit: number; credit: number }[], k: 'debit' | 'credit') => lines.reduce((s, l) => s + l[k], 0);

describe('ledger postings', () => {
  it('source received balances', () => {
    const l = sourceReceived({ sourceAsset: 'MTN_MOMO', customerPays: 10_000 });
    expect(sum(l, 'debit')).toBe(sum(l, 'credit'));
  });

  it('payout splits into payout, platform fee, provider fee and margin', () => {
    const l = payoutCompleted({
      destinationAsset: 'ORANGE_MONEY', customerPays: 10_000, payoutInstructionAmount: 7_650,
      platformFee: 150, providerFee: 200, providerFeeCollectedBy: 'PLATFORM',
    });
    expect(l.find((x) => x.account === 'CONVERSION_MARGIN')?.credit).toBe(2_000);
    expect(sum(l, 'debit')).toBe(sum(l, 'credit'));
  });

  it('does not book a provider fee the provider took itself', () => {
    const l = payoutCompleted({
      destinationAsset: 'ORANGE_MONEY', customerPays: 10_000, payoutInstructionAmount: 9_850,
      platformFee: 150, providerFee: 200, providerFeeCollectedBy: 'PROVIDER_AT_SETTLEMENT',
    });
    expect(l.find((x) => x.account === 'PROVIDER_FEE_PAYABLE')).toBeUndefined();
    expect(sum(l, 'debit')).toBe(sum(l, 'credit'));
  });

  it('refuses a payout larger than what was paid', () => {
    expect(() =>
      payoutCompleted({ destinationAsset: 'MTN_MOMO', customerPays: 100, payoutInstructionAmount: 200, platformFee: 0, providerFee: 0, providerFeeCollectedBy: 'PLATFORM' }),
    ).toThrow(UnbalancedPostingError);
  });

  it('reversal mirrors the original', () => {
    const orig = refundCompleted({ sourceAsset: 'MTN_AIRTIME', amount: 5_000 });
    const rev = reversalOf(orig);
    expect(rev[0]).toEqual({ account: orig[0]!.account, debit: orig[0]!.credit, credit: orig[0]!.debit });
  });
});
