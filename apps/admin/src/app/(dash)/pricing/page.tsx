import { ActionForm } from '@/components/ActionForm';
import { Simulator } from '@/components/Simulator';
import { Badge, PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/core';
import { fcfa, when } from '@/lib/format';
import { stateLabel } from '@/lib/labels';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.pricing') };
}

interface Rule {
  id: string; version: number; status: string; feeType: string; percentageBps: number; fixedFee: number; minFee: number; maxFee: number | null;
  minAmount: number; maxAmount: number; deductionMethod: string; conversionRatePpm: number; effectiveFrom: string; effectiveTo: string | null;
  changeReason: string; createdById: string; approvedById: string | null; rejectedReason: string | null; service: { code: string; name: string };
}

const METHODS = ['DEDUCT_FROM_SOURCE', 'DEDUCT_FROM_DESTINATION', 'ADD_TO_PAYMENT'];

export default async function Pricing() {
  const { t, locale } = await getT();
  const [rules, services, staff] = await Promise.all([load<Rule[]>('/admin/pricing-rules'), load<Array<{ code: string; name: string }>>('/admin/services'), getStaff()]);
  const approve = can(staff, 'PRICING_APPROVE');
  const now = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
  const feeText = (r: Rule) => {
    const pct = `${r.percentageBps / 100}%`;
    const core = r.feeType === 'FIXED' ? fcfa(r.fixedFee) : r.feeType === 'PERCENTAGE' ? pct : `${pct} + ${fcfa(r.fixedFee)}`;
    return `${core}, min ${fcfa(r.minFee)}${r.maxFee !== null ? `, max ${fcfa(r.maxFee)}` : ''}`;
  };

  return (
    <>
      <PageHead title={t('nav.pricing')} sub={t('pricing.sub')} />

      <section className="card">
        <h2>{t('pricing.simulator')}</h2>
        <Simulator
          services={services.filter((s) => rules.some((r) => r.service.code === s.code && ['ACTIVE', 'PENDING_APPROVAL'].includes(r.status))).map((s) => ({ code: s.code, name: s.name }))}
          rules={rules.filter((r) => ['ACTIVE', 'PENDING_APPROVAL'].includes(r.status)).map((r) => ({ id: r.id, serviceCode: r.service.code, label: `v${r.version} (${r.status === 'ACTIVE' ? t('pricing.active') : t('pricing.pending')})` }))}
        />
      </section>

      <section className="card">
        <h2>{t('pricing.rules')}</h2>
        <div className="table-wrap flat">
          <table className="t">
            <thead>
              <tr><th>{t('pricing.service')}</th><th>{t('pricing.version')}</th><th>{t('pricing.fee')}</th><th>{t('pricing.limits')}</th><th>{t('pricing.method')}</th><th>{t('pricing.effective')}</th><th>{t('pricing.status')}</th><th style={{ width: 260 }} /></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.service.name}<div className="sub mono">{r.service.code}</div></td>
                  <td>v{r.version}</td>
                  <td>{feeText(r)}{r.conversionRatePpm !== 1_000_000 && <div className="sub">{t('pricing.airtimeRate', { pct: (r.conversionRatePpm / 10_000).toFixed(2) })}</div>}</td>
                  <td className="sub">{t('pricing.range', { min: fcfa(r.minAmount), max: fcfa(r.maxAmount) })}</td>
                  <td className="sub">{t(`method.${r.deductionMethod}` as MessageKey)}</td>
                  <td className="sub">{when(r.effectiveFrom, locale)}{r.effectiveTo ? ` → ${when(r.effectiveTo, locale)}` : ''}</td>
                  <td><Badge value={r.status} label={stateLabel(t, r.status)} />{r.rejectedReason && <div className="sub">{r.rejectedReason}</div>}<div className="sub">{r.changeReason}</div></td>
                  <td>
                    {r.status === 'PENDING_APPROVAL' && approve && r.createdById !== staff.id && (
                      <>
                        <ActionForm path={`admin/pricing-rules/${r.id}/approve`} submit={t('common.approve')} confirm={t('pricing.approveConfirm', { v: r.version, name: r.service.name })} compact />
                        <ActionForm path={`admin/pricing-rules/${r.id}/reject`} fields={[{ name: 'reason', label: t('common.reason'), kind: 'text', required: true }]} submit={t('common.reject')} variant="danger" compact />
                      </>
                    )}
                    {r.status === 'PENDING_APPROVAL' && r.createdById === staff.id && <span className="sub">{t('refunds.waitingColleague')}</span>}
                    {r.status === 'ACTIVE' && approve && (
                      <details>
                        <summary style={{ cursor: 'pointer' }}>{t('pricing.retire')}</summary>
                        <ActionForm path={`admin/pricing-rules/${r.id}/retire`} fields={[{ name: 'reason', label: t('common.reason'), kind: 'text', required: true }]} submit={t('pricing.retireRule')} variant="danger" />
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>{t('pricing.propose')}</h2>
        <ActionForm
          path="admin/pricing-rules"
          fields={[
            { name: 'serviceCode', label: t('pricing.service'), kind: 'select', options: services.map((s) => ({ value: s.code, label: s.name })) },
            { name: 'feeType', label: t('fee.type'), kind: 'select', options: [
              { value: 'PERCENTAGE_PLUS_FIXED', label: t('fee.PERCENTAGE_PLUS_FIXED') },
              { value: 'PERCENTAGE', label: t('fee.PERCENTAGE') },
              { value: 'FIXED', label: t('fee.FIXED') },
            ] },
            { name: 'percentageBps', label: t('fee.bps'), kind: 'int', defaultValue: 100, hint: t('fee.bpsHint') },
            { name: 'fixedFee', label: t('fee.fixed'), kind: 'fcfa', defaultValue: 50 },
            { name: 'minFee', label: t('fee.min'), kind: 'fcfa', defaultValue: 100 },
            { name: 'maxFee', label: t('fee.max'), kind: 'fcfa', hint: t('fee.maxHint') },
            { name: 'minAmount', label: t('fee.minAmount'), kind: 'fcfa', defaultValue: 500, required: true },
            { name: 'maxAmount', label: t('fee.maxAmount'), kind: 'fcfa', defaultValue: 500000, required: true },
            { name: 'deductionMethod', label: t('pricing.method'), kind: 'select', options: METHODS.map((m) => ({ value: m, label: t(`method.${m}` as MessageKey) })), defaultValue: 'DEDUCT_FROM_DESTINATION' },
            { name: 'conversionRatePpm', label: t('fee.ppm'), kind: 'int', defaultValue: 1000000, hint: t('fee.ppmHint') },
            { name: 'effectiveFrom', label: t('fee.effective'), kind: 'date', defaultValue: now, required: true, hint: t('fee.effectiveHint') },
            { name: 'changeReason', label: t('common.reason'), kind: 'textarea', required: true },
          ]}
          submit={t('common.submitApproval')}
          columns
          done={t('pricing.submitted')}
        />
      </section>
    </>
  );
}
