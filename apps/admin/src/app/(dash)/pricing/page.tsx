import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { Simulator } from '@/components/Simulator';
import { Badge, PageHead } from '@/components/ui';
import { fcfa, when } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Fees and pricing' };

interface Rule {
  id: string; version: number; status: string; feeType: string; percentageBps: number; fixedFee: number; minFee: number; maxFee: number | null;
  minAmount: number; maxAmount: number; deductionMethod: string; conversionRatePpm: number; effectiveFrom: string; effectiveTo: string | null;
  changeReason: string; createdById: string; approvedById: string | null; rejectedReason: string | null; service: { code: string; name: string };
}

function feeText(r: Rule) {
  const pct = `${r.percentageBps / 100}%`;
  const core = r.feeType === 'FIXED' ? fcfa(r.fixedFee) : r.feeType === 'PERCENTAGE' ? pct : `${pct} + ${fcfa(r.fixedFee)}`;
  return `${core}, min ${fcfa(r.minFee)}${r.maxFee !== null ? `, max ${fcfa(r.maxFee)}` : ''}`;
}

const METHOD: Record<string, string> = {
  DEDUCT_FROM_SOURCE: 'Fees taken from the amount sent',
  DEDUCT_FROM_DESTINATION: 'Fees taken from the amount delivered',
  ADD_TO_PAYMENT: 'Fees added on top of the payment',
};

export default async function Pricing() {
  const [rules, services, staff] = await Promise.all([
    load<Rule[]>('/admin/pricing-rules'),
    load<Array<{ code: string; name: string }>>('/admin/services'),
    getStaff(),
  ]);
  const approve = can(staff, 'PRICING_APPROVE');
  // Douala local time (UTC+1), in the format a datetime-local input expects.
  const now = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
  const effectiveHint = 'Your local time. The rule applies from this moment once approved.';

  return (
    <>
      <PageHead
        title="Fees and pricing"
        sub="AMICO’s own fee per route. Operator fees are kept separately. A new rule takes effect only after a second person approves it, and never changes transactions already accepted."
      />

      <section className="card">
        <h2>Fee simulator</h2>
        <Simulator
          services={services.filter((s) => rules.some((r) => r.service.code === s.code && ['ACTIVE', 'PENDING_APPROVAL'].includes(r.status))).map((s) => ({ code: s.code, name: s.name }))}
          rules={rules.filter((r) => ['ACTIVE', 'PENDING_APPROVAL'].includes(r.status)).map((r) => ({ id: r.id, serviceCode: r.service.code, label: `v${r.version} (${r.status === 'ACTIVE' ? 'active' : 'pending approval'})` }))}
        />
      </section>

      <section className="card">
        <h2>Rules</h2>
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="t">
            <thead>
              <tr><th>Service</th><th>Version</th><th>AMICO fee</th><th>Limits</th><th>Method</th><th>Effective</th><th>Status</th><th style={{ width: 260 }}></th></tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.service.name}<div className="sub mono">{r.service.code}</div></td>
                  <td>v{r.version}</td>
                  <td>{feeText(r)}{r.conversionRatePpm !== 1_000_000 && <div className="sub">Airtime rate {(r.conversionRatePpm / 10_000).toFixed(2)}%</div>}</td>
                  <td className="sub">{fcfa(r.minAmount)} to {fcfa(r.maxAmount)}</td>
                  <td className="sub">{METHOD[r.deductionMethod]}</td>
                  <td className="sub">{when(r.effectiveFrom)}{r.effectiveTo ? ` to ${when(r.effectiveTo)}` : ''}</td>
                  <td><Badge value={r.status} />{r.rejectedReason && <div className="sub">{r.rejectedReason}</div>}<div className="sub">{r.changeReason}</div></td>
                  <td>
                    {r.status === 'PENDING_APPROVAL' && approve && r.createdById !== staff.id && (
                      <>
                        <ActionForm path={`admin/pricing-rules/${r.id}/approve`} submit="Approve" confirm={`Approve v${r.version} for ${r.service.name}?`} compact />
                        <ActionForm path={`admin/pricing-rules/${r.id}/reject`} fields={[{ name: 'reason', label: 'Reason', kind: 'text', required: true }]} submit="Reject" variant="danger" compact />
                      </>
                    )}
                    {r.status === 'PENDING_APPROVAL' && r.createdById === staff.id && <span className="sub">Waiting for a colleague to approve.</span>}
                    {r.status === 'ACTIVE' && approve && (
                      <details>
                        <summary style={{ cursor: 'pointer' }}>Retire</summary>
                        <ActionForm path={`admin/pricing-rules/${r.id}/retire`} fields={[{ name: 'reason', label: 'Reason', kind: 'text', required: true }]} submit="Retire rule" variant="danger" />
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
        <h2>Propose a new rule</h2>
        <ActionForm
          path="admin/pricing-rules"
          fields={[
            { name: 'serviceCode', label: 'Service', kind: 'select', options: services.map((s) => ({ value: s.code, label: s.name })) },
            { name: 'feeType', label: 'Fee type', kind: 'select', options: [
              { value: 'PERCENTAGE_PLUS_FIXED', label: 'Percentage plus fixed' },
              { value: 'PERCENTAGE', label: 'Percentage' },
              { value: 'FIXED', label: 'Fixed' },
            ] },
            { name: 'percentageBps', label: 'Percentage, in basis points', kind: 'int', defaultValue: 100, hint: '100 = 1%, 250 = 2.5%' },
            { name: 'fixedFee', label: 'Fixed fee (FCFA)', kind: 'fcfa', defaultValue: 50 },
            { name: 'minFee', label: 'Minimum fee (FCFA)', kind: 'fcfa', defaultValue: 100 },
            { name: 'maxFee', label: 'Maximum fee (FCFA)', kind: 'fcfa', hint: 'Leave empty for no cap' },
            { name: 'minAmount', label: 'Minimum transaction (FCFA)', kind: 'fcfa', defaultValue: 500, required: true },
            { name: 'maxAmount', label: 'Maximum transaction (FCFA)', kind: 'fcfa', defaultValue: 500000, required: true },
            { name: 'deductionMethod', label: 'How fees are charged', kind: 'select', options: Object.entries(METHOD).map(([value, label]) => ({ value, label })), defaultValue: 'DEDUCT_FROM_DESTINATION' },
            { name: 'conversionRatePpm', label: 'Airtime conversion rate, parts per million', kind: 'int', defaultValue: 1000000, hint: '1 000 000 = 100% (money routes). For airtime, use the verified rate, e.g. 850 000 = 85%.' },
            { name: 'effectiveFrom', label: 'Takes effect', kind: 'date', defaultValue: now, required: true, hint: effectiveHint },
            { name: 'changeReason', label: 'Reason', kind: 'textarea', required: true },
          ]}
          fixed={{}}
          submit="Submit for approval"
          columns
          done="Submitted. A colleague with approval rights must approve it."
        />
      </section>
    </>
  );
}
