import type { MessageKey } from '@/i18n/core';

export const GROUPS = ['BUY_AIRTIME', 'BUNDLES', 'SELL_CREDIT', 'AIRTIME_SWAP', 'MONEY_EXCHANGE'] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_PATH: Record<Group, string> = {
  BUY_AIRTIME: '/app/airtime',
  BUNDLES: '/app/bundles',
  SELL_CREDIT: '/app/sell',
  AIRTIME_SWAP: '/app/swap',
  MONEY_EXCHANGE: '/app/exchange',
};

export const GROUP_TITLE: Record<Group, MessageKey> = {
  BUY_AIRTIME: 'group.BUY_AIRTIME',
  BUNDLES: 'group.BUNDLES',
  SELL_CREDIT: 'group.SELL_CREDIT',
  AIRTIME_SWAP: 'group.AIRTIME_SWAP',
  MONEY_EXCHANGE: 'group.MONEY_EXCHANGE',
};

export const GROUP_BLURB: Record<Group, MessageKey> = {
  BUY_AIRTIME: 'group.BUY_AIRTIME.blurb',
  BUNDLES: 'group.BUNDLES.blurb',
  SELL_CREDIT: 'group.SELL_CREDIT.blurb',
  AIRTIME_SWAP: 'group.AIRTIME_SWAP.blurb',
  MONEY_EXCHANGE: 'group.MONEY_EXCHANGE.blurb',
};

export function isGroup(v: unknown): v is Group {
  return typeof v === 'string' && (GROUPS as readonly string[]).includes(v);
}

export interface ServiceSummary {
  code: string;
  name: string;
  sourceAsset: string;
  destinationAsset: string;
  processingMethod: 'API' | 'MANUAL_SOURCE';
  minAmount: number;
  maxAmount: number;
}

export interface MaintenanceView {
  id: string;
  global: boolean;
  serviceCodes: string[];
  messageEn: string;
  messageFr: string;
  startsAt: string;
  endsAt: string | null;
}

export interface Status {
  global: MaintenanceView | null;
  paused: MaintenanceView[];
  pausedServiceCodes: string[];
  upcoming: MaintenanceView[];
}

export interface Offer {
  id: string;
  titleEn: string;
  titleFr: string;
  bodyEn: string;
  bodyFr: string;
  operator: 'MTN' | 'ORANGE' | null;
  badgeEn: string | null;
  badgeFr: string | null;
  ctaKind: 'NONE' | 'BUNDLE' | 'SERVICE' | 'URL';
  ctaTarget: string | null;
  image: string | null;
  endsAt: string | null;
}

export interface Bundle {
  id: string;
  operator: 'MTN' | 'ORANGE';
  name: string;
  nameFr: string | null;
  description: string | null;
  category: 'DATA' | 'VOICE' | 'SMS' | 'COMBO';
  validity: 'DAY' | 'WEEK' | 'MONTH' | 'OTHER';
  validityDays: number | null;
  price: number;
  dataMb: number | null;
  voiceMinutes: number | null;
  smsCount: number | null;
  featured: boolean;
}

export interface BundleCatalogue {
  paymentOptions: { serviceCode: string; operator: 'MTN' | 'ORANGE'; payWith: string }[];
  bundles: Bundle[];
}

export interface PublicConfig {
  cancellation: { feeBps: number; allowAfterPayment: boolean };
  refundOnFailurePercent: number;
}

export interface SellRate {
  serviceCode: string;
  sourceAsset: string;
  destinationAsset: string;
  ratePercent: number;
  minAmount: number;
  maxAmount: number;
}

/** Where an offer's button goes. Null = no button. */
export function offerHref(o: Offer): string | null {
  if (o.ctaKind === 'SERVICE' && isGroup(o.ctaTarget)) return GROUP_PATH[o.ctaTarget];
  if (o.ctaKind === 'BUNDLE' && o.ctaTarget) return `/app/bundles?bundle=${o.ctaTarget}`;
  if (o.ctaKind === 'URL' && o.ctaTarget?.startsWith('https://')) return o.ctaTarget;
  return null;
}

/** Percent from basis points: 300 → "3", 250 → "2.5" (or "2,5" in French). */
export function percent(bps: number, locale: 'en' | 'fr'): string {
  const v = bps / 100;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '');
  return locale === 'fr' ? s.replace('.', ',') : s;
}

export function ratePct(rate: number, locale: 'en' | 'fr'): string {
  const s = Number.isInteger(rate) ? String(rate) : rate.toFixed(2).replace(/0+$/, '');
  return locale === 'fr' ? s.replace('.', ',') : s;
}

/** Which products can be offered now, given the open services and maintenance. */
export function availability(services: ServiceSummary[], pausedCodes: string[], groupOf: (s: ServiceSummary) => string) {
  return GROUPS.map((group) => {
    const inGroup = services.filter((s) => groupOf(s) === group);
    const open = inGroup.some((s) => !pausedCodes.includes(s.code));
    return { group, open, paused: inGroup.length > 0 && !open };
  });
}
