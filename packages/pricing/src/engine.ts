import { applyBps, applyPpm, assertFcfa, InvalidAmountError } from './integer';
import type { FeeSchedule, QuoteBreakdown, QuoteInput, QuoteResult } from './types';

const ONE_PPM = 1_000_000;

/** Fee for `base` under a schedule, clamped to [minFee, maxFee]. */
export function computeFee(base: number, fee: FeeSchedule): number {
  assertFcfa(base, 'fee base');
  assertFcfa(fee.fixedFee, 'fixedFee');
  assertFcfa(fee.minFee, 'minFee');
  if (fee.maxFee !== null) assertFcfa(fee.maxFee, 'maxFee');
  if (!Number.isInteger(fee.percentageBps) || fee.percentageBps < 0 || fee.percentageBps > 10_000) {
    throw new InvalidAmountError(`percentageBps must be an integer in [0, 10000] (got ${fee.percentageBps})`);
  }

  let raw: number;
  switch (fee.feeType) {
    case 'FIXED':
      raw = fee.fixedFee;
      break;
    case 'PERCENTAGE':
      raw = applyBps(base, fee.percentageBps, fee.rounding);
      break;
    case 'PERCENTAGE_PLUS_FIXED':
      raw = applyBps(base, fee.percentageBps, fee.rounding) + fee.fixedFee;
      break;
  }
  let clamped = Math.max(raw, fee.minFee);
  if (fee.maxFee !== null) clamped = Math.min(clamped, fee.maxFee);
  return clamped;
}

function describeFee(fee: FeeSchedule): string {
  const pct = `${(fee.percentageBps / 100).toString()}%`;
  const core =
    fee.feeType === 'FIXED' ? `${fee.fixedFee} FCFA` : fee.feeType === 'PERCENTAGE' ? pct : `${pct} + ${fee.fixedFee} FCFA`;
  const caps = [fee.minFee > 0 ? `min ${fee.minFee}` : null, fee.maxFee !== null ? `max ${fee.maxFee}` : null].filter(Boolean);
  return caps.length ? `${core} (${caps.join(', ')})` : core;
}

/**
 * Computes a quote. Pure and deterministic: no I/O, no clock, no floats.
 * Generating a quote never moves or reserves money.
 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  const { amount, rule, providerFee, allowEstimatedProviderFee } = input;

  try {
    assertFcfa(amount, 'amount', { allowZero: false });
  } catch (e) {
    return { ok: false, code: 'INVALID_AMOUNT', message: (e as Error).message };
  }
  if (amount < rule.minAmount) {
    return { ok: false, code: 'BELOW_MIN_AMOUNT', message: `Minimum amount for this service is ${rule.minAmount} FCFA` };
  }
  if (amount > rule.maxAmount) {
    return { ok: false, code: 'ABOVE_MAX_AMOUNT', message: `Maximum amount for this service is ${rule.maxAmount} FCFA` };
  }
  if (!Number.isInteger(rule.conversionRatePpm) || rule.conversionRatePpm <= 0 || rule.conversionRatePpm > ONE_PPM) {
    return { ok: false, code: 'INVALID_AMOUNT', message: 'Conversion rate must be in (0, 1_000_000] ppm' };
  }

  const assumptions: string[] = [];
  const platformFee = computeFee(amount, rule.fee);
  const grossConverted = applyPpm(amount, rule.conversionRatePpm, rule.deliveryRounding);

  // ---- provider fee: separate from platform fee, never invented ----
  let providerFeeAmount: number;
  let providerFeeMeta: QuoteBreakdown['providerFee'];
  switch (providerFee.status) {
    case 'UNKNOWN':
      return {
        ok: false,
        code: 'PROVIDER_FEE_UNKNOWN',
        message: 'The provider fee for this route cannot be determined, so an accurate amount cannot be quoted.',
      };
    case 'PROVIDER_QUOTED':
      assertFcfa(providerFee.amount, 'provider fee');
      providerFeeAmount = providerFee.amount;
      providerFeeMeta = {
        amount: providerFeeAmount,
        status: 'PROVIDER_QUOTED',
        collectedBy: providerFee.deductedAtSettlement ? 'PROVIDER_AT_SETTLEMENT' : 'PLATFORM',
        ruleId: null,
        ruleVersion: null,
        reference: providerFee.reference,
      };
      break;
    case 'VERIFIED':
    case 'ESTIMATE':
      if (providerFee.status === 'ESTIMATE' && !allowEstimatedProviderFee) {
        return {
          ok: false,
          code: 'PROVIDER_FEE_ESTIMATE_NOT_ALLOWED',
          message: 'The provider fee for this route is not verified and estimates are not allowed for it.',
        };
      }
      // Provider fee is assessed on the converted (destination-side) value.
      providerFeeAmount = computeFee(grossConverted, providerFee.fee);
      providerFeeMeta = {
        amount: providerFeeAmount,
        status: providerFee.status,
        collectedBy: providerFee.deductedAtSettlement ? 'PROVIDER_AT_SETTLEMENT' : 'PLATFORM',
        ruleId: providerFee.ruleId,
        ruleVersion: providerFee.ruleVersion,
        reference: null,
      };
      if (providerFee.status === 'ESTIMATE') {
        assumptions.push(`The operator fee of ${providerFeeAmount} FCFA is an estimate, so the amount received may differ slightly.`);
      }
      break;
  }

  const providerDeducts = providerFeeMeta.collectedBy === 'PROVIDER_AT_SETTLEMENT';
  if (providerDeducts) {
    assumptions.push('The provider deducts its own fee during settlement; it is shown here once and not charged again.');
  }
  if (rule.conversionRatePpm !== ONE_PPM) {
    assumptions.push(
      `Conversion rate ${(rule.conversionRatePpm / 10_000).toFixed(2)}%: ${amount} FCFA of source value converts to ${grossConverted} FCFA before fees.`,
    );
  }

  // ---- apply the configured strategy ----
  let customerPays: number;
  let convertedAmount: number;
  let payoutInstructionAmount: number;
  let expectedDelivered: number;
  let formula: string;
  const r = rule.conversionRatePpm;
  const rText = r === ONE_PPM ? '' : ' × r';

  switch (rule.deductionMethod) {
    case 'DEDUCT_FROM_SOURCE': {
      customerPays = amount;
      const net = amount - platformFee - (providerDeducts ? 0 : providerFeeAmount);
      if (net <= 0) return nonPositive();
      convertedAmount = applyPpm(net, r, rule.deliveryRounding);
      payoutInstructionAmount = convertedAmount;
      expectedDelivered = providerDeducts ? convertedAmount - providerFeeAmount : convertedAmount;
      formula = providerDeducts
        ? `delivered = (amount − platform_fee)${rText} − provider_fee(deducted by provider)`
        : `delivered = (amount − platform_fee − provider_fee)${rText}`;
      break;
    }
    case 'DEDUCT_FROM_DESTINATION': {
      customerPays = amount;
      convertedAmount = grossConverted;
      payoutInstructionAmount = convertedAmount - platformFee - (providerDeducts ? 0 : providerFeeAmount);
      expectedDelivered = providerDeducts ? payoutInstructionAmount - providerFeeAmount : payoutInstructionAmount;
      formula = `delivered = amount${rText} − platform_fee − provider_fee${providerDeducts ? '(deducted by provider)' : ''}`;
      break;
    }
    case 'ADD_TO_PAYMENT': {
      customerPays = amount + platformFee + providerFeeAmount;
      assertFcfa(customerPays, 'customerPays');
      convertedAmount = grossConverted;
      payoutInstructionAmount = providerDeducts ? convertedAmount + providerFeeAmount : convertedAmount;
      expectedDelivered = convertedAmount;
      formula = `customer_pays = amount + platform_fee + provider_fee; delivered = amount${rText}`;
      break;
    }
  }

  if (expectedDelivered <= 0 || payoutInstructionAmount <= 0) return nonPositive();

  const calculationMethod = [
    formula,
    `platform_fee = ${describeFee(rule.fee)} → ${platformFee} FCFA`,
    `provider_fee (${providerFeeMeta.status}) → ${providerFeeAmount} FCFA`,
    `rounding: fees ${rule.fee.rounding.toLowerCase()}, delivery ${rule.deliveryRounding.toLowerCase()} to the whole FCFA`,
  ].join('; ');

  return {
    ok: true,
    breakdown: {
      customerPays,
      amount,
      platformFee,
      providerFee: providerFeeMeta,
      conversionRatePpm: r,
      convertedAmount,
      payoutInstructionAmount,
      expectedDelivered,
      deductionMethod: rule.deductionMethod,
      calculationMethod,
      isEstimate: providerFeeMeta.status === 'ESTIMATE',
      assumptions,
      pricingRuleId: rule.id,
      pricingRuleVersion: rule.version,
    },
  };

  function nonPositive(): QuoteResult {
    return {
      ok: false,
      code: 'NON_POSITIVE_DELIVERY',
      message: 'Fees exceed the amount; nothing would be delivered. Increase the amount.',
    };
  }
}

/** Admin fee simulator: identical maths, plus the business view of the same numbers. */
export function simulateFees(input: QuoteInput):
  | { ok: true; customerPays: number; platformRevenue: number; providerCost: number; destinationAmount: number; breakdown: QuoteBreakdown }
  | { ok: false; code: string; message: string } {
  const result = calculateQuote(input);
  if (!result.ok) return result;
  const b = result.breakdown;
  return {
    ok: true,
    customerPays: b.customerPays,
    platformRevenue: b.platformFee,
    providerCost: b.providerFee.amount,
    destinationAmount: b.expectedDelivered,
    breakdown: b,
  };
}
