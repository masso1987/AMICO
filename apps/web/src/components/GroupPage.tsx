import Link from 'next/link';
import { getT } from '@/i18n/server';
import { groupOf } from '@/lib/catalogue';
import { getSellRates, getServices, getStatus } from '@/lib/data';
import { getMe } from '@/lib/me';
import { GROUP_PATH, GROUP_TITLE, type Group } from '@/lib/products';
import type { MessageKey } from '@/i18n/core';
import { ExchangeForm } from './ExchangeForm';

/** Shared page for the amount-based products. */
export async function GroupPage({ group, code }: { group: Exclude<Group, 'BUNDLES'>; code?: string }) {
  const { t } = await getT();
  const back = GROUP_PATH[group];
  const [me, services, status, rates] = await Promise.all([getMe(back), getServices(), getStatus(), group === 'SELL_CREDIT' ? getSellRates() : Promise.resolve([])]);
  const mine = services.filter((s) => groupOf(s) === group);
  return (
    <>
      <Link href="/app" className="back">
        ← {t('common.back')}
      </Link>
      <h1 className="page-title">{t(GROUP_TITLE[group])}</h1>
      <p className="lede">{t(`page.${group}.lede` as MessageKey)}</p>
      {mine.length ? (
        <ExchangeForm group={group} services={mine} pausedCodes={status.pausedServiceCodes} myPhone={me.phone} initialCode={code} rates={rates} />
      ) : (
        <div className="empty">{t('page.closed')}</div>
      )}
    </>
  );
}
