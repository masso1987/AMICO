import type { Metadata } from 'next';
import { PublicBundles } from '@/components/PublicBundles';
import { PublicHeader } from '@/components/PublicHeader';
import { getT } from '@/i18n/server';
import { getBundles } from '@/lib/data';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('group.BUNDLES') };
}

export default async function BundlesPage() {
  const { t } = await getT();
  const catalogue = await getBundles();
  return (
    <>
      <PublicHeader />
      <main>
        <div className="wrap">
          <h1 className="page-title">{t('bundles.title')}</h1>
          <p className="lede">{t('bundles.lede')}</p>
          <PublicBundles bundles={catalogue.bundles} />
        </div>
      </main>
    </>
  );
}
