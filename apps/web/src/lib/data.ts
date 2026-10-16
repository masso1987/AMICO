import 'server-only';
import { apiUrl } from './session';
import type { BundleCatalogue, Offer, PublicConfig, SellRate, ServiceSummary, Status } from './products';

/** Public catalogue reads. A failure shows an empty section instead of breaking the page. */
async function publicGet<T>(path: string, fallback: T, revalidate = 30): Promise<T> {
  try {
    const res = await fetch(apiUrl(path), { next: { revalidate }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export const EMPTY_STATUS: Status = { global: null, paused: [], pausedServiceCodes: [], upcoming: [] };

export function getStatus() {
  // Maintenance must show at once: no caching.
  return publicGet<Status>('/status', EMPTY_STATUS, 0);
}

export function getServices() {
  return publicGet<ServiceSummary[]>('/services', [], 0);
}

export function getOffers() {
  return publicGet<Offer[]>('/offers', []);
}

export function getBundles() {
  return publicGet<BundleCatalogue>('/bundles', { paymentOptions: [], bundles: [] });
}

export function getPublicConfig() {
  return publicGet<PublicConfig>('/public/config', { cancellation: { feeBps: 300, allowAfterPayment: true }, refundOnFailurePercent: 100 });
}

export function getSellRates() {
  return publicGet<SellRate[]>('/public/sell-credit', []);
}

export async function simulationMode(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/health'), { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    const body = await res.json();
    return body.simulationMode !== false;
  } catch {
    return true; // if we can't tell, say so: never imply money is real
  }
}
