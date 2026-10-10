import { describe, expect, it } from 'vitest';
import { MockProviderAdapter, ProviderRegistry, SimulatedAdapterInProductionError, CapabilityNotSupportedError } from '../src';

const req = (amount: number, key = `k-${amount}`) => ({ idempotencyKey: key, operator: 'ORANGE' as const, msisdn: '237699000000', amount, narrative: 't' });

describe('mock provider', () => {
  it('marks every result simulated', async () => {
    const m = new MockProviderAdapter();
    expect((await m.disburse(req(5000))).simulated).toBe(true);
  });

  it('is idempotent: the same key never moves money twice', async () => {
    const m = new MockProviderAdapter();
    const a = await m.disburse(req(5000, 'same'));
    const b = await m.disburse(req(5000, 'same'));
    expect(a).toEqual(b);
    expect(m.movements).toHaveLength(1);
  });

  it('scripts failure, timeout and pending outcomes', async () => {
    const m = new MockProviderAdapter();
    expect((await m.disburse(req(5013))).status).toBe('FAILED');
    expect((await m.disburse(req(5017))).status).toBe('UNKNOWN');
    expect((await m.queryStatus('k-5017')).status).toBe('SUCCEEDED');
    expect((await m.disburse(req(5019))).status).toBe('UNKNOWN');
    expect((await m.queryStatus('k-5019')).status).toBe('FAILED');
    expect((await m.disburse(req(5023))).status).toBe('PENDING');
    expect((await m.queryStatus('k-5023')).status).toBe('SUCCEEDED');
    expect((await m.disburse(req(5029))).status).toBe('UNKNOWN');
    expect((await m.queryStatus('k-5029')).status).toBe('UNKNOWN');
    expect(m.movements.map((x) => x.req.amount)).toEqual([5017, 5023]);
  });

  it('reports never-seen keys as failed (safe to retry)', async () => {
    expect((await new MockProviderAdapter().queryStatus('nope')).status).toBe('FAILED');
  });
});

describe('registry', () => {
  it('refuses simulated adapters in production', () => {
    const r = new ProviderRegistry('production');
    expect(() => r.register(new MockProviderAdapter(), [{ operator: 'MTN', capability: 'DISBURSE' }])).toThrow(
      SimulatedAdapterInProductionError,
    );
  });

  it('resolves registered capabilities and refuses others', () => {
    const r = new ProviderRegistry('development');
    r.register(new MockProviderAdapter(), [{ operator: 'MTN', capability: 'DISBURSE' }]);
    expect(r.resolve({ operator: 'MTN', capability: 'DISBURSE' }).code).toBe('MOCK');
    expect(() => r.resolve({ operator: 'ORANGE', capability: 'DISBURSE' })).toThrow(CapabilityNotSupportedError);
  });
});
