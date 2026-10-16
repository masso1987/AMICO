import { describe, expect, it } from 'vitest';
import {
  ROUTE_DEFINITIONS,
  TRANSITIONS,
  TransactionState,
  assertTransition,
  canTransition,
  isTerminal,
  maskMsisdn,
  Msisdn,
  PricingRuleDraftSchema,
  ProviderFeeRuleDraftSchema,
  receivingSimOperator,
  findRoute,
  VerificationDecisionSchema,
  IllegalTransitionError,
  productGroupOf,
  routesInGroup,
  operatorOfMsisdn,
  QuoteRequestSchema,
  ALL_PERMISSIONS,
  PERMISSION_INFO,
  ADMIN_LOCKED_PERMISSIONS,
  ROLE_PERMISSIONS,
} from '../src';

const ALL = Object.values(TransactionState);

describe('state machine', () => {
  it('defines transitions for every state', () => {
    for (const s of ALL) expect(TRANSITIONS[s]).toBeDefined();
  });

  it('terminal states have no exits', () => {
    for (const s of ALL.filter(isTerminal)) expect(TRANSITIONS[s]).toHaveLength(0);
  });

  it('only DELIVERY_PENDING can reach COMPLETED (nothing completes before delivery is verified)', () => {
    const sources = ALL.filter((s) => canTransition(s, 'COMPLETED'));
    expect(sources).toEqual(['DELIVERY_PENDING']);
  });

  it('manual verification cannot skip to payout', () => {
    expect(canTransition('AWAITING_MANUAL_VERIFICATION', 'PAYOUT_PROCESSING')).toBe(false);
    expect(canTransition('AWAITING_MANUAL_VERIFICATION', 'SOURCE_VERIFIED')).toBe(true);
  });

  it('a declined collection is REJECTED, never FAILED (nothing to refund)', () => {
    expect(canTransition('PAYMENT_PROCESSING', 'REJECTED')).toBe(true);
    expect(canTransition('PAYMENT_PROCESSING', 'FAILED')).toBe(false);
  });

  it('payout can only start from SOURCE_VERIFIED', () => {
    expect(ALL.filter((s) => canTransition(s, 'PAYOUT_PROCESSING'))).toEqual(['SOURCE_VERIFIED']);
  });

  it('every state is reachable from CREATED', () => {
    const seen = new Set<string>(['CREATED']);
    const queue: TransactionState[] = ['CREATED'];
    while (queue.length) {
      const s = queue.shift()!;
      for (const n of TRANSITIONS[s]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    expect([...seen].sort()).toEqual([...ALL].sort());
  });

  it('every non-terminal state can reach a terminal state', () => {
    for (const start of ALL.filter((s) => !isTerminal(s))) {
      const seen = new Set<string>([start]);
      const queue: TransactionState[] = [start];
      let reached = false;
      while (queue.length && !reached) {
        const s = queue.shift()!;
        for (const n of TRANSITIONS[s]) {
          if (isTerminal(n)) reached = true;
          if (!seen.has(n)) { seen.add(n); queue.push(n); }
        }
      }
      expect(reached, `${start} must reach a terminal state`).toBe(true);
    }
  });

  it('assertTransition throws a typed error on illegal moves', () => {
    expect(() => assertTransition('COMPLETED', 'REFUNDED')).toThrow(IllegalTransitionError);
    expect(() => assertTransition('SOURCE_VERIFIED', 'PAYOUT_PROCESSING')).not.toThrow();
  });
});

describe('route catalogue', () => {
  it('has the 12 exchange routes plus 4 data bundle routes, with unique codes', () => {
    expect(ROUTE_DEFINITIONS).toHaveLength(16);
    expect(new Set(ROUTE_DEFINITIONS.map((r) => r.code)).size).toBe(16);
  });

  it('every airtime-source route is manual and HIGH risk', () => {
    for (const r of ROUTE_DEFINITIONS.filter((r) => r.source.endsWith('_AIRTIME'))) {
      expect(r.processingMethod).toBe('MANUAL_SOURCE');
      expect(r.risk).toBe('HIGH');
    }
  });

  it('the receiving SIM for a manual route is the normal SIM of the source operator', () => {
    expect(receivingSimOperator(findRoute('MTN_AIRTIME__ORANGE_MONEY')!)).toBe('MTN');
    expect(receivingSimOperator(findRoute('ORANGE_AIRTIME__MTN_MOMO')!)).toBe('ORANGE');
    expect(receivingSimOperator(findRoute('MTN_MOMO__ORANGE_MONEY')!)).toBeNull();
  });

  it('API routes require collection on the source operator', () => {
    for (const r of ROUTE_DEFINITIONS.filter((r) => r.processingMethod === 'API')) {
      expect(r.requiredCapabilities.some((c) => c.capability === 'COLLECT')).toBe(true);
    }
  });
});

describe('schemas', () => {
  it('normalises Cameroon numbers', () => {
    expect(Msisdn.parse('6 99 12 34 56')).toBe('237699123456');
    expect(Msisdn.parse('+237699123456')).toBe('237699123456');
    expect(() => Msisdn.parse('12345')).toThrow();
  });

  it('masks numbers', () => {
    expect(maskMsisdn('237699123456')).toBe('2376•••••456');
  });

  it('confirming receipt requires an amount and an evidence note', () => {
    expect(VerificationDecisionSchema.safeParse({ decision: 'CONFIRM_RECEIVED', receivedAmount: 5000 }).success).toBe(false);
    expect(
      VerificationDecisionSchema.safeParse({ decision: 'CONFIRM_RECEIVED', receivedAmount: 5000, evidenceNote: 'Balance SMS shows +5000 at 14:02' }).success,
    ).toBe(true);
  });

  it('rejects fractional FCFA and inverted limits in pricing drafts', () => {
    const base = {
      serviceCode: 'MTN_MOMO__ORANGE_MONEY', feeType: 'PERCENTAGE', percentageBps: 100,
      minAmount: 500, maxAmount: 500000, deductionMethod: 'DEDUCT_FROM_SOURCE',
      conversionRatePpm: 1_000_000, effectiveFrom: '2026-11-01', changeReason: 'Initial rule',
    };
    expect(PricingRuleDraftSchema.safeParse(base).success).toBe(true);
    expect(PricingRuleDraftSchema.safeParse({ ...base, fixedFee: 10.5 }).success).toBe(false);
    expect(PricingRuleDraftSchema.safeParse({ ...base, minAmount: 600000 }).success).toBe(false);
  });

  it('a VERIFIED provider fee needs evidence', () => {
    const base = {
      providerCode: 'MOCK', operator: 'MTN', capability: 'DISBURSE', feeType: 'FIXED', fixedFee: 100,
      source: 'VERIFIED', deductedAtSettlement: false, changeReason: 'Tariff sheet',
    };
    expect(ProviderFeeRuleDraftSchema.safeParse(base).success).toBe(false);
    expect(ProviderFeeRuleDraftSchema.safeParse({ ...base, evidenceReference: 'Contract annex 2' }).success).toBe(true);
  });
});

describe('products and number plan', () => {
  it('puts every route in exactly one product group', () => {
    const groups = ROUTE_DEFINITIONS.map((r) => productGroupOf(r));
    expect(groups.filter((g) => g === 'SELL_CREDIT')).toHaveLength(4);
    expect(groups.filter((g) => g === 'BUNDLES')).toHaveLength(4);
    expect(groups.filter((g) => g === 'BUY_AIRTIME')).toHaveLength(4);
    expect(groups.filter((g) => g === 'AIRTIME_SWAP')).toHaveLength(2);
    expect(groups.filter((g) => g === 'MONEY_EXCHANGE')).toHaveLength(2);
    expect(routesInGroup('SELL_CREDIT').sort()).toEqual(['MTN_AIRTIME__MTN_MOMO', 'MTN_AIRTIME__ORANGE_MONEY', 'ORANGE_AIRTIME__MTN_MOMO', 'ORANGE_AIRTIME__ORANGE_MONEY']);
  });

  it('detects the network from the number, longest prefix first', () => {
    expect(operatorOfMsisdn('237677123456')).toBe('MTN');
    expect(operatorOfMsisdn('237650123456')).toBe('MTN');
    expect(operatorOfMsisdn('237699123456')).toBe('ORANGE');
    expect(operatorOfMsisdn('237655123456')).toBe('ORANGE');
    expect(operatorOfMsisdn('237620123456')).toBeNull(); // CAMTEL: not served yet
    expect(operatorOfMsisdn('237699123456', { MTN: ['699'], ORANGE: ['69'] })).toBe('MTN');
  });

  it('a cancelled verified transaction may go to refund, never straight to completion', () => {
    expect(canTransition('SOURCE_VERIFIED', 'REFUND_PENDING')).toBe(true);
    expect(canTransition('SOURCE_VERIFIED', 'COMPLETED')).toBe(false);
  });

  it('quote requests take an amount or a bundle, not both', () => {
    const base = { serviceCode: 'MTN_MOMO__MTN_DATA', recipientMsisdn: '677123456', senderMsisdn: '677123456' };
    expect(QuoteRequestSchema.safeParse({ ...base, amount: 1000 }).success).toBe(true);
    expect(QuoteRequestSchema.safeParse({ ...base, bundleId: '7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b' }).success).toBe(true);
    expect(QuoteRequestSchema.safeParse({ ...base, amount: 1000, bundleId: '7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b' }).success).toBe(false);
    expect(QuoteRequestSchema.safeParse(base).success).toBe(false);
  });

  it('every permission has bilingual labels and the admin keeps access management', () => {
    for (const p of ALL_PERMISSIONS) expect(PERMISSION_INFO[p].fr.length).toBeGreaterThan(3);
    for (const p of ADMIN_LOCKED_PERMISSIONS) expect(ROLE_PERMISSIONS.ADMIN).toContain(p);
  });
});
