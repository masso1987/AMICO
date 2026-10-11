import { Rail, type NavItem } from '@/components/Rail';
import { apiFetch, apiUrl } from '@/lib/session';
import { can, getStaff } from '@/lib/staff';

async function simulationMode() {
  try {
    const r = await fetch(apiUrl('/health'), { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    return (await r.json()).simulationMode !== false;
  } catch {
    return true;
  }
}

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  const [sim, queue] = await Promise.all([
    simulationMode(),
    can(staff, 'VERIFY_MANUAL') ? apiFetch<unknown[]>('/admin/verifications').catch(() => []) : Promise.resolve([]),
  ]);

  const items: NavItem[] = [
    { href: '/', label: 'Overview', group: 'Operations' },
    ...(can(staff, 'VERIFY_MANUAL') ? [{ href: '/verifications', label: 'Airtime checks', group: 'Operations', count: queue.length }] : []),
    ...(can(staff, 'TRANSACTION_READ') ? [{ href: '/transactions', label: 'Transactions', group: 'Operations' }] : []),
    ...(can(staff, 'REFUND_REQUEST') ? [{ href: '/refunds', label: 'Refunds', group: 'Operations' }] : []),
    ...(can(staff, 'TRANSACTION_READ') ? [{ href: '/services', label: 'Services', group: 'Configuration' }] : []),
    ...(can(staff, 'PRICING_DRAFT') ? [{ href: '/pricing', label: 'Fees and pricing', group: 'Configuration' }] : []),
    ...(can(staff, 'PROVIDER_FEE_WRITE') ? [{ href: '/provider-fees', label: 'Operator fees', group: 'Configuration' }] : []),
    ...(can(staff, 'SIM_READ_MASKED') ? [{ href: '/sims', label: 'SIM accounts', group: 'Configuration' }] : []),
    ...(can(staff, 'SIM_READ_MASKED') ? [{ href: '/providers', label: 'Providers', group: 'Configuration' }] : []),
    ...(can(staff, 'REPORT_READ') ? [{ href: '/reports', label: 'Reports', group: 'Finance' }] : []),
    ...(can(staff, 'AUDIT_READ') ? [{ href: '/audit', label: 'Audit log', group: 'Finance' }] : []),
  ];

  return (
    <div className="shell">
      <Rail items={items} name={staff.fullName} roles={staff.roles} />
      <div className="main">
        {sim && <div className="sim-strip">Simulation mode: provider calls are mocked and no real money or airtime moves.</div>}
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
