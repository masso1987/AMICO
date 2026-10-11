import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHead } from '@/components/ui';
import { when } from '@/lib/format';
import { load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Audit log' };

interface Entry { id: string; actorType: string; actorId: string | null; action: string; entityType: string; entityId: string | null; after: unknown; ip: string | null; createdAt: string }

const TYPES = ['', 'PricingRule', 'ProviderFeeRule', 'ManualVerification', 'Refund', 'Service', 'SimAccount', 'ProviderCapability', 'StaffUser', 'Transaction'];

function summary(after: unknown): string {
  if (!after || typeof after !== 'object') return '';
  const a = after as Record<string, unknown>;
  const pick = ['reason', 'evidenceNote', 'changeReason', 'notes', 'status', 'email', 'reference'].filter((k) => typeof a[k] === 'string' && a[k]);
  return pick.map((k) => `${k}: ${String(a[k]).slice(0, 80)}`).join('; ');
}

export default async function Audit(props: PageProps<'/audit'>) {
  const sp = await props.searchParams;
  const entityType = typeof sp.type === 'string' ? sp.type : '';
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const data = await load<{ total: number; items: Entry[] }>(`/admin/audit-logs?page=${page}&pageSize=50${entityType ? `&entityType=${entityType}` : ''}`);
  const pages = Math.max(1, Math.ceil(data.total / 50));

  return (
    <>
      <PageHead title="Audit log" sub="Every staff and system action, newest first. Entries can’t be edited or deleted." />
      <nav className="filters">
        {TYPES.map((t) => (
          <Link key={t || 'all'} href={t ? `/audit?type=${t}` : '/audit'} aria-current={t === entityType ? 'true' : undefined}>{t || 'All'}</Link>
        ))}
      </nav>
      {data.items.length === 0 ? (
        <Empty>No entries.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>On</th><th>Details</th></tr></thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td className="sub" style={{ whiteSpace: 'nowrap' }}>{when(e.createdAt)}</td>
                  <td>{e.actorType.toLowerCase()}<div className="sub mono">{e.actorId?.slice(0, 8) ?? '—'}</div></td>
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
          {page > 1 && <Link href={`/audit?page=${page - 1}${entityType ? `&type=${entityType}` : ''}`}>Newer</Link>}
          <span style={{ padding: '5px 4px', color: 'var(--muted)' }}>Page {page} of {pages}</span>
          {page < pages && <Link href={`/audit?page=${page + 1}${entityType ? `&type=${entityType}` : ''}`}>Older</Link>}
        </nav>
      )}
    </>
  );
}
