import Link from 'next/link';
import { BroadcastForm, DirectSend, GatewayCard, type Channel } from '@/components/Messaging';
import { PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/core';
import { phone, when } from '@/lib/format';
import { componentLabel } from '@/lib/labels';
import { apiFetch } from '@/lib/session';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.messaging') };
}

interface Msg { id: string; to: string; body: string; purpose: string; status: string; channel: string | null; requested: string; attempts: number; error: string | null; testMode: boolean; createdAt: string; sentAt: string | null }
type Stats = Record<string, { sent: number; test: number; failed: number; queued: number; skipped: number }>;

const TABS = ['gateways', 'send', 'broadcast', 'log'] as const;
const STATUS = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'];

export default async function Page(props: PageProps<'/messaging'>) {
  const { t, locale } = await getT();
  const staff = await getStaff();
  const sp = await props.searchParams;
  const canConf = can(staff, 'MESSAGING_CONFIGURE');
  const canSend = can(staff, 'MESSAGING_SEND');
  const tabs = TABS.filter((x) => (x === 'gateways' ? canConf : canSend));
  const tab = (tabs as readonly string[]).includes(String(sp.tab)) ? (String(sp.tab) as (typeof TABS)[number]) : tabs[0]!;
  const status = typeof sp.status === 'string' && STATUS.includes(sp.status) ? sp.status : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const [channels, stats, log] = await Promise.all([
    tab === 'gateways' ? load<Channel[]>('/admin/messaging/channels') : Promise.resolve([]),
    can(staff, 'MONITORING_READ') ? apiFetch<Stats>('/admin/messaging/stats').catch(() => ({}) as Stats) : Promise.resolve(null),
    tab === 'log' ? load<{ total: number; items: Msg[] }>(`/admin/messaging/messages?page=${page}&pageSize=50${status ? `&status=${status}` : ''}`) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHead title={t('nav.messaging')} sub={t('msg.sub')} />
      {stats && (
        <div className="kpis-row">
          {(['SMS_MTN', 'SMS_ORANGE', 'WHATSAPP'] as const).map((ch) => {
            const s = stats[ch] ?? { sent: 0, test: 0, failed: 0, queued: 0, skipped: 0 };
            return (
              <div key={ch} className="card mini-stat">
                <span className="muted small">{componentLabel(t, `MESSAGING:${ch}`, ch)} · {t('msg.today')}</span>
                <strong>{s.sent}</strong>
                <span className="small">
                  {s.test ? `${s.test} ${t('msg.testShort')} · ` : ''}
                  <span className={s.failed ? 'bad-text' : ''}>{s.failed} {t('msg.failedShort')}</span> · {s.queued} {t('msg.queuedShort')}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <nav className="filters tabs" aria-label={t('msg.sections')}>
        {tabs.map((x) => (
          <Link key={x} href={`/messaging?tab=${x}`} aria-current={x === tab ? 'true' : undefined}>
            {t(`msg.tab.${x}` as MessageKey)}
          </Link>
        ))}
      </nav>

      {tab === 'gateways' && (
        <div className="stack">
          <p className="note info">{t('msg.gatewaysHelp')}</p>
          {channels.map((c) => (
            <GatewayCard key={c.channel} channel={c} />
          ))}
        </div>
      )}
      {tab === 'send' && <DirectSend />}
      {tab === 'broadcast' && <BroadcastForm />}
      {tab === 'log' && log && (
        <>
          <div className="filters">
            <Link href="/messaging?tab=log" aria-current={!status ? 'true' : undefined}>{t('common.all')}</Link>
            {STATUS.map((s) => (
              <Link key={s} href={`/messaging?tab=log&status=${s}`} aria-current={status === s ? 'true' : undefined}>
                {t(`msgStatus.${s}` as MessageKey)}
              </Link>
            ))}
          </div>
          {log.items.length ? (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>{t('msg.col.when')}</th>
                    <th>{t('msg.col.to')}</th>
                    <th>{t('msg.col.channel')}</th>
                    <th>{t('msg.col.purpose')}</th>
                    <th>{t('msg.col.message')}</th>
                    <th>{t('msg.col.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {log.items.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">{when(m.createdAt, locale)}</td>
                      <td className="nowrap">{phone(m.to)}</td>
                      <td>{m.channel ? componentLabel(t, `MESSAGING:${m.channel}`, m.channel) : <span className="muted">{m.requested}</span>}</td>
                      <td>{m.purpose}</td>
                      <td className="msg-body">{m.body}</td>
                      <td>
                        <span className={`badge ${m.status === 'SENT' ? 'tone-good' : m.status === 'FAILED' ? 'tone-bad' : m.status === 'SKIPPED' ? '' : 'tone-wait'}`}>{t(`msgStatus.${m.status}` as MessageKey)}</span>
                        {m.testMode && <span className="sim-tag">{t('msg.testShort')}</span>}
                        {m.error && <div className="sub bad-text">{m.error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">{t('msg.noneLogged')}</div>
          )}
          {log.total > 50 && (
            <div className="filters" style={{ marginTop: 12 }}>
              {page > 1 && <Link href={`/messaging?tab=log&page=${page - 1}${status ? `&status=${status}` : ''}`}>← {t('common.newer')}</Link>}
              <span className="muted small">{t('common.pageOf', { page, pages: Math.ceil(log.total / 50) })}</span>
              {page * 50 < log.total && <Link href={`/messaging?tab=log&page=${page + 1}${status ? `&status=${status}` : ''}`}>{t('common.older')} →</Link>}
            </div>
          )}
        </>
      )}
    </>
  );
}
