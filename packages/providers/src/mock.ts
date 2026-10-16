import { randomUUID } from 'node:crypto';
import type { Operator } from '@amico/contracts';
import type { CapabilityKey, FeeInquiry, MoneyRequest, OperationResult, OperationStatus, ProviderAdapter, ProviderBundle } from './adapter';

/**
 * Mock provider for development and tests. Every result is marked simulated.
 *
 * Scripted outcomes by the LAST TWO DIGITS of the amount, so any client can
 * exercise each path without special tooling:
 *   …13 → FAILED (definitive)
 *   …17 → UNKNOWN (simulated timeout; queryStatus later reports SUCCEEDED)
 *   …19 → UNKNOWN (simulated timeout; queryStatus later reports FAILED)
 *   …23 → PENDING (queryStatus later reports SUCCEEDED)
 *   …29 → UNKNOWN that never resolves (exercises escalation to UNDER_REVIEW)
 *   anything else → SUCCEEDED
 *
 * Calls are idempotent per key: repeating a key never creates a second movement.
 */
export class MockProviderAdapter implements ProviderAdapter {
  readonly code = 'MOCK';
  readonly simulated = true;

  /** Every movement the mock "performed", for assertions. */
  readonly movements: Array<{ kind: string; req: MoneyRequest; reference: string }> = [];
  private readonly byKey = new Map<string, { initial: OperationResult; final: OperationResult }>();

  constructor(private readonly opts: { feeInquiry?: (q: FeeInquiry) => number | null } = {}) {}

  supports(_key: CapabilityKey): boolean {
    return true;
  }

  collect(req: MoneyRequest) {
    return this.perform('COLLECT', req);
  }
  disburse(req: MoneyRequest) {
    return this.perform('DISBURSE', req);
  }
  topUpAirtime(req: MoneyRequest) {
    return this.perform('AIRTIME_TOPUP', req);
  }
  buyDataBundle(req: MoneyRequest & { bundleCode: string }) {
    return this.perform('DATA_BUNDLE', req);
  }

  async queryStatus(idempotencyKey: string): Promise<OperationResult> {
    const entry = this.byKey.get(idempotencyKey);
    if (!entry) return result('FAILED', null, 'No operation found for this key (it never reached the provider)');
    return entry.final;
  }

  async inquireFee(q: FeeInquiry): Promise<number | null> {
    return this.opts.feeInquiry ? this.opts.feeInquiry(q) : null;
  }

  /** A small, clearly fictional catalogue so the bundle screens can be exercised in simulation. */
  async listBundles(operator: Operator): Promise<ProviderBundle[]> {
    const p = operator === 'MTN' ? 'SIM-MTN' : 'SIM-OR';
    const label = operator === 'MTN' ? 'MTN' : 'Orange';
    return [
      { productId: `${p}-D100`, operator, name: `${label} Day 100 MB (simulated)`, category: 'DATA', validity: 'DAY', validityDays: 1, price: 100, dataMb: 100 },
      { productId: `${p}-D1G`, operator, name: `${label} Day 1 GB (simulated)`, category: 'DATA', validity: 'DAY', validityDays: 1, price: 500, dataMb: 1024 },
      { productId: `${p}-W2G`, operator, name: `${label} Week 2 GB (simulated)`, category: 'DATA', validity: 'WEEK', validityDays: 7, price: 1000, dataMb: 2048 },
      { productId: `${p}-W-CALL`, operator, name: `${label} Week calls 60 min (simulated)`, category: 'VOICE', validity: 'WEEK', validityDays: 7, price: 1000, voiceMinutes: 60 },
      { productId: `${p}-M10G`, operator, name: `${label} Month 10 GB (simulated)`, category: 'DATA', validity: 'MONTH', validityDays: 30, price: 5000, dataMb: 10240 },
      { productId: `${p}-M-MIX`, operator, name: `${label} Month mix 5 GB + 100 min + 100 SMS (simulated)`, category: 'COMBO', validity: 'MONTH', validityDays: 30, price: 6500, dataMb: 5120, voiceMinutes: 100, smsCount: 100 },
    ];
  }

  private async perform(kind: string, req: MoneyRequest): Promise<OperationResult> {
    const existing = this.byKey.get(req.idempotencyKey);
    if (existing) return existing.initial; // idempotent replay — no second movement

    if (!Number.isSafeInteger(req.amount) || req.amount <= 0) {
      const r = result('FAILED', null, 'Invalid amount');
      this.byKey.set(req.idempotencyKey, { initial: r, final: r });
      return r;
    }

    const ref = `SIM-${kind}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const tail = req.amount % 100;
    let initial: OperationResult;
    let final: OperationResult;
    switch (tail) {
      case 13:
        initial = final = result('FAILED', ref, 'Simulated provider decline');
        break;
      case 17:
        initial = result('UNKNOWN', null, 'Simulated timeout');
        final = result('SUCCEEDED', ref, null);
        break;
      case 19:
        initial = result('UNKNOWN', null, 'Simulated timeout');
        final = result('FAILED', ref, 'Simulated failure discovered on status query');
        break;
      case 23:
        initial = result('PENDING', ref, null);
        final = result('SUCCEEDED', ref, null);
        break;
      case 29:
        initial = final = result('UNKNOWN', null, 'Simulated provider with no answer');
        break;
      default:
        initial = final = result('SUCCEEDED', ref, null);
    }
    if (final.status === 'SUCCEEDED') this.movements.push({ kind, req, reference: ref });
    this.byKey.set(req.idempotencyKey, { initial, final });
    return initial;
  }
}

function result(status: OperationStatus, providerReference: string | null, failureReason: string | null): OperationResult {
  return { status, providerReference, failureReason, simulated: true };
}
