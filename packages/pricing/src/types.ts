import type { Rounding } from './integer';

export type FeeType = 'FIXED' | 'PERCENTAGE' | 'PERCENTAGE_PLUS_FIXED';

/**
 * - DEDUCT_FROM_SOURCE: fees come off the source amount before conversion.
 *     delivered = floor((A − Fp − Fv) × r)
 * - DEDUCT_FROM_DESTINATION: fees come off the converted amount.
 *     delivered = floor(A × r) − Fp − Fv
 * - ADD_TO_PAYMENT: the customer pays the fees on top.
 *     customerPays = A + Fp + Fv, delivered = floor(A × r)
 */
export type DeductionMethod = 'DEDUCT_FROM_SOURCE' | 'DEDUCT_FROM_DESTINATION' | 'ADD_TO_PAYMENT';

export interface FeeSchedule {
  feeType: FeeType;
  /** 1% = 100 bps. Ignored for FIXED. */
  percentageBps: number;
  /** Ignored for PERCENTAGE. */
  fixedFee: number;
  minFee: number;
  /** null = no cap */
  maxFee: number | null;
  rounding: Rounding;
}

export interface PlatformPricingRule {
  id: string;
  version: number;
  fee: FeeSchedule;
  minAmount: number;
  maxAmount: number;
  deductionMethod: DeductionMethod;
  /** 1.0 = 1_000_000 ppm. Airtime → cash routes are typically below 1.0. */
  conversionRatePpm: number;
  deliveryRounding: Rounding;
}

/**
 * Provider fee input — always separate from the platform fee.
 * - PROVIDER_QUOTED: the provider's own fee-inquiry response (most reliable).
 * - VERIFIED: a configured rule backed by a contract or tariff sheet.
 * - ESTIMATE: a configured rule that is not yet verified; the quote is flagged.
 * - UNKNOWN: no reliable value; the quote is refused.
 */
export type ProviderFeeInput =
  | { status: 'PROVIDER_QUOTED'; amount: number; deductedAtSettlement: boolean; reference: string }
  | { status: 'VERIFIED' | 'ESTIMATE'; ruleId: string; ruleVersion: number; fee: FeeSchedule; deductedAtSettlement: boolean }
  | { status: 'UNKNOWN' };

export interface QuoteInput {
  /** Whole FCFA entered by the customer. In deduct modes it is what they send; in add mode it is the base before fees. */
  amount: number;
  rule: PlatformPricingRule;
  providerFee: ProviderFeeInput;
  /** Per-service policy: may an ESTIMATE provider fee be shown to customers? */
  allowEstimatedProviderFee: boolean;
}

export interface QuoteBreakdown {
  /** What the customer must send from the source wallet / SIM. */
  customerPays: number;
  /** The amount entered. */
  amount: number;
  platformFee: number;
  providerFee: {
    amount: number;
    status: 'PROVIDER_QUOTED' | 'VERIFIED' | 'ESTIMATE';
    /** PLATFORM: we collect it from the customer and pay the provider. PROVIDER_AT_SETTLEMENT: the provider removes it itself. */
    collectedBy: 'PLATFORM' | 'PROVIDER_AT_SETTLEMENT';
    ruleId: string | null;
    ruleVersion: number | null;
    reference: string | null;
  };
  conversionRatePpm: number;
  /** A × r before any fee, after delivery rounding (or (A − fees) × r in DEDUCT_FROM_SOURCE). */
  convertedAmount: number;
  /** Amount we instruct the provider to deliver. Differs from expectedDelivered only when the provider deducts its own fee. */
  payoutInstructionAmount: number;
  /** What the recipient should receive. */
  expectedDelivered: number;
  deductionMethod: DeductionMethod;
  calculationMethod: string;
  isEstimate: boolean;
  assumptions: string[];
  pricingRuleId: string;
  pricingRuleVersion: number;
}

export type QuoteUnavailableCode =
  | 'INVALID_AMOUNT'
  | 'BELOW_MIN_AMOUNT'
  | 'ABOVE_MAX_AMOUNT'
  | 'PROVIDER_FEE_UNKNOWN'
  | 'PROVIDER_FEE_ESTIMATE_NOT_ALLOWED'
  | 'NON_POSITIVE_DELIVERY';

export type QuoteResult =
  | { ok: true; breakdown: QuoteBreakdown }
  | { ok: false; code: QuoteUnavailableCode; message: string };
