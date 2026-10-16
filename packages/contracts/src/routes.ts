import { ASSET_META, type Asset, type Operator, type ProcessingMethod, type ProviderCapability } from './enums';

export interface CapabilityRequirement {
  operator: Operator;
  capability: ProviderCapability;
}

export interface RouteDefinition {
  code: string;
  name: string;
  source: Asset;
  destination: Asset;
  processingMethod: ProcessingMethod;
  /** Every capability that must be enabled AND verified before the route can be enabled. */
  requiredCapabilities: readonly CapabilityRequirement[];
  /** Feasibility notes copied from docs/ASSUMPTIONS.md section C. */
  verificationNotes: string;
  risk: 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH';
}

const op = (a: Asset) => ASSET_META[a].operator;

function apiRoute(source: Asset, destination: Asset, deliver: ProviderCapability, risk: RouteDefinition['risk'], notes: string): RouteDefinition {
  return {
    code: `${source}__${destination}`,
    name: `${ASSET_META[source].label} → ${ASSET_META[destination].label}`,
    source,
    destination,
    processingMethod: 'API',
    requiredCapabilities: [
      { operator: op(source), capability: 'COLLECT' },
      { operator: op(destination), capability: deliver },
    ],
    verificationNotes: notes,
    risk,
  };
}

function manualRoute(source: Asset, destination: Asset, deliver: ProviderCapability, notes: string): RouteDefinition {
  return {
    code: `${source}__${destination}`,
    name: `${ASSET_META[source].label} → ${ASSET_META[destination].label}`,
    source,
    destination,
    processingMethod: 'MANUAL_SOURCE',
    requiredCapabilities: [{ operator: op(destination), capability: deliver }],
    verificationNotes: notes,
    risk: 'HIGH',
  };
}

const AIRTIME_NOTE =
  'Needs: operator terms allowing commercial use of received airtime (B2), licensing (B3), staff visibility of incoming transfers (B5), verified conversion rate (B6).';

/** The 12 exchange routes plus 4 bundle purchase routes. All are seeded DISABLED. */
export const ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  apiRoute('MTN_MOMO', 'ORANGE_MONEY', 'DISBURSE', 'MEDIUM', 'Needs MTN collection + Orange disbursement access, settlement float (B1, B4, B7).'),
  apiRoute('ORANGE_MONEY', 'MTN_MOMO', 'DISBURSE', 'MEDIUM', 'Needs Orange collection + MTN disbursement access, settlement float (B1, B4, B7).'),
  manualRoute('MTN_AIRTIME', 'ORANGE_AIRTIME', 'AIRTIME_TOPUP', AIRTIME_NOTE),
  manualRoute('ORANGE_AIRTIME', 'MTN_AIRTIME', 'AIRTIME_TOPUP', AIRTIME_NOTE),
  manualRoute('MTN_AIRTIME', 'MTN_MOMO', 'DISBURSE', AIRTIME_NOTE),
  manualRoute('MTN_AIRTIME', 'ORANGE_MONEY', 'DISBURSE', `${AIRTIME_NOTE} Cross-network float (B4).`),
  manualRoute('ORANGE_AIRTIME', 'MTN_MOMO', 'DISBURSE', `${AIRTIME_NOTE} Cross-network float (B4).`),
  manualRoute('ORANGE_AIRTIME', 'ORANGE_MONEY', 'DISBURSE', AIRTIME_NOTE),
  apiRoute('MTN_MOMO', 'MTN_AIRTIME', 'AIRTIME_TOPUP', 'LOW_MEDIUM', 'Needs MTN collection + airtime vending access (B1, B7).'),
  apiRoute('MTN_MOMO', 'ORANGE_AIRTIME', 'AIRTIME_TOPUP', 'MEDIUM', 'Needs MTN collection + Orange airtime vending access (B1, B7).'),
  apiRoute('ORANGE_MONEY', 'MTN_AIRTIME', 'AIRTIME_TOPUP', 'MEDIUM', 'Needs Orange collection + MTN airtime vending access (B1, B7).'),
  apiRoute('ORANGE_MONEY', 'ORANGE_AIRTIME', 'AIRTIME_TOPUP', 'LOW_MEDIUM', 'Needs Orange collection + airtime vending access (B1, B7).'),
  apiRoute('MTN_MOMO', 'MTN_DATA', 'DATA_BUNDLE', 'LOW_MEDIUM', 'Data bundle purchase. Needs bundle catalogue API (B1, B7).'),
  apiRoute('ORANGE_MONEY', 'ORANGE_DATA', 'DATA_BUNDLE', 'LOW_MEDIUM', 'Data bundle purchase. Needs bundle catalogue API (B1, B7).'),
  apiRoute('MTN_MOMO', 'ORANGE_DATA', 'DATA_BUNDLE', 'MEDIUM', 'Orange bundle paid with MTN MoMo. Needs MTN collection + Orange bundle API (B1, B4, B7).'),
  apiRoute('ORANGE_MONEY', 'MTN_DATA', 'DATA_BUNDLE', 'MEDIUM', 'MTN bundle paid with Orange Money. Needs Orange collection + MTN bundle API (B1, B4, B7).'),
];

export function findRoute(code: string): RouteDefinition | undefined {
  return ROUTE_DEFINITIONS.find((r) => r.code === code);
}

/** For a manual route, the receiving SIM is the NORMAL SIM of the source operator. */
export function receivingSimOperator(route: RouteDefinition): Operator | null {
  return route.processingMethod === 'MANUAL_SOURCE' ? op(route.source) : null;
}
