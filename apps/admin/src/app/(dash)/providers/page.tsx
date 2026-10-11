import type { Metadata } from 'next';
import { ActionForm } from '@/components/ActionForm';
import { Badge, PageHead } from '@/components/ui';
import { when } from '@/lib/format';
import { can, getStaff, load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Providers' };

interface Provider {
  id: string; code: string; name: string; simulated: boolean; active: boolean;
  capabilities: Array<{ id: string; operator: string; capability: string; enabled: boolean; verifiedAt: string | null; notes: string; adapterLoaded: boolean }>;
}

export default async function Providers() {
  const [list, staff] = await Promise.all([load<Provider[]>('/admin/providers'), getStaff()]);
  const write = can(staff, 'PROVIDER_CAPABILITY_WRITE');
  return (
    <>
      <PageHead
        title="Providers"
        sub="What each provider integration can do. A capability counts only when it is enabled and verified. Credentials are kept in the server’s secret store and never shown here."
      />
      {list.map((p) => (
        <section key={p.id} className="card">
          <h2>{p.name} <span className="mono" style={{ color: 'var(--muted)' }}>{p.code}</span> {p.simulated && <span className="sim-tag">Simulated</span>}</h2>
          <table className="t">
            <thead><tr><th>Operator</th><th>Capability</th><th>Status</th><th>Adapter</th><th>Notes</th><th style={{ width: 300 }}></th></tr></thead>
            <tbody>
              {p.capabilities.map((c) => (
                <tr key={c.id}>
                  <td>{c.operator}</td>
                  <td>{c.capability.toLowerCase().replace('_', ' ')}</td>
                  <td>
                    {c.enabled && c.verifiedAt ? <Badge value="ACTIVE" label="Verified" /> : <Badge value="DISABLED" label={c.enabled ? 'Enabled, not verified' : 'Off'} />}
                    {c.verifiedAt && <div className="sub">{when(c.verifiedAt)}</div>}
                  </td>
                  <td className="sub">{c.adapterLoaded ? 'Loaded' : 'Not loaded'}</td>
                  <td className="sub">{c.notes}</td>
                  <td>
                    {write && (c.enabled && c.verifiedAt ? (
                      <ActionForm path={`admin/providers/capabilities/${c.id}/disable`} fields={[{ name: 'notes', label: 'Why', kind: 'text', required: true }]} submit="Turn off" variant="danger" compact />
                    ) : (
                      <ActionForm path={`admin/providers/capabilities/${c.id}/verify`} fields={[{ name: 'notes', label: 'What was tested', kind: 'text', required: true }]} submit="Mark verified" compact />
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
