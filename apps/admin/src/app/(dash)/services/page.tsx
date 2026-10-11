import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { Badge, PageHead } from '@/components/ui';
import { ASSET_LABEL, fcfa } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Services' };

interface Service {
  id: string; code: string; name: string; status: string; sourceAsset: string; destinationAsset: string; processingMethod: string;
  quoteTtlSeconds: number; allowEstimatedProviderFee: boolean; dualApprovalThreshold: number; verificationNotes: string;
  receivingSim: { code: string; msisdnMasked: string; active: boolean } | null;
  readiness: { available: boolean; reasons: string[] };
}

export default async function Services() {
  const [list, staff] = await Promise.all([load<Service[]>('/admin/services'), getStaff()]);
  const write = can(staff, 'CATALOGUE_WRITE');
  return (
    <>
      <PageHead
        title="Services"
        sub="A route can be switched on only when its provider capabilities are verified, it has an approved price, and (for airtime) its receiving SIM is active."
      />
      <div className="stack">
        {list.map((s) => (
          <section key={s.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>
                  {ASSET_LABEL[s.sourceAsset]} → {ASSET_LABEL[s.destinationAsset]} <Badge value={s.status} />
                </h2>
                <div className="sub" style={{ color: 'var(--muted)', fontSize: 13 }}>
                  <span className="mono">{s.code}</span>, {s.processingMethod === 'MANUAL_SOURCE' ? `airtime received on ${s.receivingSim ? `${s.receivingSim.code} (${s.receivingSim.msisdnMasked})` : 'no SIM assigned'}` : 'paid through the provider'}
                </div>
              </div>
              {write && (
                <div>
                  {s.status === 'ENABLED' ? (
                    <ActionForm path={`admin/services/${s.id}/disable`} fields={[{ name: 'reason', label: 'Reason', kind: 'text', required: true }]} submit="Switch off" variant="danger" compact />
                  ) : s.readiness.available ? (
                    <ActionForm path={`admin/services/${s.id}/enable`} fields={[{ name: 'reason', label: 'Reason', kind: 'text', required: true }]} submit="Switch on" compact />
                  ) : null}
                </div>
              )}
            </div>
            {!s.readiness.available && (
              <ul className="note" style={{ margin: '12px 0 0', paddingLeft: 28 }}>
                {s.readiness.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            <p className="sub" style={{ color: 'var(--muted)', fontSize: 13, margin: '10px 0 0' }}>
              Quotes valid {Math.round(s.quoteTtlSeconds / 60)} min. Two approvers from {fcfa(s.dualApprovalThreshold)}. Estimated operator fees {s.allowEstimatedProviderFee ? 'allowed' : 'not allowed'}. {s.verificationNotes}
            </p>
            {write && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Settings</summary>
                <div style={{ marginTop: 10 }}>
                  <ActionForm
                    path={`admin/services/${s.id}`}
                    method="PATCH"
                    fields={[
                      { name: 'quoteTtlSeconds', label: 'Quote validity (seconds)', kind: 'int', defaultValue: s.quoteTtlSeconds },
                      { name: 'dualApprovalThreshold', label: 'Two approvers from (FCFA)', kind: 'fcfa', defaultValue: s.dualApprovalThreshold },
                      { name: 'allowEstimatedProviderFee', label: 'Allow quotes with an estimated operator fee', kind: 'checkbox', defaultValue: s.allowEstimatedProviderFee },
                      { name: 'reason', label: 'Reason for the change', kind: 'text', required: true },
                    ]}
                    submit="Save settings"
                    done="Saved."
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
