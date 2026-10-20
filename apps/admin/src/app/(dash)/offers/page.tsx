import { OfferEditor, OfferRow, type AdminOffer, type BundleOption } from '@/components/Offers';
import { PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { can, getStaff, load } from '@/lib/staff';
import { apiFetch } from '@/lib/session';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.offers') };
}

export default async function Page() {
  const { t } = await getT();
  const staff = await getStaff();
  const manage = can(staff, 'OFFER_MANAGE');
  const [offers, bundles] = await Promise.all([
    load<AdminOffer[]>('/admin/offers'),
    apiFetch<BundleOption[]>('/admin/bundles?include=active').catch(() => [] as BundleOption[]),
  ]);
  return (
    <>
      <PageHead title={t('nav.offers')} sub={t('offers.sub')} />
      <div className="grid-2">
        <section className="card" aria-labelledby="offer-list">
          <h2 id="offer-list">{t('offers.list', { n: offers.length })}</h2>
          {offers.length ? (
            <ul className="offer-list">
              {offers.map((o) => (
                <OfferRow key={o.id} offer={o} bundles={bundles} manage={manage} />
              ))}
            </ul>
          ) : (
            <p className="muted">{t('offers.none')}</p>
          )}
        </section>
        {manage && (
          <section className="card" aria-labelledby="offer-new">
            <h2 id="offer-new">{t('offers.new')}</h2>
            <OfferEditor bundles={bundles} />
          </section>
        )}
      </div>
    </>
  );
}
