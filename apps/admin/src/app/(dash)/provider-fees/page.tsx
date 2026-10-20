import { ActionForm } from '@/components/ActionForm';
import { Badge, PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/core';
import { fcfa, when } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.providerFees') };
}

interface Rule {
  id: string; operator: string; capability: string; version: number; status: string; feeType: string; percentageBps: number; fixedFee: number;
  minFee: number; maxFee: number | null; source: string; evidenceReference: string | null; deductedAtSettlement: boolean;
  changeReason: string; createdById: string; createdAt: string; provider: { code: string };
}

const CAPS = ['DISBURSE', 'COLLECT', 'AIRTIME_TOPUP', 'DATA_BUNDLE'];

export default async function ProviderFees() {
  const { t, locale } = await getT();
  const [rules, staff] = await Promise.all([load<Rule[]>('/admin/provider-fee-rules'), getStaff()]);
  return (
    <>
      <PageHead title={t('nav.providerFees')} sub={t('pfees.sub')} />
      <section className="card">
        <div className="table-wrap flat">
          <table className="t">
            <thead>
              <tr><th>{t('pfees.provider')}</th><th>{t('pfees.operation')}</th><th>{t('pricing.fee')}</th><th>{t('pfees.source')}</th><th>{t('pfees.charged')}</th><th>{t('pricing.status')}</th><th /></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.provider.code} v{r.version}<div className="sub">{when(r.createdAt, locale)}</div></td>
                  <td>{r.operator} · {t(`cap.${r.capability}` as MessageKey)}</td>
                  <td>{r.feeType === 'FIXED' ? fcfa(r.fixedFee) : `${r.percentageBps / 100}%${r.feeType === 'PERCENTAGE_PLUS_FIXED' ? ` + ${fcfa(r.fixedFee)}` : ''}`}</td>
                  <td><Badge value={r.source === 'VERIFIED' ? 'ACTIVE' : 'PENDING'} label={r.source === 'VERIFIED' ? t('pfees.verified') : t('pfees.estimate')} />{r.evidenceReference && <div className="sub">{r.evidenceReference}</div>}</td>
                  <td className="sub">{r.deductedAtSettlement ? t('pfees.byOperator') : t('pfees.byAmico')}</td>
                  <td><Badge value={r.status} label={stateLabel(t, r.status)} /><div className="sub">{r.changeReason}</div></td>
                  <td>
                    {r.status === 'PENDING_APPROVAL' && can(staff, 'PRICING_APPROVE') && r.createdById !== staff.id && (
                      <ActionForm path={`admin/provider-fee-rules/${r.id}/approve`} submit={t('common.approve')} compact />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>{t('pfees.record')}</h2>
        <ActionForm
          path="admin/provider-fee-rules"
          fields={[
            { name: 'providerCode', label: t('pfees.providerCode'), kind: 'text', defaultValue: 'MOCK', required: true },
            { name: 'operator', label: t('pfees.operator'), kind: 'select', options: [{ value: 'MTN', label: 'MTN' }, { value: 'ORANGE', label: 'Orange' }] },
            { name: 'capability', label: t('pfees.operation'), kind: 'select', options: CAPS.map((c) => ({ value: c, label: t(`cap.${c}` as MessageKey) })) },
            { name: 'feeType', label: t('fee.type'), kind: 'select', options: [{ value: 'FIXED', label: t('fee.FIXED') }, { value: 'PERCENTAGE', label: t('fee.PERCENTAGE') }, { value: 'PERCENTAGE_PLUS_FIXED', label: t('fee.PERCENTAGE_PLUS_FIXED') }] },
            { name: 'percentageBps', label: t('fee.bps'), kind: 'int', defaultValue: 0, hint: t('fee.bpsHint') },
            { name: 'fixedFee', label: t('fee.fixed'), kind: 'fcfa', defaultValue: 0 },
            { name: 'source', label: t('pfees.how'), kind: 'select', options: [{ value: 'ESTIMATE', label: t('pfees.howEstimate') }, { value: 'VERIFIED', label: t('pfees.howVerified') }] },
            { name: 'evidenceReference', label: t('pfees.evidence'), kind: 'text', hint: t('pfees.evidenceHint') },
            { name: 'deductedAtSettlement', label: t('pfees.deducted'), kind: 'checkbox' },
            { name: 'changeReason', label: t('common.reason'), kind: 'textarea', required: true },
          ]}
          submit={t('common.submitApproval')}
          columns
          done={t('pfees.submitted')}
        />
      </section>
    </>
  );
}
