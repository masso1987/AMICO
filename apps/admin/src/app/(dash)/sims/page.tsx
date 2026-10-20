import { ActionForm } from '@/components/ActionForm';
import { RevealNumber } from '@/components/RevealNumber';
import { Badge, KV, PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { when } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.sims') };
}

interface Sim {
  id: string; code: string; label: string; operator: string; type: string; msisdnMasked: string; processingMethod: string; providerCode: string | null;
  active: boolean; notes: string; lastVerifiedAt: string | null; lastVerifiedStatus: string | null; updatedAt: string;
  receivingServices: Array<{ code: string; status: string }>;
}

export default async function Sims() {
  const { t, locale } = await getT();
  const [sims, staff] = await Promise.all([load<Sim[]>('/admin/sim-accounts'), getStaff()]);
  return (
    <>
      <PageHead title={t('nav.sims')} sub={t('sims.sub')} />
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
        {sims.map((s) => (
          <section key={s.id} className="card">
            <h2>
              {s.label} <Badge value={s.active ? 'ACTIVE' : 'DISABLED'} label={s.active ? t('sims.active') : t('sims.inactive')} />
            </h2>
            <KV
              rows={[
                [t('sims.number'), can(staff, 'SIM_READ_FULL') ? <RevealNumber key="n" simId={s.id} masked={s.msisdnMasked} /> : <span className="mono">{s.msisdnMasked}</span>],
                [t('sims.type'), `${s.operator} · ${s.type === 'BUSINESS' ? t('sims.business') : t('sims.normal')}`],
                [t('sims.usedFor'), s.type === 'BUSINESS' ? t('sims.forApi', { p: s.providerCode ?? '—' }) : t('sims.forAirtime')],
                [t('sims.services'), s.receivingServices.length ? s.receivingServices.map((r) => r.code).join(', ') : '—'],
                [t('sims.lastCheck'), s.lastVerifiedAt ? `${when(s.lastVerifiedAt, locale)}: ${s.lastVerifiedStatus}` : '—'],
                [t('sims.notes'), s.notes || '—'],
              ]}
            />
            {can(staff, 'SIM_WRITE') && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{t('common.edit')}</summary>
                <div style={{ marginTop: 10 }}>
                  <ActionForm
                    path={`admin/sim-accounts/${s.id}`}
                    method="PATCH"
                    fields={[
                      { name: 'label', label: t('sims.label'), kind: 'text', defaultValue: s.label },
                      { name: 'msisdn', label: t('sims.newNumber'), kind: 'text', placeholder: t('sims.newNumberHint') },
                      { name: 'active', label: t('sims.active'), kind: 'checkbox', defaultValue: s.active },
                      { name: 'lastVerifiedStatus', label: t('sims.checkResult'), kind: 'text', placeholder: t('sims.checkExample') },
                      { name: 'notes', label: t('sims.notes'), kind: 'textarea', defaultValue: s.notes },
                      { name: 'reason', label: t('common.reason'), kind: 'text', required: true },
                    ]}
                    submit={t('common.save')}
                    done={t('common.saved')}
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
