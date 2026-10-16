/** Staff roles as shown in the dashboard (permissions are enforced by the API). */
export const ROLE_INFO: Array<{ role: string; label: string; does: string }> = [
  { role: 'ADMIN', label: 'Administrator', does: 'Services, SIMs, providers, pricing drafts, staff accounts' },
  { role: 'FINANCE', label: 'Finance', does: 'Approves fees and refunds, reports' },
  { role: 'OPERATIONS', label: 'Operations', does: 'Checks airtime, second approvals, refund requests' },
  { role: 'SUPPORT', label: 'Support', does: 'Reads transactions only' },
];

export const roleLabel = (r: string) => ROLE_INFO.find((x) => x.role === r)?.label ?? r;
