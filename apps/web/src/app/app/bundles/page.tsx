import type { Metadata } from 'next';
import Link from 'next/link';
import { BundleShop } from '@/components/BundleShop';
import { getT } from '@/i18n/server';
import { getBundles, getStatus } from '@/lib/data';
import { getMe } from '@/lib/me';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('group.BUNDLES') };
}

export default async function Page(props: PageProps<'/app/bundles'>) {
  const { t } = await getT();
  const sp = await props.searchParams;
  const bundleId = typeof sp.bundle === 'string' ? sp.bundle : undefined;
  const [me, catalogue, status] = await Promise.all([getMe(bundleId ? `/app/bundles?bundle=${bundleId}` : '/app/bundles'), getBundles(), getStatus()]);
  return (
    <>
      <Link href="/app" className="back">
        ← {t('common.back')}
      </Link>
      <h1 className="page-title">{t('group.BUNDLES')}</h1>
      <p className="lede">{t('page.BUNDLES.lede')}</p>
      <BundleShop catalogue={catalogue} pausedCodes={status.pausedServiceCodes} myPhone={me.phone} initialBundleId={bundleId} />
    </>
  );
}
