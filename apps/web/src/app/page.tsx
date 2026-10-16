import Link from 'next/link';
import { BundleCard } from '@/components/BundleCard';
import { Offers } from '@/components/Offers';
import { PublicHeader } from '@/components/PublicHeader';
import { ServiceCards } from '@/components/ServiceCards';
import { getT } from '@/i18n/server';
import { groupOf } from '@/lib/catalogue';
import { getBundles, getOffers, getPublicConfig, getSellRates, getServices, getStatus } from '@/lib/data';
import { fcfa } from '@/lib/format';
import { availability, percent, ratePct } from '@/lib/products';

export default async function Landing() {
  const { t, locale } = await getT();
  const [services, status, offers, catalogue, config, rates] = await Promise.all([getServices(), getStatus(), getOffers(), getBundles(), getPublicConfig(), getSellRates()]);
  const groups = availability(services, status.pausedServiceCodes, groupOf);
  const featured = [...catalogue.bundles].sort((a, b) => Number(b.featured) - Number(a.featured) || a.price - b.price).slice(0, 6);
  const best = rates.length ? Math.max(...rates.map((r) => r.ratePercent)) : null;
  const sellMin = rates.length ? Math.min(...rates.map((r) => r.minAmount)) : 1000;
  const sellMax = rates.length ? Math.max(...rates.map((r) => r.maxAmount)) : 500000;

  return (
    <>
      <PublicHeader />
      <main>
        <div className="wrap">
          <section className="hero">
            <div className="glow" aria-hidden />
            <div>
              <span className="eyebrow">{t('landing.eyebrow')}</span>
              <h1>{t('landing.title')}</h1>
              <p>{t('landing.lede')}</p>
              <div className="hero-actions">
                <Link href="/register" className="btn btn-primary">
                  {t('landing.start')}
                </Link>
                <Link href="/bundles" className="btn btn-quiet">
                  {t('landing.seeBundles')}
                </Link>
              </div>
            </div>
            <img src="/sphere-512.png" alt="" className="hero-sphere" width={400} height={400} />
          </section>

          {offers.length > 0 && (
            <section className="section" aria-labelledby="offers-title" style={{ marginTop: 8 }}>
              <div className="section-head">
                <h2 id="offers-title" className="section-title">
                  {t('offers.title')}
                </h2>
              </div>
              <Offers offers={offers} />
            </section>
          )}

          <section className="section" aria-labelledby="services-title">
            <div className="section-head">
              <h2 id="services-title" className="section-title">
                {t('landing.servicesTitle')}
              </h2>
            </div>
            <ServiceCards groups={groups} />
          </section>

          {featured.length > 0 && (
            <section className="section" aria-labelledby="bundles-title">
              <div className="section-head">
                <h2 id="bundles-title" className="section-title">
                  {t('landing.bundlesTitle')}
                </h2>
                <Link href="/bundles">{t('landing.allBundles')} →</Link>
              </div>
              <div className="bundles">
                {featured.map((b) => (
                  <BundleCard key={b.id} bundle={b} href={`/app/bundles?bundle=${b.id}`} />
                ))}
              </div>
            </section>
          )}

          <section className="section panel" id="sell" aria-labelledby="sell-title" style={{ display: 'grid', gap: 18 }}>
            <span className="eyebrow">{t('group.SELL_CREDIT')}</span>
            <h2 id="sell-title" className="section-title">
              {best !== null ? t('landing.sellTitleRate', { rate: ratePct(best, locale) }) : t('landing.sellTitle')}
            </h2>
            <p style={{ color: 'var(--ink-2)', maxWidth: '62ch' }}>{t('landing.sellBody', { min: fcfa(sellMin), max: fcfa(sellMax) })}</p>
            <div>
              <Link href="/app/sell" className="btn btn-primary">
                {t('landing.sellCta')}
              </Link>
            </div>
          </section>

          <section className="section" aria-labelledby="how-title">
            <h2 id="how-title" className="section-title" style={{ marginBottom: 20 }}>
              {t('landing.howTitle')}
            </h2>
            <ol className="how">
              <li>
                <h3>{t('landing.how1')}</h3>
                <p>{t('landing.how1Body')}</p>
              </li>
              <li>
                <h3>{t('landing.how2')}</h3>
                <p>{t('landing.how2Body')}</p>
              </li>
              <li>
                <h3>{t('landing.how3')}</h3>
                <p>{t('landing.how3Body')}</p>
              </li>
            </ol>
          </section>

          <section className="section" id="policy" aria-labelledby="policy-title">
            <h2 id="policy-title" className="section-title" style={{ marginBottom: 20 }}>
              {t('landing.policyTitle')}
            </h2>
            <div className="promises">
              <div className="promise">
                <strong>{config.refundOnFailurePercent}%</strong>
                <span>{t('landing.policyFailure', { pct: config.refundOnFailurePercent })}</span>
              </div>
              <div className="promise">
                <strong>{t('landing.free')}</strong>
                <span>{t('landing.policyBefore')}</span>
              </div>
              {config.cancellation.allowAfterPayment && (
                <div className="promise">
                  <strong>{percent(config.cancellation.feeBps, locale)}%</strong>
                  <span>{t('landing.policyAfter', { pct: percent(config.cancellation.feeBps, locale) })}</span>
                </div>
              )}
              <div className="promise">
                <strong>0</strong>
                <span>{t('landing.policyHidden')}</span>
              </div>
            </div>
          </section>

          <section className="section faq" id="faq" aria-labelledby="faq-title">
            <h2 id="faq-title" className="section-title" style={{ marginBottom: 8 }}>
              {t('landing.faqTitle')}
            </h2>
            {(['1', '2', '3', '4', '5'] as const).map((n) => (
              <details key={n}>
                <summary>{t(`faq.q${n}`)}</summary>
                <p>{t(`faq.a${n}`, { pct: percent(config.cancellation.feeBps, locale), min: fcfa(sellMin), max: fcfa(sellMax) })}</p>
              </details>
            ))}
          </section>
        </div>
      </main>
    </>
  );
}
