import { ASSET_META, type Operator } from './enums';
import { ROUTE_DEFINITIONS, type RouteDefinition } from './routes';

/**
 * Customer-facing product families. Every route belongs to exactly one, which is
 * how the app groups services and how maintenance can pause "all bundles" at once.
 */
export const ProductGroup = {
  BUY_AIRTIME: 'BUY_AIRTIME',
  BUNDLES: 'BUNDLES',
  SELL_CREDIT: 'SELL_CREDIT',
  AIRTIME_SWAP: 'AIRTIME_SWAP',
  MONEY_EXCHANGE: 'MONEY_EXCHANGE',
} as const;
export type ProductGroup = (typeof ProductGroup)[keyof typeof ProductGroup];

export const PRODUCT_GROUP_INFO: Record<ProductGroup, { en: string; fr: string }> = {
  BUY_AIRTIME: { en: 'Buy airtime', fr: 'Acheter du crédit' },
  BUNDLES: { en: 'Bundles', fr: 'Forfaits' },
  SELL_CREDIT: { en: 'Sell credit', fr: 'Rachat de crédit' },
  AIRTIME_SWAP: { en: 'Swap airtime', fr: 'Échange de crédit' },
  MONEY_EXCHANGE: { en: 'MoMo ⇄ Orange Money', fr: 'MoMo ⇄ Orange Money' },
};

export function productGroupOf(route: Pick<RouteDefinition, 'source' | 'destination'>): ProductGroup {
  const s = ASSET_META[route.source].kind;
  const d = ASSET_META[route.destination].kind;
  if (d === 'DATA_BUNDLE') return 'BUNDLES';
  if (s === 'MOBILE_MONEY' && d === 'AIRTIME') return 'BUY_AIRTIME';
  if (s === 'AIRTIME' && d === 'MOBILE_MONEY') return 'SELL_CREDIT';
  if (s === 'AIRTIME' && d === 'AIRTIME') return 'AIRTIME_SWAP';
  return 'MONEY_EXCHANGE';
}

export function routesInGroup(group: ProductGroup): string[] {
  return ROUTE_DEFINITIONS.filter((r) => productGroupOf(r) === group).map((r) => r.code);
}

/**
 * Default Cameroon number plan (national 9-digit numbers). Editable in admin settings
 * because operators receive new ranges over time; these are only the starting values.
 */
export const DEFAULT_OPERATOR_PREFIXES: Record<Operator, string[]> = {
  MTN: ['650', '651', '652', '653', '654', '67', '680', '681', '682', '683'],
  ORANGE: ['655', '656', '657', '658', '659', '69', '686', '687', '688', '689'],
};

/** Which network a 237XXXXXXXXX number belongs to, by longest matching prefix. Null when unknown. */
export function operatorOfMsisdn(msisdn: string, prefixes: Record<Operator, string[]> = DEFAULT_OPERATOR_PREFIXES): Operator | null {
  const national = msisdn.replace(/^\+?237/, '');
  let best: { op: Operator; len: number } | null = null;
  for (const op of Object.keys(prefixes) as Operator[]) {
    for (const p of prefixes[op]) {
      if (national.startsWith(p) && (!best || p.length > best.len)) best = { op, len: p.length };
    }
  }
  return best?.op ?? null;
}

export const BundleCategory = { DATA: 'DATA', VOICE: 'VOICE', SMS: 'SMS', COMBO: 'COMBO' } as const;
export type BundleCategory = (typeof BundleCategory)[keyof typeof BundleCategory];

export const BundleValidity = { DAY: 'DAY', WEEK: 'WEEK', MONTH: 'MONTH', OTHER: 'OTHER' } as const;
export type BundleValidity = (typeof BundleValidity)[keyof typeof BundleValidity];

export const Locale = { EN: 'en', FR: 'fr' } as const;
export type Locale = (typeof Locale)[keyof typeof Locale];
