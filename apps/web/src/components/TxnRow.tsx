'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/client';
import { pick, type MessageKey } from '@/i18n/core';
import { dateTime, fcfa, operatorOf, phone, STATE_TONE } from '@/lib/format';

export interface TxnSummary {
  id: string;
  reference: string;
  service: { code: string; sourceAsset: string; destinationAsset: string };
  group: string;
  bundle: { name: string; nameFr: string } | null;
  state: string;
  customerPays: number;
  expectedDelivered: number;
  recipient: string;
  cancelRequested: boolean;
  simulated: boolean;
  createdAt: string;
}

export function TxnRow({ txn }: { txn: TxnSummary }) {
  const { t, locale } = useI18n();
  const op = operatorOf(txn.service.destinationAsset);
  const tone = STATE_TONE[txn.state] ?? 'wait';
  return (
    <Link href={`/app/transactions/${txn.id}`} className="row-link">
      <span className={`avatar ${op}`} aria-hidden>
        {op === 'MTN' ? 'MTN' : 'OR'}
      </span>
      <span className="grow">
        <strong>{txn.bundle ? pick(locale, txn.bundle.name, txn.bundle.nameFr) : t(`group.${txn.group}` as MessageKey)}</strong>
        <span className="sub">
          {phone(txn.recipient)} · {dateTime(txn.createdAt, locale)}
          {txn.simulated && <span className="sim-tag">{t('common.simulationShort')}</span>}
        </span>
      </span>
      <span className="end" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <strong className="money">{fcfa(txn.customerPays)}</strong>
        <span className={`pill tone-${tone}`} style={{ marginTop: 4 }}>
          {t(`stateShort.${txn.state}` as MessageKey)}
        </span>
      </span>
    </Link>
  );
}
