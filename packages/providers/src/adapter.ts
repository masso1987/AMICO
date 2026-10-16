import type { Operator, ProviderCapability } from '@amico/contracts';

/**
 * Outcome of a provider call.
 * - SUCCEEDED / FAILED: the provider has given a definitive answer.
 * - PENDING: accepted, final status will come by callback or status query.
 * - UNKNOWN: timeout or ambiguous response. NEVER retry on UNKNOWN — query status first.
 */
export type OperationStatus = 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'UNKNOWN';

export interface OperationResult {
  status: OperationStatus;
  providerReference: string | null;
  failureReason: string | null;
  /** True for every result produced by a mock adapter. Persisted on the operation and transaction. */
  simulated: boolean;
}

export interface MoneyRequest {
  /** Our idempotency key; the same key must never produce two movements. */
  idempotencyKey: string;
  operator: Operator;
  msisdn: string;
  /** Whole FCFA. */
  amount: number;
  narrative: string;
}

export interface FeeInquiry {
  operator: Operator;
  capability: ProviderCapability;
  amount: number;
}

export interface CapabilityKey {
  operator: Operator;
  capability: ProviderCapability;
}

/** A bundle as the operator/provider lists it. Prices are whole FCFA. */
export interface ProviderBundle {
  /** The provider's own product code, used when buying. Stable across syncs. */
  productId: string;
  operator: Operator;
  name: string;
  category: 'DATA' | 'VOICE' | 'SMS' | 'COMBO';
  validity: 'DAY' | 'WEEK' | 'MONTH' | 'OTHER';
  validityDays: number;
  price: number;
  dataMb?: number | null;
  voiceMinutes?: number | null;
  smsCount?: number | null;
  description?: string | null;
}

export interface ProviderAdapter {
  readonly code: string;
  readonly simulated: boolean;
  /** Capabilities this adapter technically implements. Business enablement is a separate, verified DB flag. */
  supports(key: CapabilityKey): boolean;
  collect(req: MoneyRequest): Promise<OperationResult>;
  disburse(req: MoneyRequest): Promise<OperationResult>;
  topUpAirtime(req: MoneyRequest): Promise<OperationResult>;
  buyDataBundle(req: MoneyRequest & { bundleCode: string }): Promise<OperationResult>;
  /** Look up an earlier operation by our idempotency key. Used before any retry. */
  queryStatus(idempotencyKey: string): Promise<OperationResult>;
  /** Provider-quoted fee, when the provider exposes a fee inquiry. Null if not supported. */
  inquireFee(q: FeeInquiry): Promise<number | null>;
  /** The bundle catalogue for one operator, when the provider publishes one. Null if not supported. */
  listBundles(operator: Operator): Promise<ProviderBundle[] | null>;
}

export class CapabilityNotSupportedError extends Error {
  constructor(adapter: string, key: CapabilityKey) {
    super(`Provider ${adapter} does not support ${key.capability} on ${key.operator}`);
    this.name = 'CapabilityNotSupportedError';
  }
}

export class SimulatedAdapterInProductionError extends Error {
  constructor(adapter: string) {
    super(`Refusing to load simulated provider adapter "${adapter}" in production`);
    this.name = 'SimulatedAdapterInProductionError';
  }
}
