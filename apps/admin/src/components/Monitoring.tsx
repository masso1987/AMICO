'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { callApi, errorText } from '@/lib/client';
import { ago, when } from '@/lib/format';
import { componentLabel } from '@/lib/labels';

type Status = 'UP' | 'DEGRADED' | 'DOWN';
export interface MonitoringView {
  at: string;
  checks: Array<{ component: string; label: string; status: Status; latencyMs?: number | null; summary: string; history: Array<Status | null>; uptime24h: number | null }>;
  alerts: Array<{ id: string; key: string; severity: string; title: string; detail: string; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null; acknowledgedAt: string | null; acknowledgedById: string | null }>;
}

/** Live health, 24 h history per component and the alert list. Refreshes every 30 s. */
export function Monitoring({ initial }: { initial: MonitoringView }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await callApi<MonitoringView>('admin/monitoring'));
    } catch {
      /* keep last view */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function sample() {
    setBusy(true);
    setError(null);
    try {
      await callApi('admin/monitoring/sample', { method: 'POST', body: '{}' });
      await refresh();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function ack(id: string) {
    setError(null);
    try {
      await callApi(`admin/alerts/${id}/acknowledge`, { method: 'POST', body: '{}' });
      await refresh();
    } catch (e) {
      setError(errorText(e, t));
    }
  }

  const down = view.checks.filter((c) => c.status === 'DOWN').length;
  const degraded = view.checks.filter((c) => c.status === 'DEGRADED').length;
  const open = view.alerts.filter((a) => !a.resolvedAt);
  const recent = view.alerts.filter((a) => a.resolvedAt);
  const overall: Status = down ? 'DOWN' : degraded ? 'DEGRADED' : 'UP';

  return (
    <div className="stack">
      <div className={`card overall ${overall}`}>
        <div>
          <span className={`dot big ${overall}`} aria-hidden />
          <strong>{t(`mon.overall.${overall}` as 'mon.overall.UP')}</strong>
          <span className="muted small"> · {t('mon.checkedAt', { at: when(view.at, locale) })}</span>
        </div>
        <button className="btn btn-quiet" onClick={sample} disabled={busy}>
          {busy ? t('common.working') : t('mon.checkNow')}
        </button>
      </div>
      {error && <p className="msg err">{error}</p>}

      <section className="card" aria-labelledby="checks">
        <h2 id="checks">{t('mon.components')}</h2>
        <div className="health-table">
          {view.checks.map((c) => (
            <div key={c.component} className="health-row">
              <div className="h-name">
                <span className={`dot ${c.status}`} aria-hidden />
                <div>
                  <strong>{componentLabel(t, c.component, c.label)}</strong>
                  <div className="muted small">{c.summary}</div>
                </div>
              </div>
              <div className="h-cells" aria-label={t('mon.history')}>
                {c.history.map((s, i) => (
                  <span key={i} className={`cell ${s ?? 'NONE'}`} title={`${24 - i} h · ${s ?? '—'}`} />
                ))}
              </div>
              <div className="h-up">
                <span className={`hstatus ${c.status}`}>{t(`health.${c.status}` as 'health.UP')}</span>
                <span className="muted small">{c.uptime24h === null ? '—' : t('mon.uptime', { pct: c.uptime24h })}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>{t('mon.legend')}</p>
      </section>

      <section className="card" aria-labelledby="alerts">
        <h2 id="alerts">{t('mon.openAlerts', { n: open.length })}</h2>
        {open.length ? (
          <ul className="alert-list">
            {open.map((a) => (
              <li key={a.id} className={a.severity}>
                <div>
                  <span className={`sev ${a.severity}`}>{t(`severity.${a.severity}` as 'severity.WARNING')}</span> <strong>{a.title}</strong>
                  <div className="muted small">
                    {a.detail} · {t('mon.since', { ago: ago(a.firstSeenAt, locale) })}
                  </div>
                </div>
                {a.acknowledgedAt ? (
                  <span className="badge tone-wait">{t('alerts.taken')}</span>
                ) : (
                  <button className="btn btn-quiet" onClick={() => ack(a.id)}>
                    {t('mon.take')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="good-line">✓ {t('alerts.none')}</p>
        )}
        {recent.length > 0 && (
          <>
            <h3 className="sub-h">{t('mon.resolved')}</h3>
            <ul className="plain-list">
              {recent.slice(0, 10).map((a) => (
                <li key={a.id}>
                  <span className="muted">{when(a.resolvedAt, locale)}</span> · {a.title}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>{t('mon.alertsHint')}</p>
      </section>
    </div>
  );
}
