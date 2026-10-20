import { ActionForm } from '@/components/ActionForm';
import { Badge, PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/core';
import { when } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.providers') };
}

interface Provider {
  id: string; code: string; name: string; simulated: boolean; active: boolean;
  capabilities: Array<{ id: string; operator: string; capability: string; enabled: boolean; verifiedAt: string | null; notes: string; adapterLoaded: boolean }>;
}

export default async function Providers() {
  const { t, locale } = await getT();
  const [list, staff] = await Promise.all([load<Provider[]>('/admin/providers'), getStaff()]);
  const write = can(staff, 'PROVIDER_CAPABILITY_WRITE');
  return (
    <>
      <PageHead title={t('nav.providers')} sub={t('providers.sub')} />
      <div className="stack">
        {list.map((p) => (
          <section key={p.id} className="card">
            <h2>{p.name} <span className="mono muted">{p.code}</span> {p.simulated && <span className="sim-tag">{t('common.simulated')}</span>}</h2>
            <div className="table-wrap flat">
              <table className="t">
                <thead><tr><th>{t('pfees.operator')}</th><th>{t('providers.capability')}</th><th>{t('pricing.status')}</th><th>{t('providers.adapter')}</th><th>{t('sims.notes')}</th><th style={{ width: 300 }} /></tr></thead>
                <tbody>
                  {p.capabilities.map((c) => (
                    <tr key={c.id}>
                      <td>{c.operator}</td>
                      <td>{t(`cap.${c.capability}` as MessageKey)}</td>
                      <td>
                        {c.enabled && c.verifiedAt ? <Badge value="ACTIVE" label={t('providers.verified')} /> : <Badge value="DISABLED" label={c.enabled ? t('providers.notVerified') : t('providers.off')} />}
                        {c.verifiedAt && <div className="sub">{when(c.verifiedAt, locale)}</div>}
                      </td>
                      <td className="sub">{c.adapterLoaded ? t('providers.loaded') : t('providers.notLoaded')}</td>
                      <td className="sub">{c.notes}</td>
                      <td>
                        {write && (c.enabled && c.verifiedAt ? (
                          <ActionForm path={`admin/providers/capabilities/${c.id}/disable`} fields={[{ name: 'notes', label: t('providers.why'), kind: 'text', required: true }]} submit={t('providers.turnOff')} variant="danger" compact />
                        ) : (
                          <ActionForm path={`admin/providers/capabilities/${c.id}/verify`} fields={[{ name: 'notes', label: t('providers.tested'), kind: 'text', required: true }]} submit={t('providers.markVerified')} compact />
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
