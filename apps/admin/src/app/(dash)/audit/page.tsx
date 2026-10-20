import Link from 'next/link';
import { Empty, PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { when } from '@/lib/format';
import { load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.audit') };
}

interface Entry { id: string; actorType: string; actorId: string | null; action: string; entityType: string; entityId: string | null; after: unknown; ip: string | null; createdAt: string }

const TYPES = ['', 'PricingRule', 'ProviderFeeRule', 'ManualVerification', 'Refund', 'Transaction', 'Service', 'Bundle', 'Offer', 'MaintenanceWindow', 'MessagingChannel', 'Broadcast', 'AccessRole', 'StaffUser', 'AppSetting', 'Alert', 'SimAccount', 'ProviderCapability'];

function summary(after: unknown): string {
  if (!after || typeof after !== 'object') return '';
  const a = after as Record<string, unknown>;
  const keys = ['reason', 'evidenceNote', 'changeReason', 'notes', 'status', 'email', 'reference', 'title', 'name'].filter((k) => typeof a[k] === 'string' && a[k]);
  return keys.map((k) => `${k}: ${String(a[k]).slice(0, 80)}`).join('; ');
}

export default async function Audit(props: PageProps<'/audit'>) {
  const { t, locale } = await getT();
  const sp = await props.searchParams;
  const entityType = typeof sp.type === 'string' && TYPES.includes(sp.type) ? sp.type : '';
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const data = await load<{ total: number; items: Entry[] }>(`/admin/audit-logs?page=${page}&pageSize=50${entityType ? `&entityType=${entityType}` : ''}`);
  const pages = Math.max(1, Math.ceil(data.total / 50));

  return (
    <>
      <PageHead title={t('nav.audit')} sub={t('audit.sub')}>
        <a className="btn btn-quiet" href={`/api/proxy/admin/audit-logs/export${entityType ? `?entityType=${entityType}` : ''}`} download>
          {t('audit.export')}
        </a>
      </PageHead>
      <nav className="filters">
        {TYPES.map((x) => (
          <Link key={x || 'all'} href={x ? `/audit?type=${x}` : '/audit'} aria-current={x === entityType ? 'true' : undefined}>{x || t('common.all')}</Link>
        ))}
      </nav>
      {data.items.length === 0 ? (
        <Empty>{t('audit.none')}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('audit.when')}</th><th>{t('audit.who')}</th><th>{t('audit.action')}</th><th>{t('audit.on')}</th><th>{t('audit.details')}</th></tr></thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td className="sub nowrap">{when(e.createdAt, locale)}</td>
                  <td>{t(`actor.${e.actorType}` as 'actor.STAFF')}<div className="sub mono">{e.actorId?.slice(0, 8) ?? '—'}</div></td>
                  <td className="mono">{e.action}</td>
                  <td>{e.entityType}<div className="sub mono">{e.entityId?.slice(0, 8) ?? ''}</div></td>
                  <td className="sub">{summary(e.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="filters" style={{ marginTop: 12 }}>
          {page > 1 && <Link href={`/audit?page=${page - 1}${entityType ? `&type=${entityType}` : ''}`}>{t('common.newer')}</Link>}
          <span style={{ padding: '5px 4px', color: 'var(--muted)' }}>{t('common.pageOf', { page, pages })}</span>
          {page < pages && <Link href={`/audit?page=${page + 1}${entityType ? `&type=${entityType}` : ''}`}>{t('common.older')}</Link>}
        </nav>
      )}
    </>
  );
}
