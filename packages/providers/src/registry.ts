import {
  CapabilityNotSupportedError,
  SimulatedAdapterInProductionError,
  type CapabilityKey,
  type ProviderAdapter,
} from './adapter';

export type RuntimeEnvironment = 'development' | 'test' | 'staging' | 'production';

/**
 * Holds the loaded adapters and routes each (operator, capability) to one of them.
 * Technical support is checked here; business enablement and verification are checked
 * in the API against the ProviderCapability table before any call.
 */
export class ProviderRegistry {
  private readonly routes = new Map<string, ProviderAdapter>();

  constructor(private readonly env: RuntimeEnvironment) {}

  register(adapter: ProviderAdapter, keys: CapabilityKey[]): void {
    if (adapter.simulated && this.env === 'production') throw new SimulatedAdapterInProductionError(adapter.code);
    for (const key of keys) {
      if (!adapter.supports(key)) throw new CapabilityNotSupportedError(adapter.code, key);
      this.routes.set(keyOf(key), adapter);
    }
  }

  resolve(key: CapabilityKey): ProviderAdapter {
    const adapter = this.routes.get(keyOf(key));
    if (!adapter) throw new CapabilityNotSupportedError('(none registered)', key);
    return adapter;
  }

  has(key: CapabilityKey): boolean {
    return this.routes.has(keyOf(key));
  }
}

const keyOf = (k: CapabilityKey) => `${k.operator}:${k.capability}`;
