import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { Badge, PageHead } from '@/components/ui';
import { fcfa, when } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Operator fees' };

interface Rule {
  id: string; operator: string; capability: string; version: number; status: string; feeType: string; percentageBps: number; fixedFee: number;
  minFee: number; maxFee: number | null; source: string; evidenceReference: string | null; deductedAtSettlement: boolean;
  changeReason: string; createdById: string; createdAt: string; provider: { code: string };
}

export default async function ProviderFees() {
  const [rules, staff] = await Promise.all([load<Rule[]>('/admin/provider-fee-rules'), getStaff()]);
  return (
    <>
      <PageHead
        title="Operator fees"
        sub="What MTN, Orange or an aggregator charge. Kept separate from AMICO’s fee. Mark a fee verified only with a contract or tariff reference; estimates are labelled to customers."
      />
      <section className="card">
        <table className="t">
          <thead>
            <tr><th>Provider</th><th>Operation</th><th>Fee</th><th>Source</th><th>Charged</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.provider.code} v{r.version}<div className="sub">{when(r.createdAt)}</div></td>
                <td>{r.operator} {r.capability.toLowerCase().replace('_', ' ')}</td>
                <td>{r.feeType === 'FIXED' ? fcfa(r.fixedFee) : `${r.percentageBps / 100}%${r.feeType === 'PERCENTAGE_PLUS_FIXED' ? ` + ${fcfa(r.fixedFee)}` : ''}`}</td>
                <td><Badge value={r.source === 'VERIFIED' ? 'ACTIVE' : 'PENDING'} label={r.source === 'VERIFIED' ? 'Verified' : 'Estimate'} />{r.evidenceReference && <div className="sub">{r.evidenceReference}</div>}</td>
                <td className="sub">{r.deductedAtSettlement ? 'Deducted by operator' : 'Collected by AMICO'}</td>
                <td><Badge value={r.status} /><div className="sub">{r.changeReason}</div></td>
                <td>
                  {r.status === 'PENDING_APPROVAL' && can(staff, 'PRICING_APPROVE') && r.createdById !== staff.id && (
                    <ActionForm path={`admin/provider-fee-rules/${r.id}/approve`} submit="Approve" compact />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Record an operator fee</h2>
        <ActionForm
          path="admin/provider-fee-rules"
          fields={[
            { name: 'providerCode', label: 'Provider code', kind: 'text', defaultValue: 'MOCK', required: true },
            { name: 'operator', label: 'Operator', kind: 'select', options: [{ value: 'MTN', label: 'MTN' }, { value: 'ORANGE', label: 'Orange' }] },
            { name: 'capability', label: 'Operation', kind: 'select', options: [
              { value: 'DISBURSE', label: 'Pay out (disburse)' }, { value: 'COLLECT', label: 'Collect' },
              { value: 'AIRTIME_TOPUP', label: 'Airtime top-up' }, { value: 'DATA_BUNDLE', label: 'Data bundle' },
            ] },
            { name: 'feeType', label: 'Fee type', kind: 'select', options: [{ value: 'FIXED', label: 'Fixed' }, { value: 'PERCENTAGE', label: 'Percentage' }, { value: 'PERCENTAGE_PLUS_FIXED', label: 'Percentage plus fixed' }] },
            { name: 'percentageBps', label: 'Percentage, in basis points', kind: 'int', defaultValue: 0, hint: '100 = 1%' },
            { name: 'fixedFee', label: 'Fixed fee (FCFA)', kind: 'fcfa', defaultValue: 0 },
            { name: 'source', label: 'How do you know?', kind: 'select', options: [{ value: 'ESTIMATE', label: 'Estimate (shown to customers as an estimate)' }, { value: 'VERIFIED', label: 'Verified from contract or tariff sheet' }] },
            { name: 'evidenceReference', label: 'Evidence reference', kind: 'text', hint: 'Required when verified, e.g. “MTN contract annex 2, 2026-09”' },
            { name: 'deductedAtSettlement', label: 'The operator deducts this fee itself at settlement', kind: 'checkbox' },
            { name: 'changeReason', label: 'Reason', kind: 'textarea', required: true },
          ]}
          submit="Submit for approval"
          columns
          done="Submitted for approval."
        />
      </section>
    </>
  );
}
