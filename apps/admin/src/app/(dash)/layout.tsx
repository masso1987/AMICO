import { Rail, type NavItem } from '@/components/Rail';
import { getT } from '@/i18n/server';
import { pick } from '@/i18n/core';
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

interface StatusView {
  global: { messageEn: string; messageFr: string } | null;
  paused: Array<{ id: string; messageEn: string; messageFr: string }>;
}

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const { t, locale } = await getT();
  const staff = await getStaff();
  const [sim, queue, alerts, roles, status] = await Promise.all([
    simulationMode(),
    can(staff, 'VERIFY_MANUAL') ? apiFetch<Array<{ status: string }>>('/admin/verifications').catch(() => []) : Promise.resolve([]),
    can(staff, 'MONITORING_READ') ? apiFetch<Array<{ severity: string }>>('/admin/alerts?open=1').catch(() => []) : Promise.resolve([]),
    apiFetch<Array<{ key: string; name: string }>>('/admin/access/roles').catch(() => []),
    apiFetch<StatusView>('/status').catch(() => null),
  ]);
  const pendingChecks = queue.filter((v) => v.status === 'PENDING' || v.status === 'AWAITING_SECOND_APPROVAL').length;

  const ops = t('nav.group.operations');
  const cat = t('nav.group.catalogue');
  const plat = t('nav.group.platform');
  const fin = t('nav.group.finance');
  const ppl = t('nav.group.people');
  const items: NavItem[] = [
    { href: '/', label: t('nav.dashboardHome'), group: ops },
    ...(can(staff, 'VERIFY_MANUAL') ? [{ href: '/verifications', label: t('nav.verifications'), group: ops, count: pendingChecks }] : []),
    ...(can(staff, 'TRANSACTION_READ') ? [{ href: '/transactions', label: t('nav.transactions'), group: ops }] : []),
    ...(can(staff, 'REFUND_REQUEST') ? [{ href: '/refunds', label: t('nav.refunds'), group: ops }] : []),
    ...(can(staff, 'TRANSACTION_READ') ? [{ href: '/services', label: t('nav.services'), group: cat }] : []),
    ...(can(staff, 'TRANSACTION_READ') ? [{ href: '/bundles', label: t('nav.bundles'), group: cat }] : []),
    ...(can(staff, 'TRANSACTION_READ') ? [{ href: '/offers', label: t('nav.offers'), group: cat }] : []),
    ...(can(staff, 'PRICING_DRAFT') ? [{ href: '/sell-credit', label: t('nav.sellCredit'), group: cat }] : []),
    ...(can(staff, 'PRICING_DRAFT') ? [{ href: '/pricing', label: t('nav.pricing'), group: cat }] : []),
    ...(can(staff, 'PROVIDER_FEE_WRITE') ? [{ href: '/provider-fees', label: t('nav.providerFees'), group: cat }] : []),
    ...(can(staff, 'MONITORING_READ') ? [{ href: '/monitoring', label: t('nav.monitoring'), group: plat, count: alerts.length, alert: alerts.some((a) => a.severity === 'CRITICAL') }] : []),
    ...(can(staff, 'MONITORING_READ') ? [{ href: '/maintenance', label: t('nav.maintenance'), group: plat }] : []),
    ...(can(staff, 'MESSAGING_SEND') || can(staff, 'MESSAGING_CONFIGURE') ? [{ href: '/messaging', label: t('nav.messaging'), group: plat }] : []),
    ...(can(staff, 'SIM_READ_MASKED') ? [{ href: '/sims', label: t('nav.sims'), group: plat }] : []),
    ...(can(staff, 'SIM_READ_MASKED') ? [{ href: '/providers', label: t('nav.providers'), group: plat }] : []),
    ...(can(staff, 'SETTINGS_MANAGE') || can(staff, 'MESSAGING_CONFIGURE') ? [{ href: '/settings', label: t('nav.settings'), group: plat }] : []),
    ...(can(staff, 'REPORT_READ') ? [{ href: '/reports', label: t('nav.reports'), group: fin }] : []),
    ...(can(staff, 'AUDIT_READ') ? [{ href: '/audit', label: t('nav.audit'), group: fin }] : []),
    ...(can(staff, 'STAFF_MANAGE') ? [{ href: '/staff', label: t('nav.staff'), group: ppl }] : []),
    ...(can(staff, 'ACCESS_MANAGE') ? [{ href: '/access', label: t('nav.access'), group: ppl }] : []),
    { href: '/account', label: t('nav.account'), group: ppl },
  ];
  const roleNames = staff.roles.map((r) => roles.find((x) => x.key === r)?.name ?? r);
  const live = status?.global ? [status.global] : (status?.paused ?? []);

  return (
    <div className="shell">
      <Rail items={items} name={staff.fullName} roles={roleNames} />
      <div className="main">
        {sim && <div className="sim-strip">{t('shell.simulation')}</div>}
        {live.map((w, i) => (
          <div key={i} className="maint-strip" role="status">
            <strong>{status?.global ? t('shell.maintenanceAll') : t('shell.maintenanceSome')}</strong> {pick(locale, w.messageEn, w.messageFr)}
          </div>
        ))}
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
