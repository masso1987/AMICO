import { z } from 'zod';

/** Whole FCFA. Never a float, never negative, within JS safe-integer range. */
export const Fcfa = z
  .number()
  .int('Amount must be a whole number of FCFA')
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const PositiveFcfa = Fcfa.refine((v) => v > 0, 'Amount must be greater than zero');

/** Cameroon MSISDN, normalised to 237XXXXXXXXX (9 national digits starting with 6). */
export const Msisdn = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .transform((s) => (s.startsWith('+') ? s.slice(1) : s))
  .transform((s) => (s.length === 9 ? `237${s}` : s))
  .refine((s) => /^2376\d{8}$/.test(s), 'Expected a Cameroon mobile number like 6XXXXXXXX');

export const QuoteRequestSchema = z.object({
  serviceCode: z.string().min(3),
  /** Amount the customer sends (deduct mode) or wants delivered (add mode); the rule decides. */
  amount: PositiveFcfa,
  recipientMsisdn: Msisdn,
  /** Customer's own number the source payment comes from. */
  senderMsisdn: Msisdn,
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const CreateTransactionSchema = z.object({
  quoteId: z.string().uuid(),
  /** Customer must explicitly accept the displayed quote. */
  acceptedTerms: z.literal(true),
});
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;

export const SubmitSourceReferenceSchema = z.object({
  customerReference: z.string().trim().min(3).max(100),
  evidenceFileIds: z.array(z.string().uuid()).max(3).default([]),
});
export type SubmitSourceReferenceInput = z.infer<typeof SubmitSourceReferenceSchema>;

export const VerificationDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('CONFIRM_RECEIVED'),
    /** Amount staff actually see on the receiving SIM — never copied from the customer. */
    receivedAmount: PositiveFcfa,
    /** What staff checked: e.g. "Balance SMS 14:02 from 2376…, +5,000 FCFA". Mandatory. */
    evidenceNote: z.string().trim().min(10).max(1000),
  }),
  z.object({
    decision: z.literal('NOT_RECEIVED'),
    reason: z.string().trim().min(10).max(1000),
  }),
  z.object({
    decision: z.literal('ESCALATE'),
    reason: z.string().trim().min(10).max(1000),
  }),
]);
export type VerificationDecisionInput = z.infer<typeof VerificationDecisionSchema>;

export const FeeType = z.enum(['FIXED', 'PERCENTAGE', 'PERCENTAGE_PLUS_FIXED']);
export const DeductionMethod = z.enum(['DEDUCT_FROM_SOURCE', 'DEDUCT_FROM_DESTINATION', 'ADD_TO_PAYMENT']);
export const RoundingDirection = z.enum(['UP', 'DOWN', 'HALF_UP']);

export const PricingRuleDraftSchema = z
  .object({
    serviceCode: z.string().min(3),
    feeType: FeeType,
    percentageBps: z.number().int().min(0).max(10_000).default(0),
    fixedFee: Fcfa.default(0),
    minFee: Fcfa.default(0),
    maxFee: Fcfa.nullable().default(null),
    minAmount: PositiveFcfa,
    maxAmount: PositiveFcfa,
    deductionMethod: DeductionMethod,
    /** 1.0 = 1_000_000. Airtime routes MUST set a verified value; money routes normally 1_000_000. */
    conversionRatePpm: z.number().int().positive().max(1_000_000),
    feeRounding: RoundingDirection.default('UP'),
    deliveryRounding: RoundingDirection.default('DOWN'),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().nullable().default(null),
    changeReason: z.string().trim().min(5).max(500),
  })
  .refine((r) => r.minAmount <= r.maxAmount, { message: 'minAmount must be ≤ maxAmount', path: ['minAmount'] })
  .refine((r) => r.maxFee === null || r.minFee <= r.maxFee, { message: 'minFee must be ≤ maxFee', path: ['minFee'] })
  .refine((r) => r.effectiveTo === null || r.effectiveFrom < r.effectiveTo, {
    message: 'effectiveFrom must be before effectiveTo',
    path: ['effectiveTo'],
  });
export type PricingRuleDraft = z.infer<typeof PricingRuleDraftSchema>;

export const ProviderFeeRuleDraftSchema = z.object({
  providerCode: z.string().min(2),
  operator: z.enum(['MTN', 'ORANGE']),
  capability: z.enum(['COLLECT', 'DISBURSE', 'AIRTIME_TOPUP', 'DATA_BUNDLE']),
  feeType: FeeType,
  percentageBps: z.number().int().min(0).max(10_000).default(0),
  fixedFee: Fcfa.default(0),
  minFee: Fcfa.default(0),
  maxFee: Fcfa.nullable().default(null),
  /** VERIFIED requires an evidence reference (contract clause, provider tariff sheet). */
  source: z.enum(['VERIFIED', 'ESTIMATE']),
  evidenceReference: z.string().trim().max(500).nullable().default(null),
  /** True when the provider takes its fee out of settlement: shown to the customer, never charged twice. */
  deductedAtSettlement: z.boolean(),
  changeReason: z.string().trim().min(5).max(500),
}).refine((r) => r.source !== 'VERIFIED' || (r.evidenceReference?.length ?? 0) >= 5, {
  message: 'A VERIFIED provider fee needs an evidence reference',
  path: ['evidenceReference'],
});
export type ProviderFeeRuleDraft = z.infer<typeof ProviderFeeRuleDraftSchema>;

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
