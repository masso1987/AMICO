import type { Metadata } from 'next';
import Link from 'next/link';
import { Offers } from '@/components/Offers';
import { ServiceCards } from '@/components/ServiceCards';
import { TxnRow, type TxnSummary } from '@/components/TxnRow';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/core';
import { groupOf } from '@/lib/catalogue';
import { getOffers, getServices, getStatus } from '@/lib/data';
import { fcfa, STATE_TONE, stepOf, TERMINAL } from '@/lib/format';
import { authed, getMe } from '@/lib/me';
import { availability } from '@/lib/products';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('nav.home') };
}

export default async function Home() {
  const { t } = await getT();
  const [me, services, status, offers, recent] = await Promise.all([
    getMe('/app'),
    getServices(),
    getStatus(),
    getOffers(),
    authed<{ items: TxnSummary[] }>('/transactions?page=1&pageSize=5', '/app'),
  ]);
  const first = me.fullName.split(' ')[0];
  const groups = availability(services, status.pausedServiceCodes, groupOf);
  const active = recent.items.find((x) => !TERMINAL.includes(x.state));

  return (
    <div className="stack">
      <div>
        <span className="eyebrow">{t('home.eyebrow')}</span>
        <h1 className="page-title" style={{ marginTop: 6 }}>
          {t('home.hello', { name: first ?? '' })}
        </h1>
        <p className="lede" style={{ marginBottom: 0 }}>
          {t('home.lede')}
        </p>
      </div>

      {active && (
        <Link href={`/app/transactions/${active.id}`} className="tracker" aria-label={t('home.inProgress')}>
          <div className="row">
            <strong>{t('home.inProgress')}</strong>
            <span className={`pill tone-${STATE_TONE[active.state] ?? 'wait'}`}>{t(`stateShort.${active.state}` as MessageKey)}</span>
          </div>
          <div className="steps-bar" aria-hidden>
            <span className={stepOf(active.state) >= 1 ? 'on' : ''} />
            <span className={stepOf(active.state) >= 2 ? 'on' : ''} />
            <span className={stepOf(active.state) >= 3 ? 'on' : ''} />
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
            {active.reference} · {fcfa(active.customerPays)}
          </p>
        </Link>
      )}

      <div className="grid-2">
        <section className="panel" aria-labelledby="todo">
          <h2 id="todo" className="sr-only">
            {t('home.whatToDo')}
          </h2>
          <ServiceCards groups={groups} variant="list" />
        </section>
        <section aria-labelledby="recent-title">
          <div className="section-head" style={{ marginBottom: 6 }}>
            <h2 id="recent-title" style={{ fontSize: 18 }}>
              {t('home.recent')}
            </h2>
            {recent.items.length > 0 && <Link href="/app/history">{t('home.seeAll')}</Link>}
          </div>
          {recent.items.length ? (
            <ul className="list">
              {recent.items.map((x) => (
                <li key={x.id}>
                  <TxnRow txn={x} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">{t('home.noneYet')}</div>
          )}
        </section>
      </div>

      {offers.length > 0 && (
        <section aria-labelledby="offers-title">
          <h2 id="offers-title" className="section-title" style={{ marginBottom: 14 }}>
            {t('offers.title')}
          </h2>
          <Offers offers={offers} />
        </section>
      )}
    </div>
  );
}
