import Link from 'next/link';
import { BundleEditor, BundleRow, SyncButton, type AdminBundle } from '@/components/Bundles';
import { PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.bundles') };
}

export default async function Page(props: PageProps<'/bundles'>) {
  const { t } = await getT();
  const staff = await getStaff();
  const manage = can(staff, 'BUNDLE_MANAGE');
  const sp = await props.searchParams;
  const op = sp.operator === 'MTN' || sp.operator === 'ORANGE' ? sp.operator : undefined;
  const bundles = await load<AdminBundle[]>(`/admin/bundles${op ? `?operator=${op}` : ''}`);
  return (
    <>
      <PageHead title={t('nav.bundles')} sub={t('bundles.sub')}>
        {manage && <SyncButton />}
      </PageHead>
      <div className="filters">
        <Link href="/bundles" aria-current={!op ? 'true' : undefined}>{t('common.all')}</Link>
        <Link href="/bundles?operator=MTN" aria-current={op === 'MTN' ? 'true' : undefined}>MTN</Link>
        <Link href="/bundles?operator=ORANGE" aria-current={op === 'ORANGE' ? 'true' : undefined}>Orange</Link>
      </div>
      {bundles.length ? (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t('bundles.col.bundle')}</th>
                <th>{t('bundles.col.contents')}</th>
                <th>{t('bundles.col.validity')}</th>
                <th className="num">{t('bundles.col.price')}</th>
                <th>{t('bundles.col.status')}</th>
                <th>{t('bundles.col.sold')}</th>
                {manage && <th />}
              </tr>
            </thead>
            <tbody>
              {bundles.map((b) => (
                <BundleRow key={b.id} bundle={b} manage={manage} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">{t('bundles.none')}</div>
      )}
      {manage && (
        <section className="card" style={{ marginTop: 16 }} aria-labelledby="new-bundle">
          <h2 id="new-bundle">{t('bundles.new')}</h2>
          <BundleEditor />
        </section>
      )}
    </>
  );
}
