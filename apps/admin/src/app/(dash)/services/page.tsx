import { ActionForm } from '@/components/ActionForm';
import { Badge, PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { ASSET_LABEL, fcfa } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.services') };
}

interface Service {
  id: string; code: string; name: string; status: string; sourceAsset: string; destinationAsset: string; processingMethod: string;
  quoteTtlSeconds: number; allowEstimatedProviderFee: boolean; dualApprovalThreshold: number; verificationNotes: string;
  receivingSim: { code: string; msisdnMasked: string; active: boolean } | null;
  readiness: { available: boolean; reasons: string[] };
}

export default async function Services() {
  const { t } = await getT();
  const [list, staff] = await Promise.all([load<Service[]>('/admin/services'), getStaff()]);
  const write = can(staff, 'CATALOGUE_WRITE');
  return (
    <>
      <PageHead title={t('nav.services')} sub={t('services.sub')} />
      <div className="stack">
        {list.map((s) => (
          <section key={s.id} className="card">
            <div className="row-between" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>
                  {ASSET_LABEL[s.sourceAsset]} → {ASSET_LABEL[s.destinationAsset]} <Badge value={s.status} label={stateLabel(t, s.status)} />
                </h2>
                <div className="muted small">
                  <span className="mono">{s.code}</span>,{' '}
                  {s.processingMethod === 'MANUAL_SOURCE'
                    ? s.receivingSim ? t('services.receivedOn', { sim: `${s.receivingSim.code} (${s.receivingSim.msisdnMasked})` }) : t('services.noSim')
                    : t('services.viaProvider')}
                </div>
              </div>
              {write && (
                <div>
                  {s.status === 'ENABLED' ? (
                    <ActionForm path={`admin/services/${s.id}/disable`} fields={[{ name: 'reason', label: t('common.reason'), kind: 'text', required: true }]} submit={t('services.switchOff')} variant="danger" compact />
                  ) : s.readiness.available ? (
                    <ActionForm path={`admin/services/${s.id}/enable`} fields={[{ name: 'reason', label: t('common.reason'), kind: 'text', required: true }]} submit={t('services.switchOn')} compact />
                  ) : null}
                </div>
              )}
            </div>
            {!s.readiness.available && (
              <ul className="note" style={{ margin: '12px 0 0', paddingLeft: 28 }}>
                {s.readiness.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              {t('services.facts', { min: Math.round(s.quoteTtlSeconds / 60), dual: fcfa(s.dualApprovalThreshold) })}{' '}
              {s.allowEstimatedProviderFee ? t('services.estimateAllowed') : t('services.estimateNotAllowed')} {s.verificationNotes}
            </p>
            {write && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{t('services.settings')}</summary>
                <div style={{ marginTop: 10 }}>
                  <ActionForm
                    path={`admin/services/${s.id}`}
                    method="PATCH"
                    fields={[
                      { name: 'quoteTtlSeconds', label: t('services.ttl'), kind: 'int', defaultValue: s.quoteTtlSeconds },
                      { name: 'dualApprovalThreshold', label: t('services.dual'), kind: 'fcfa', defaultValue: s.dualApprovalThreshold },
                      { name: 'allowEstimatedProviderFee', label: t('services.allowEstimate'), kind: 'checkbox', defaultValue: s.allowEstimatedProviderFee },
                      { name: 'reason', label: t('common.reason'), kind: 'text', required: true },
                    ]}
                    submit={t('common.save')}
                    done={t('common.saved')}
                    compact
                  />
                </div>
              </details>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
