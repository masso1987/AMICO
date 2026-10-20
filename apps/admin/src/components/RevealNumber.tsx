'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { callApi, errorText } from '@/lib/client';
import { phone } from '@/lib/format';

/** Shows a SIM's full number after the staff member gives a reason. Every reveal is audited. */
export function RevealNumber({ simId, masked, defaultReason }: { simId: string; masked: string; defaultReason?: string }) {
  const { t } = useI18n();
  const [num, setNum] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    const reason = defaultReason ?? window.prompt(t('sims.revealWhy')) ?? '';
    if (reason.trim().length < 5) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await callApi<{ msisdn: string }>(`admin/sim-accounts/${simId}/reveal`, { method: 'POST', body: JSON.stringify({ reason }) });
      setNum(r.msisdn);
    } catch (e) {
      setErr(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <span className="mono">{num ? phone(num) : masked}</span>{' '}
      {!num && (
        <button type="button" className="btn btn-quiet" style={{ minHeight: 28, padding: '2px 8px', fontSize: 12.5 }} onClick={reveal} disabled={busy}>
          {t('sims.reveal')}
        </button>
      )}
      {err && <span className="msg err" style={{ display: 'block', marginTop: 4 }}>{err}</span>}
    </span>
  );
}
