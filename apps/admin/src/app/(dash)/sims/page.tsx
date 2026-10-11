import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { RevealNumber } from '@/components/RevealNumber';
import { Badge, KV, PageHead } from '@/components/ui';
import { when } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export const metadata: Metadata = { title: 'SIM accounts' };

interface Sim {
  id: string; code: string; label: string; operator: string; type: string; msisdnMasked: string; processingMethod: string; providerCode: string | null;
  active: boolean; notes: string; lastVerifiedAt: string | null; lastVerifiedStatus: string | null; updatedAt: string;
  receivingServices: Array<{ code: string; status: string }>;
}

export default async function Sims() {
  const [sims, staff] = await Promise.all([load<Sim[]>('/admin/sim-accounts'), getStaff()]);
  return (
    <>
      <PageHead
        title="SIM accounts"
        sub="The four operating lines. Numbers are masked; showing a full number is recorded. No PIN or operator secret is ever stored here."
      />
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
        {sims.map((s) => (
          <section key={s.id} className="card">
            <h2>
              {s.label} <Badge value={s.active ? 'ACTIVE' : 'DISABLED'} label={s.active ? 'Active' : 'Inactive'} />
            </h2>
            <KV
              rows={[
                ['Number', can(staff, 'SIM_READ_FULL') ? <RevealNumber key="n" simId={s.id} masked={s.msisdnMasked} /> : <span className="mono">{s.msisdnMasked}</span>],
                ['Type', `${s.operator} ${s.type.toLowerCase()}`],
                ['Used for', s.type === 'BUSINESS' ? `Provider API (${s.providerCode ?? 'none'})` : 'Receiving customer airtime, checked by staff'],
                ['Services', s.receivingServices.length ? s.receivingServices.map((r) => r.code).join(', ') : '—'],
                ['Last check', s.lastVerifiedAt ? `${when(s.lastVerifiedAt)}: ${s.lastVerifiedStatus}` : '—'],
                ['Notes', s.notes || '—'],
              ]}
            />
            {can(staff, 'SIM_WRITE') && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Edit</summary>
                <div style={{ marginTop: 10 }}>
                  <ActionForm
                    path={`admin/sim-accounts/${s.id}`}
                    method="PATCH"
                    fields={[
                      { name: 'label', label: 'Label', kind: 'text', defaultValue: s.label },
                      { name: 'msisdn', label: 'New phone number', kind: 'text', placeholder: 'Leave empty to keep the current number' },
                      { name: 'active', label: 'Active', kind: 'checkbox', defaultValue: s.active },
                      { name: 'lastVerifiedStatus', label: 'Check result', kind: 'text', placeholder: 'e.g. Balance and SMS log checked, line working' },
                      { name: 'notes', label: 'Operational notes', kind: 'textarea', defaultValue: s.notes },
                      { name: 'reason', label: 'Reason for the change', kind: 'text', required: true },
                    ]}
                    submit="Save"
                    done="Saved."
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
