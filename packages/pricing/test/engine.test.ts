import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  calculateQuote,
  checkQuoteAcceptable,
  computeFee,
  divRound,
  isQuoteExpired,
  quoteWindow,
  simulateFees,
  type FeeSchedule,
  type PlatformPricingRule,
  type ProviderFeeInput,
  type QuoteInput,
} from '../src';

const fee = (f: Partial<FeeSchedule>): FeeSchedule => ({
  feeType: 'PERCENTAGE_PLUS_FIXED', percentageBps: 100, fixedFee: 50, minFee: 100, maxFee: 2000, rounding: 'UP', ...f,
});

const rule = (r: Partial<PlatformPricingRule> = {}): PlatformPricingRule => ({
  id: 'rule-1', version: 3, fee: fee({}), minAmount: 500, maxAmount: 500_000,
  deductionMethod: 'DEDUCT_FROM_DESTINATION', conversionRatePpm: 1_000_000, deliveryRounding: 'DOWN', ...r,
});

const verifiedProvider = (f: Partial<FeeSchedule> = {}, deductedAtSettlement = false): ProviderFeeInput => ({
  status: 'VERIFIED', ruleId: 'pf-1', ruleVersion: 1, deductedAtSettlement,
  fee: { feeType: 'FIXED', percentageBps: 0, fixedFee: 200, minFee: 0, maxFee: null, rounding: 'UP', ...f },
});

const quote = (o: Partial<QuoteInput> = {}) =>
  calculateQuote({ amount: 10_000, rule: rule(), providerFee: verifiedProvider(), allowEstimatedProviderFee: false, ...o });

function ok(res: ReturnType<typeof calculateQuote>) {
  if (!res.ok) throw new Error(`expected ok quote, got ${res.code}: ${res.message}`);
  return res.breakdown;
}

describe('integer rounding', () => {
  it('rounds with an explicit rule', () => {
    expect(divRound(10n, 3n, 'DOWN')).toBe(3n);
    expect(divRound(10n, 3n, 'UP')).toBe(4n);
    expect(divRound(10n, 4n, 'HALF_UP')).toBe(3n);
    expect(divRound(9n, 4n, 'HALF_UP')).toBe(2n);
    expect(divRound(12n, 4n, 'UP')).toBe(3n);
  });
  it('rejects bad denominators and negatives', () => {
    expect(() => divRound(1n, 0n, 'UP')).toThrow();
    expect(() => divRound(-1n, 2n, 'UP')).toThrow();
  });
});

describe('platform fee types', () => {
  it('fixed', () => expect(computeFee(10_000, fee({ feeType: 'FIXED', fixedFee: 300, minFee: 0 }))).toBe(300));
  it('percentage', () => expect(computeFee(10_000, fee({ feeType: 'PERCENTAGE', minFee: 0 }))).toBe(100));
  it('percentage plus fixed', () => expect(computeFee(10_000, fee({}))).toBe(150));
  it('percentage rounds up to the whole franc', () => expect(computeFee(1_234, fee({ feeType: 'PERCENTAGE', minFee: 0 }))).toBe(13));
  it('applies the minimum fee', () => expect(computeFee(1_000, fee({ minFee: 100 }))).toBe(100));
  it('applies the maximum fee', () => expect(computeFee(1_000_000, fee({ maxFee: 2000 }))).toBe(2000));
  it('no cap when maxFee is null', () => expect(computeFee(1_000_000, fee({ maxFee: null }))).toBe(10_050));
  it('rejects fractional or negative configuration', () => {
    expect(() => computeFee(1000, fee({ fixedFee: 1.5 }))).toThrow();
    expect(() => computeFee(1000, fee({ percentageBps: 20_000 }))).toThrow();
    expect(() => computeFee(-1, fee({}))).toThrow();
  });
});

describe('quote calculation strategies', () => {
  it('matches the illustrative example from the dev plan (deduct)', () => {
    const b = ok(quote());
    expect(b.platformFee).toBe(150);
    expect(b.providerFee.amount).toBe(200);
    expect(b.expectedDelivered).toBe(9_650);
    expect(b.customerPays).toBe(10_000);
    expect(b.pricingRuleVersion).toBe(3);
  });

  it('add-to-payment: customer_pays = amount + platform_fee + provider_fee', () => {
    const b = ok(quote({ rule: rule({ deductionMethod: 'ADD_TO_PAYMENT' }) }));
    expect(b.customerPays).toBe(10_000 + 150 + 200);
    expect(b.expectedDelivered).toBe(10_000);
  });

  it('deduct-from-source applies conversion after fees', () => {
    const b = ok(quote({ rule: rule({ deductionMethod: 'DEDUCT_FROM_SOURCE', conversionRatePpm: 800_000 }) }));
    // (10000 − 150 − 200) × 0.8 = 7720
    expect(b.expectedDelivered).toBe(7_720);
  });

  it('deduct-from-destination applies conversion before fees (airtime is not 1:1 cash)', () => {
    const b = ok(quote({ rule: rule({ conversionRatePpm: 800_000 }) }));
    // 10000 × 0.8 − 150 − 200 = 7650
    expect(b.convertedAmount).toBe(8_000);
    expect(b.expectedDelivered).toBe(7_650);
    expect(b.assumptions.join(' ')).toMatch(/Conversion rate 80\.00%/);
  });

  it('delivery rounds down on odd conversions', () => {
    const b = ok(quote({ amount: 1_001, rule: rule({ conversionRatePpm: 850_000, fee: fee({ minFee: 0, feeType: 'FIXED', fixedFee: 0 }) }), providerFee: verifiedProvider({ fixedFee: 0 }) }));
    // 1001 × 0.85 = 850.85 → 850
    expect(b.expectedDelivered).toBe(850);
  });
});

describe('provider fees', () => {
  it('percentage provider fee on the converted value', () => {
    const b = ok(quote({ providerFee: verifiedProvider({ feeType: 'PERCENTAGE', percentageBps: 150 }) }));
    expect(b.providerFee.amount).toBe(150);
    expect(b.expectedDelivered).toBe(10_000 - 150 - 150);
  });

  it('provider-quoted fee is used as given', () => {
    const b = ok(quote({ providerFee: { status: 'PROVIDER_QUOTED', amount: 75, deductedAtSettlement: false, reference: 'fee-inq-1' } }));
    expect(b.providerFee).toMatchObject({ amount: 75, status: 'PROVIDER_QUOTED', reference: 'fee-inq-1' });
    expect(b.isEstimate).toBe(false);
  });

  it('unknown provider fee makes the quote unavailable', () => {
    const res = quote({ providerFee: { status: 'UNKNOWN' } });
    expect(res).toMatchObject({ ok: false, code: 'PROVIDER_FEE_UNKNOWN' });
  });

  it('estimated provider fee is refused unless the service allows estimates', () => {
    const est: ProviderFeeInput = { ...verifiedProvider(), status: 'ESTIMATE' } as ProviderFeeInput;
    expect(quote({ providerFee: est })).toMatchObject({ ok: false, code: 'PROVIDER_FEE_ESTIMATE_NOT_ALLOWED' });
    const b = ok(quote({ providerFee: est, allowEstimatedProviderFee: true }));
    expect(b.isEstimate).toBe(true);
    expect(b.assumptions.join(' ')).toMatch(/estimate/);
  });

  it('platform and provider fees stay separate fields', () => {
    const b = ok(quote());
    expect(b.platformFee).not.toBe(b.providerFee.amount);
    expect(b).toHaveProperty('platformFee');
    expect(b.providerFee).toHaveProperty('amount');
  });

  it.each(['DEDUCT_FROM_SOURCE', 'DEDUCT_FROM_DESTINATION', 'ADD_TO_PAYMENT'] as const)(
    'never double-charges when the provider deducts at settlement (%s)',
    (deductionMethod) => {
      const ours = ok(quote({ rule: rule({ deductionMethod }), providerFee: verifiedProvider({}, false) }));
      const theirs = ok(quote({ rule: rule({ deductionMethod }), providerFee: verifiedProvider({}, true) }));
      // Recipient and customer end up in the same place either way: the fee is borne once.
      expect(theirs.expectedDelivered).toBe(ours.expectedDelivered);
      expect(theirs.customerPays).toBe(ours.customerPays);
      // When the provider deducts, we instruct it to send fee more, so it lands correctly.
      expect(theirs.payoutInstructionAmount - theirs.expectedDelivered).toBe(200);
      expect(ours.payoutInstructionAmount).toBe(ours.expectedDelivered);
      expect(theirs.providerFee.collectedBy).toBe('PROVIDER_AT_SETTLEMENT');
    },
  );
});

describe('invalid amounts and limits', () => {
  it.each([0, -5, 10.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])('rejects amount %s', (amount) => {
    expect(quote({ amount })).toMatchObject({ ok: false, code: 'INVALID_AMOUNT' });
  });
  it('enforces min and max transaction amount', () => {
    expect(quote({ amount: 499 })).toMatchObject({ ok: false, code: 'BELOW_MIN_AMOUNT' });
    expect(quote({ amount: 500_001 })).toMatchObject({ ok: false, code: 'ABOVE_MAX_AMOUNT' });
    expect(quote({ amount: 500 }).ok).toBe(true);
    expect(quote({ amount: 500_000 }).ok).toBe(true);
  });
  it('refuses a quote where fees swallow the amount', () => {
    const res = quote({ amount: 500, rule: rule({ fee: fee({ minFee: 400 }) }), providerFee: verifiedProvider({ fixedFee: 200 }) });
    expect(res).toMatchObject({ ok: false, code: 'NON_POSITIVE_DELIVERY' });
  });
  it('rejects an invalid conversion rate', () => {
    expect(quote({ rule: rule({ conversionRatePpm: 1_200_000 }) })).toMatchObject({ ok: false, code: 'INVALID_AMOUNT' });
  });
});

describe('properties', () => {
  const arbRule = fc.record({
    feeType: fc.constantFrom('FIXED', 'PERCENTAGE', 'PERCENTAGE_PLUS_FIXED' as const),
    percentageBps: fc.integer({ min: 0, max: 1500 }),
    fixedFee: fc.integer({ min: 0, max: 1000 }),
    minFee: fc.integer({ min: 0, max: 500 }),
    maxFee: fc.option(fc.integer({ min: 500, max: 20_000 }), { nil: null }),
    deductionMethod: fc.constantFrom('DEDUCT_FROM_SOURCE', 'DEDUCT_FROM_DESTINATION', 'ADD_TO_PAYMENT' as const),
    conversionRatePpm: fc.integer({ min: 500_000, max: 1_000_000 }),
    providerFixed: fc.integer({ min: 0, max: 500 }),
    deducted: fc.boolean(),
  });

  it('every successful quote is integer, non-negative, and conserves value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 2_000_000 }), arbRule, (amount, p) => {
        const res = calculateQuote({
          amount,
          rule: rule({
            maxAmount: 2_000_000,
            deductionMethod: p.deductionMethod,
            conversionRatePpm: p.conversionRatePpm,
            fee: { feeType: p.feeType, percentageBps: p.percentageBps, fixedFee: p.fixedFee, minFee: p.minFee, maxFee: p.maxFee, rounding: 'UP' },
          }),
          providerFee: verifiedProvider({ fixedFee: p.providerFixed }, p.deducted),
          allowEstimatedProviderFee: false,
        });
        if (!res.ok) return res.code === 'NON_POSITIVE_DELIVERY';
        const b = res.breakdown;
        for (const v of [b.customerPays, b.platformFee, b.providerFee.amount, b.expectedDelivered, b.payoutInstructionAmount]) {
          expect(Number.isSafeInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
        expect(b.expectedDelivered).toBeGreaterThan(0);
        if (p.maxFee !== null) expect(b.platformFee).toBeLessThanOrEqual(p.maxFee);
        // The recipient never gets more than the customer paid in, net of fees, before conversion.
        expect(b.expectedDelivered).toBeLessThanOrEqual(b.customerPays - b.platformFee - b.providerFee.amount);
        return true;
      }),
      { numRuns: 2000 },
    );
  });
});

describe('admin fee simulator', () => {
  it('uses the same maths and shows the business view', () => {
    const sim = simulateFees({ amount: 10_000, rule: rule(), providerFee: verifiedProvider(), allowEstimatedProviderFee: false });
    expect(sim).toMatchObject({ ok: true, customerPays: 10_000, platformRevenue: 150, providerCost: 200, destinationAmount: 9_650 });
  });
});

describe('quote lifecycle', () => {
  const now = new Date('2026-10-10T10:00:00Z');
  it('expires after its TTL', () => {
    const { expiresAt } = quoteWindow(now, 600);
    expect(isQuoteExpired(expiresAt, new Date('2026-10-10T10:09:59Z'))).toBe(false);
    expect(isQuoteExpired(expiresAt, new Date('2026-10-10T10:10:00Z'))).toBe(true);
  });
  it('rejects silly TTLs', () => {
    expect(() => quoteWindow(now, 5)).toThrow();
  });
  it('requires reconfirmation when pricing changed after the quote was issued', () => {
    const base = { expiresAt: new Date('2026-10-10T10:10:00Z'), now, quotedRuleVersion: 3, quotedProviderFeeRuleVersion: 1, currentProviderFeeRuleVersion: 1 };
    expect(checkQuoteAcceptable({ ...base, currentRuleVersion: 3 })).toEqual({ acceptable: true });
    expect(checkQuoteAcceptable({ ...base, currentRuleVersion: 4 })).toMatchObject({ acceptable: false, code: 'PRICING_CHANGED' });
    expect(checkQuoteAcceptable({ ...base, currentRuleVersion: 3, currentProviderFeeRuleVersion: 2 })).toMatchObject({ code: 'PRICING_CHANGED' });
    expect(checkQuoteAcceptable({ ...base, currentRuleVersion: 3, now: new Date('2026-10-10T11:00:00Z') })).toMatchObject({ code: 'QUOTE_EXPIRED' });
  });
});
