'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { pick } from '@/i18n/core';
import { callApi, errorText } from '@/lib/client';
import { ago, fcfa, num, when } from '@/lib/format';
import { componentLabel, groupLabel, stateLabel } from '@/lib/labels';
import { Badge, SimTag } from './ui';

type Widget =
  | 'KPIS_TODAY' | 'VERIFICATION_QUEUE' | 'SYSTEM_HEALTH' | 'OPEN_ALERTS' | 'VOLUME_7D' | 'BY_PRODUCT'
  | 'APPROVALS' | 'MESSAGING_TODAY' | 'MAINTENANCE' | 'RECENT_TRANSACTIONS' | 'RECENT_ACTIVITY';

export interface DashboardView {
  layout: Widget[];
  catalogue: Array<{ id: Widget; size: 1 | 2 | 3; en: string; fr: string }>;
  data: Partial<Record<Widget, unknown>>;
}

/** The home page: each person picks, orders and saves their own widgets. */
export function Dashboard({ initial }: { initial: DashboardView }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Widget[]>(initial.layout);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = (id: Widget) => view.catalogue.find((c) => c.id === id);

  function move(i: number, by: -1 | 1) {
    const j = i + by;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setDraft(next);
  }

  async function save(layout: Widget[]) {
    setBusy(true);
    setError(null);
    try {
      const v = await callApi<DashboardView>('admin/dashboard/layout', { method: 'PUT', body: JSON.stringify({ widgets: layout }) });
      setView(v);
      setDraft(v.layout);
      setEditing(false);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  const hidden = view.catalogue.filter((c) => !draft.includes(c.id));

  return (
    <>
      <div className="dash-tools">
        {editing ? (
          <>
            <button className="btn btn-primary" onClick={() => save(draft)} disabled={busy}>
              {busy ? t('common.working') : t('dash.save')}
            </button>
            <button className="btn btn-quiet" onClick={() => { setDraft(view.layout); setEditing(false); }} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-quiet" onClick={() => save(view.catalogue.map((c) => c.id))} disabled={busy}>
              {t('dash.showAll')}
            </button>
          </>
        ) : (
          <button className="btn btn-quiet" onClick={() => setEditing(true)}>
            {t('dash.customise')}
          </button>
        )}
      </div>
      {error && <p className="msg err">{error}</p>}

      {editing && hidden.length > 0 && (
        <div className="card add-widgets">
          <h2>{t('dash.addWidget')}</h2>
          <div className="chips">
            {hidden.map((c) => (
              <button key={c.id} type="button" className="chip" onClick={() => setDraft([...draft, c.id])}>
                + {pick(locale, c.en, c.fr)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="widgets">
        {(editing ? draft : view.layout).map((id, i) => {
          const c = info(id);
          if (!c) return null;
          return (
            <section key={id} className={`card widget w${c.size}${editing ? ' editing' : ''}`} aria-labelledby={`w-${id}`}>
              <div className="widget-head">
                <h2 id={`w-${id}`}>{pick(locale, c.en, c.fr)}</h2>
                {editing && (
                  <div className="widget-edit">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('dash.up')}>↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label={t('dash.down')}>↓</button>
                    <button type="button" onClick={() => setDraft(draft.filter((w) => w !== id))} aria-label={t('dash.remove')}>✕</button>
                  </div>
                )}
              </div>
              {editing && view.data[id] === undefined ? <p className="muted">{t('dash.afterSave')}</p> : <WidgetBody id={id} data={view.data[id]} />}
            </section>
          );
        })}
      </div>
      {!view.layout.length && !editing && <div className="empty">{t('dash.empty')}</div>}
    </>
  );
}

function WidgetBody({ id, data }: { id: Widget; data: unknown }) {
  const { t, locale } = useI18n();
  if (data === undefined || data === null) return <p className="muted">—</p>;
  switch (id) {
    case 'KPIS_TODAY': {
      const d = data as { transactions: number; completed: number; volume: number; platformFees: number; successRate: number | null; inProgress: number };
      return (
        <div className="kpis">
          <Kpi n={num(d.transactions)} l={t('kpi.transactions')} />
          <Kpi n={num(d.completed)} l={t('kpi.completed')} />
          <Kpi n={num(d.inProgress)} l={t('kpi.inProgress')} />
          <Kpi n={fcfa(d.volume)} l={t('kpi.volume')} />
          <Kpi n={fcfa(d.platformFees)} l={t('kpi.fees')} />
          <Kpi n={d.successRate === null ? '—' : `${d.successRate}%`} l={t('kpi.success')} tone={d.successRate !== null && d.successRate < 90 ? 'bad' : undefined} />
        </div>
      );
    }
    case 'VERIFICATION_QUEUE': {
      const d = data as { pending: number; secondApproval: number; onHold: number; oldestSubmittedAt: string | null };
      return (
        <>
          <div className="kpis three">
            <Kpi n={num(d.pending)} l={t('verif.pending')} tone={d.pending ? 'review' : undefined} href="/verifications" />
            <Kpi n={num(d.secondApproval)} l={t('verif.second')} href="/verifications?status=AWAITING_SECOND_APPROVAL" />
            <Kpi n={num(d.onHold)} l={t('verif.held')} tone={d.onHold ? 'bad' : undefined} href="/verifications?status=ON_HOLD,ESCALATED" />
          </div>
          {d.oldestSubmittedAt && <p className="muted small">{t('verif.oldest', { ago: ago(d.oldestSubmittedAt, locale) })}</p>}
        </>
      );
    }
    case 'SYSTEM_HEALTH': {
      const d = data as Array<{ component: string; status: string; summary: string }>;
      return (
        <ul className="health-list">
          {d.map((c) => (
            <li key={c.component}>
              <span className={`dot ${c.status}`} aria-hidden />
              <span className="grow">{componentLabel(t, c.component)}</span>
              <span className={`hstatus ${c.status}`}>{t(`health.${c.status}` as 'health.UP')}</span>
            </li>
          ))}
          <li className="more">
            <Link href="/monitoring">{t('dash.openMonitoring')} →</Link>
          </li>
        </ul>
      );
    }
    case 'OPEN_ALERTS': {
      const d = data as Array<{ id: string; severity: string; title: string; lastSeenAt: string; acknowledgedAt: string | null }>;
      if (!d.length) return <p className="good-line">✓ {t('alerts.none')}</p>;
      return (
        <ul className="plain-list">
          {d.map((a) => (
            <li key={a.id}>
              <span className={`sev ${a.severity}`}>{t(`severity.${a.severity}` as 'severity.WARNING')}</span> {a.title}
              <span className="muted small"> · {ago(a.lastSeenAt, locale)}{a.acknowledgedAt ? ` · ${t('alerts.taken')}` : ''}</span>
            </li>
          ))}
        </ul>
      );
    }
    case 'VOLUME_7D': {
      const d = data as Array<{ day: string; completed: number; volume: number; fees: number }>;
      const max = Math.max(1, ...d.map((x) => x.volume));
      return (
        <div className="bars" role="img" aria-label={t('dash.volumeChart')}>
          {d.map((x) => (
            <div key={x.day} className="bar-col" title={`${x.day}: ${fcfa(x.volume)} · ${x.completed}`}>
              <span className="bar-val">{x.volume ? num(Math.round(x.volume / 1000)) + 'k' : ''}</span>
              <span className="bar" style={{ height: `${Math.max(2, (x.volume / max) * 100)}%` }} />
              <span className="bar-day">{new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(x.day))}</span>
              <span className="bar-n">{x.completed}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'BY_PRODUCT': {
      const d = data as Record<string, { count: number; volume: number }>;
      const rows = Object.entries(d);
      if (!rows.length) return <p className="muted">{t('dash.nothingToday')}</p>;
      return (
        <dl className="mini-kv">
          {rows.map(([g, v]) => (
            <div key={g}>
              <dt>{groupLabel(t, g)}</dt>
              <dd>
                {fcfa(v.volume)} <span className="muted small">· {v.count}</span>
              </dd>
            </div>
          ))}
        </dl>
      );
    }
    case 'APPROVALS': {
      const d = data as { pricingRules: number; providerFeeRules: number; refunds: number; secondApprovals: number };
      const rows: Array<[string, number, string]> = [
        [t('approvals.pricing'), d.pricingRules, '/pricing'],
        [t('approvals.providerFees'), d.providerFeeRules, '/provider-fees'],
        [t('approvals.refunds'), d.refunds, '/refunds'],
        [t('approvals.second'), d.secondApprovals, '/verifications?status=AWAITING_SECOND_APPROVAL'],
      ];
      const total = rows.reduce((s, r) => s + r[1], 0);
      if (!total) return <p className="good-line">✓ {t('approvals.none')}</p>;
      return (
        <ul className="plain-list">
          {rows.filter((r) => r[1] > 0).map(([l, n, href]) => (
            <li key={href}>
              <Link href={href}>
                <strong>{n}</strong> {l}
              </Link>
            </li>
          ))}
        </ul>
      );
    }
    case 'MESSAGING_TODAY': {
      const d = data as Record<string, { sent: number; test: number; failed: number; queued: number; skipped: number }>;
      const rows = Object.entries(d);
      if (!rows.length) return <p className="muted">{t('dash.noMessages')}</p>;
      return (
        <dl className="mini-kv">
          {rows.map(([ch, v]) => (
            <div key={ch}>
              <dt>{componentLabel(t, `MESSAGING:${ch}`, ch)}</dt>
              <dd>
                {v.sent} {t('msg.sentShort')}
                {v.test ? ` · ${v.test} ${t('msg.testShort')}` : ''}
                {v.failed ? <span className="bad-text"> · {v.failed} {t('msg.failedShort')}</span> : null}
                {v.queued ? ` · ${v.queued} ${t('msg.queuedShort')}` : ''}
              </dd>
            </div>
          ))}
        </dl>
      );
    }
    case 'MAINTENANCE': {
      const d = data as { global: { messageEn: string; messageFr: string; endsAt: string | null } | null; paused: Array<{ id: string; messageEn: string; messageFr: string; serviceCodes: string[] }>; upcoming: Array<{ id: string; messageEn: string; messageFr: string; startsAt: string }> };
      if (!d.global && !d.paused.length && !d.upcoming.length) return <p className="good-line">✓ {t('maint.allOpen')}</p>;
      return (
        <ul className="plain-list">
          {d.global && <li><span className="sev CRITICAL">{t('maint.now')}</span> {pick(locale, d.global.messageEn, d.global.messageFr)}</li>}
          {d.paused.map((w) => (
            <li key={w.id}><span className="sev WARNING">{t('maint.paused', { n: w.serviceCodes.length })}</span> {pick(locale, w.messageEn, w.messageFr)}</li>
          ))}
          {d.upcoming.map((w) => (
            <li key={w.id}><span className="sev INFO">{when(w.startsAt, locale)}</span> {pick(locale, w.messageEn, w.messageFr)}</li>
          ))}
          <li className="more"><Link href="/maintenance">{t('dash.openMaintenance')} →</Link></li>
        </ul>
      );
    }
    case 'RECENT_TRANSACTIONS': {
      const d = data as Array<{ id: string; reference: string; state: string; customerPays: number; createdAt: string; isSimulated: boolean; service: { name: string } }>;
      if (!d.length) return <p className="muted">{t('dash.noTransactions')}</p>;
      return (
        <div className="table-wrap flat">
          <table className="t">
            <tbody>
              {d.map((x) => (
                <tr key={x.id}>
                  <td>
                    <Link href={`/transactions/${x.id}`} className="mono">{x.reference}</Link>
                    <SimTag on={x.isSimulated} />
                    <div className="sub">{x.service.name}</div>
                  </td>
                  <td><Badge value={x.state} label={stateLabel(t, x.state)} /></td>
                  <td className="num">{fcfa(x.customerPays)}<div className="sub">{ago(x.createdAt, locale)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'RECENT_ACTIVITY': {
      const d = data as Array<{ id: string; action: string; entityType: string; createdAt: string }>;
      if (!d.length) return <p className="muted">—</p>;
      return (
        <ul className="plain-list">
          {d.map((a) => (
            <li key={a.id}>
              <span className="mono">{a.action}</span> <span className="muted small">· {ago(a.createdAt, locale)}</span>
            </li>
          ))}
          <li className="more"><Link href="/audit">{t('dash.openAudit')} →</Link></li>
        </ul>
      );
    }
  }
}

function Kpi({ n, l, tone, href }: { n: string; l: string; tone?: 'bad' | 'review'; href?: string }) {
  const inner = (
    <>
      <span className={`kpi-n${tone ? ` ${tone}` : ''}`}>{n}</span>
      <span className="kpi-l">{l}</span>
    </>
  );
  return href ? <Link href={href} className="kpi">{inner}</Link> : <div className="kpi">{inner}</div>;
}
