/**
 * Shared enums. Values are kept identical to the Prisma enums in
 * apps/api/prisma/schema.prisma so DB rows and API payloads use the same strings.
 */

export const Operator = { MTN: 'MTN', ORANGE: 'ORANGE' } as const;
export type Operator = (typeof Operator)[keyof typeof Operator];

export const AssetKind = {
  MOBILE_MONEY: 'MOBILE_MONEY',
  AIRTIME: 'AIRTIME',
  DATA_BUNDLE: 'DATA_BUNDLE',
} as const;
export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind];

export const Asset = {
  MTN_MOMO: 'MTN_MOMO',
  ORANGE_MONEY: 'ORANGE_MONEY',
  MTN_AIRTIME: 'MTN_AIRTIME',
  ORANGE_AIRTIME: 'ORANGE_AIRTIME',
  MTN_DATA: 'MTN_DATA',
  ORANGE_DATA: 'ORANGE_DATA',
} as const;
export type Asset = (typeof Asset)[keyof typeof Asset];

export const ASSET_META: Record<Asset, { operator: Operator; kind: AssetKind; label: string }> = {
  MTN_MOMO: { operator: 'MTN', kind: 'MOBILE_MONEY', label: 'MTN Mobile Money' },
  ORANGE_MONEY: { operator: 'ORANGE', kind: 'MOBILE_MONEY', label: 'Orange Money' },
  MTN_AIRTIME: { operator: 'MTN', kind: 'AIRTIME', label: 'MTN airtime' },
  ORANGE_AIRTIME: { operator: 'ORANGE', kind: 'AIRTIME', label: 'Orange airtime' },
  MTN_DATA: { operator: 'MTN', kind: 'DATA_BUNDLE', label: 'MTN data bundle' },
  ORANGE_DATA: { operator: 'ORANGE', kind: 'DATA_BUNDLE', label: 'Orange data bundle' },
};

export const SimAccountType = { BUSINESS: 'BUSINESS', NORMAL: 'NORMAL' } as const;
export type SimAccountType = (typeof SimAccountType)[keyof typeof SimAccountType];

/** How the SOURCE side of a route is received. */
export const ProcessingMethod = {
  /** Customer pays through a provider collection API on a business SIM. */
  API: 'API',
  /** Customer transfers airtime to a normal SIM; staff verify receipt by hand. */
  MANUAL_SOURCE: 'MANUAL_SOURCE',
} as const;
export type ProcessingMethod = (typeof ProcessingMethod)[keyof typeof ProcessingMethod];

export const ProviderCapability = {
  COLLECT: 'COLLECT',
  DISBURSE: 'DISBURSE',
  AIRTIME_TOPUP: 'AIRTIME_TOPUP',
  DATA_BUNDLE: 'DATA_BUNDLE',
  STATUS_QUERY: 'STATUS_QUERY',
} as const;
export type ProviderCapability = (typeof ProviderCapability)[keyof typeof ProviderCapability];

export const ServiceStatus = { DISABLED: 'DISABLED', ENABLED: 'ENABLED' } as const;
export type ServiceStatus = (typeof ServiceStatus)[keyof typeof ServiceStatus];

export const StaffRole = {
  ADMIN: 'ADMIN',
  FINANCE: 'FINANCE',
  OPERATIONS: 'OPERATIONS',
  SUPPORT: 'SUPPORT',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

export const Permission = {
  SIM_READ_MASKED: 'SIM_READ_MASKED',
  SIM_READ_FULL: 'SIM_READ_FULL',
  SIM_WRITE: 'SIM_WRITE',
  CATALOGUE_WRITE: 'CATALOGUE_WRITE',
  PRICING_DRAFT: 'PRICING_DRAFT',
  PRICING_APPROVE: 'PRICING_APPROVE',
  PROVIDER_FEE_WRITE: 'PROVIDER_FEE_WRITE',
  PROVIDER_CAPABILITY_WRITE: 'PROVIDER_CAPABILITY_WRITE',
  VERIFY_MANUAL: 'VERIFY_MANUAL',
  VERIFY_SECOND_APPROVAL: 'VERIFY_SECOND_APPROVAL',
  TRANSACTION_READ: 'TRANSACTION_READ',
  REFUND_REQUEST: 'REFUND_REQUEST',
  REFUND_APPROVE: 'REFUND_APPROVE',
  AUDIT_READ: 'AUDIT_READ',
  REPORT_READ: 'REPORT_READ',
  STAFF_MANAGE: 'STAFF_MANAGE',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

/**
 * Default permission grants. Holding both DRAFT and APPROVE never lets a user
 * approve their own change: maker-checker (approver !== maker) is enforced in
 * the API services, independent of these grants.
 */
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  ADMIN: [
    'SIM_READ_MASKED', 'SIM_READ_FULL', 'SIM_WRITE', 'CATALOGUE_WRITE', 'PRICING_DRAFT',
    'PRICING_APPROVE', 'PROVIDER_FEE_WRITE', 'PROVIDER_CAPABILITY_WRITE', 'TRANSACTION_READ',
    'AUDIT_READ', 'REPORT_READ', 'STAFF_MANAGE',
  ],
  FINANCE: [
    'SIM_READ_MASKED', 'PRICING_DRAFT', 'PRICING_APPROVE', 'PROVIDER_FEE_WRITE',
    'TRANSACTION_READ', 'REFUND_REQUEST', 'REFUND_APPROVE', 'REPORT_READ', 'AUDIT_READ',
  ],
  OPERATIONS: [
    'SIM_READ_MASKED', 'SIM_READ_FULL', 'VERIFY_MANUAL', 'VERIFY_SECOND_APPROVAL',
    'TRANSACTION_READ', 'REFUND_REQUEST',
  ],
  SUPPORT: ['SIM_READ_MASKED', 'TRANSACTION_READ'],
};

export const RiskLevel = { LOW: 'LOW', HIGH: 'HIGH' } as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];
