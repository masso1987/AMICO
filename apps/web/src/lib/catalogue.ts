import { productGroupOf, type Asset } from '@amico/contracts';
import type { ServiceSummary } from './products';

export function groupOf(s: Pick<ServiceSummary, 'sourceAsset' | 'destinationAsset'>): string {
  return productGroupOf({ source: s.sourceAsset as Asset, destination: s.destinationAsset as Asset });
}
