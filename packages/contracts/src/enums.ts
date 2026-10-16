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
  ACCESS_MANAGE: 'ACCESS_MANAGE',
  BUNDLE_MANAGE: 'BUNDLE_MANAGE',
  OFFER_MANAGE: 'OFFER_MANAGE',
  MAINTENANCE_MANAGE: 'MAINTENANCE_MANAGE',
  MESSAGING_SEND: 'MESSAGING_SEND',
  MESSAGING_CONFIGURE: 'MESSAGING_CONFIGURE',
  MONITORING_READ: 'MONITORING_READ',
  SETTINGS_MANAGE: 'SETTINGS_MANAGE',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

/** Labels for the access-management screen, grouped. English first, French second. */
export const PERMISSION_INFO: Record<Permission, { group: string; en: string; fr: string }> = {
  TRANSACTION_READ: { group: 'Operations', en: 'View transactions', fr: 'Voir les transactions' },
  VERIFY_MANUAL: { group: 'Operations', en: 'Check received airtime', fr: 'Vérifier le crédit reçu' },
  VERIFY_SECOND_APPROVAL: { group: 'Operations', en: 'Give second approval on large amounts', fr: 'Donner la seconde approbation (gros montants)' },
  REFUND_REQUEST: { group: 'Operations', en: 'Request refunds', fr: 'Demander des remboursements' },
  REFUND_APPROVE: { group: 'Finance', en: 'Approve refunds', fr: 'Approuver les remboursements' },
  PRICING_DRAFT: { group: 'Finance', en: 'Draft fee rules', fr: 'Préparer les règles de frais' },
  PRICING_APPROVE: { group: 'Finance', en: 'Approve fee rules', fr: 'Approuver les règles de frais' },
  PROVIDER_FEE_WRITE: { group: 'Finance', en: 'Manage operator fees', fr: 'Gérer les frais opérateur' },
  REPORT_READ: { group: 'Finance', en: 'View reports', fr: 'Voir les rapports' },
  SETTINGS_MANAGE: { group: 'Finance', en: 'Change platform settings (cancellation fee, limits)', fr: 'Modifier les paramètres (frais d’annulation, limites)' },
  CATALOGUE_WRITE: { group: 'Catalogue', en: 'Enable and configure services', fr: 'Activer et configurer les services' },
  BUNDLE_MANAGE: { group: 'Catalogue', en: 'Manage bundles', fr: 'Gérer les forfaits' },
  OFFER_MANAGE: { group: 'Catalogue', en: 'Manage offers showcase', fr: 'Gérer la vitrine des offres' },
  SIM_READ_MASKED: { group: 'SIMs & providers', en: 'View SIM accounts (masked)', fr: 'Voir les SIM (masquées)' },
  SIM_READ_FULL: { group: 'SIMs & providers', en: 'Reveal full SIM numbers', fr: 'Afficher les numéros complets' },
  SIM_WRITE: { group: 'SIMs & providers', en: 'Edit SIM accounts', fr: 'Modifier les SIM' },
  PROVIDER_CAPABILITY_WRITE: { group: 'SIMs & providers', en: 'Verify provider capabilities', fr: 'Valider les capacités fournisseur' },
  MAINTENANCE_MANAGE: { group: 'Platform', en: 'Maintenance mode and notices', fr: 'Mode maintenance et annonces' },
  MONITORING_READ: { group: 'Platform', en: 'View monitoring and alerts', fr: 'Voir la supervision et les alertes' },
  MESSAGING_SEND: { group: 'Platform', en: 'Send SMS and WhatsApp messages', fr: 'Envoyer des SMS et WhatsApp' },
  MESSAGING_CONFIGURE: { group: 'Platform', en: 'Configure SMS and WhatsApp gateways', fr: 'Configurer les passerelles SMS et WhatsApp' },
  STAFF_MANAGE: { group: 'Access', en: 'Manage staff accounts', fr: 'Gérer les comptes du personnel' },
  ACCESS_MANAGE: { group: 'Access', en: 'Manage roles and permissions', fr: 'Gérer les rôles et permissions' },
  AUDIT_READ: { group: 'Access', en: 'View the audit log', fr: 'Voir le journal d’audit' },
};

/**
 * Default permission grants of the four built-in roles (seeded into the AccessRole
 * table; administrators can edit them and add custom roles). Holding both DRAFT and
 * APPROVE never lets a user approve their own change: maker-checker (approver !==
 * maker) is enforced in the API services, independent of these grants.
 */
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  ADMIN: [
    'SIM_READ_MASKED', 'SIM_READ_FULL', 'SIM_WRITE', 'CATALOGUE_WRITE', 'PRICING_DRAFT',
    'PRICING_APPROVE', 'PROVIDER_FEE_WRITE', 'PROVIDER_CAPABILITY_WRITE', 'TRANSACTION_READ',
    'AUDIT_READ', 'REPORT_READ', 'STAFF_MANAGE', 'ACCESS_MANAGE', 'BUNDLE_MANAGE', 'OFFER_MANAGE',
    'MAINTENANCE_MANAGE', 'MESSAGING_SEND', 'MESSAGING_CONFIGURE', 'MONITORING_READ', 'SETTINGS_MANAGE',
  ],
  FINANCE: [
    'SIM_READ_MASKED', 'PRICING_DRAFT', 'PRICING_APPROVE', 'PROVIDER_FEE_WRITE',
    'TRANSACTION_READ', 'REFUND_REQUEST', 'REFUND_APPROVE', 'REPORT_READ', 'AUDIT_READ',
    'MONITORING_READ', 'SETTINGS_MANAGE',
  ],
  OPERATIONS: [
    'SIM_READ_MASKED', 'SIM_READ_FULL', 'VERIFY_MANUAL', 'VERIFY_SECOND_APPROVAL',
    'TRANSACTION_READ', 'REFUND_REQUEST', 'MONITORING_READ', 'MESSAGING_SEND',
  ],
  SUPPORT: ['SIM_READ_MASKED', 'TRANSACTION_READ', 'MONITORING_READ'],
};

/** Permissions the built-in ADMIN role must always keep, so nobody can lock everyone out. */
export const ADMIN_LOCKED_PERMISSIONS: readonly Permission[] = ['STAFF_MANAGE', 'ACCESS_MANAGE'];

/** Role keys: built-in (ADMIN, FINANCE, OPERATIONS, SUPPORT) or custom (lower-case slug). */
export const RoleKey = /^[A-Z][A-Z0-9_]{1,39}$|^[a-z][a-z0-9-]{1,39}$/;

export const RiskLevel = { LOW: 'LOW', HIGH: 'HIGH' } as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];
