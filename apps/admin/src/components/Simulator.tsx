'use client';

import { useState } from 'react';
import { callApi, errorText } from '@/lib/client';
import { fcfa } from '@/lib/format';

interface SimResult {
  ok: boolean; code?: string; message?: string; ruleStatus?: string; ruleVersion?: number;
  customerPays?: number; platformRevenue?: number; providerCost?: number; destinationAmount?: number;
  breakdown?: { calculationMethod: string; assumptions: string[]; isEstimate: boolean };
}

/** Runs the real quote engine on the server with an active or pending rule. */
export function Simulator({ services, rules }: { services: Array<{ code: string; name: string }>; rules: Array<{ id: string; label: string; serviceCode: string }> }) {
  const [res, setRes] = useState<SimResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [svc, setSvc] = useState(services[0]?.code ?? '');

  async function run(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { serviceCode: svc, amount: Number(String(f.get('amount')).replace(/\s/g, '')) };
    const pf = String(f.get('providerFeeAmount') ?? '').trim();
    if (pf) body.providerFeeAmount = Number(pf);
    if (f.get('providerDeducts') === 'on') body.providerDeductsAtSettlement = true;
    const rule = String(f.get('ruleId') ?? '');
    if (rule) body.ruleId = rule;
    setBusy(true);
    setErr(null);
    try {
      setRes(await callApi<SimResult>('admin/pricing/simulate', { method: 'POST', body: JSON.stringify(body) }));
    } catch (x) {
      setErr(errorText(x));
      setRes(null);
    } finally {
      setBusy(false);
    }
  }

  if (services.length === 0) return <p style={{ margin: 0, color: 'var(--muted)' }}>No service has a pricing rule yet. Propose one below, then simulate it here.</p>;

  return (
    <div className="grid-2">
      <form className="aform" onSubmit={run}>
        <div className="field">
          <label htmlFor="sim-svc">Service</label>
          <select id="sim-svc" value={svc} onChange={(e) => setSvc(e.target.value)}>
            {services.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sim-rule">Pricing rule</label>
          <select id="sim-rule" name="ruleId" defaultValue="">
            <option value="">Rule currently in force</option>
            {rules.filter((r) => r.serviceCode === svc).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sim-amt">Source amount (FCFA)</label>
          <input id="sim-amt" name="amount" type="text" inputMode="numeric" defaultValue="10000" required />
        </div>
        <div className="field">
          <label htmlFor="sim-pf">Operator charge to try (FCFA)</label>
          <input id="sim-pf" name="providerFeeAmount" type="text" inputMode="numeric" placeholder="Leave empty to use the configured operator fee" />
        </div>
        <label className="check"><input type="checkbox" name="providerDeducts" /> Operator deducts its fee at settlement</label>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Calculating…' : 'Calculate'}</button>
      </form>
      <div>
        {err && <p className="msg err">{err}</p>}
        {res && !res.ok && <p className="msg err">{res.code}: {res.message}</p>}
        {res?.ok && (
          <div className="card" style={{ background: '#fafbfc' }}>
            <div className="sub" style={{ color: 'var(--muted)', fontSize: 13 }}>Rule v{res.ruleVersion} ({res.ruleStatus?.toLowerCase().replace('_', ' ')})</div>
            <dl className="kv">
              <div><dt>Customer pays</dt><dd>{fcfa(res.customerPays)}</dd></div>
              <div><dt>AMICO revenue</dt><dd>{fcfa(res.platformRevenue)}</dd></div>
              <div><dt>Operator fee</dt><dd>{fcfa(res.providerCost)}{res.breakdown?.isEstimate ? ' (estimate)' : ''}</dd></div>
              <div><dt>Recipient receives</dt><dd className="big-amount" style={{ fontSize: 22 }}>{fcfa(res.destinationAmount)}</dd></div>
            </dl>
            <p className="sub" style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 0 }}>{res.breakdown?.calculationMethod}</p>
            {res.breakdown?.assumptions.map((a) => <p key={a} className="sub" style={{ color: 'var(--muted)', fontSize: 12.5, margin: '4px 0 0' }}>{a}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}
