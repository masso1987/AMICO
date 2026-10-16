'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/client';
import { pick } from '@/i18n/core';
import { offerHref, type Offer } from '@/lib/products';

/** "Available credit": the offers staff publish in the admin, newest campaigns first. */
export function Offers({ offers }: { offers: Offer[] }) {
  const { t, locale } = useI18n();
  if (!offers.length) return null;
  return (
    <div className="offers" role="list">
      {offers.map((o) => {
        const href = offerHref(o);
        const badge = pick(locale, o.badgeEn, o.badgeFr);
        const body = (
          <>
            <div className={`art${o.image ? '' : ' empty'}`} style={o.image ? { backgroundImage: `url(/api/proxy${o.image})` } : undefined}>
              {badge && <span className="badge">{badge}</span>}
            </div>
            <div className="body">
              {o.operator && <span className={`op-tag ${o.operator}`}>{o.operator === 'MTN' ? 'MTN' : 'Orange'}</span>}
              <strong>{pick(locale, o.titleEn, o.titleFr)}</strong>
              <span>{pick(locale, o.bodyEn, o.bodyFr)}</span>
              {href && <span className="cta">{t('offers.cta')} →</span>}
            </div>
          </>
        );
        if (!href) {
          return (
            <div key={o.id} className="offer" role="listitem">
              {body}
            </div>
          );
        }
        const external = href.startsWith('https://');
        return external ? (
          <a key={o.id} className="offer" role="listitem" href={href} target="_blank" rel="noopener noreferrer">
            {body}
          </a>
        ) : (
          <Link key={o.id} className="offer" role="listitem" href={href}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
