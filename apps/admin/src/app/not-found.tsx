import Link from 'next/link';
import { getT } from '@/i18n/server';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main style={{ padding: 40 }}>
      <h1>{t('notFound.title')}</h1>
      <p className="muted">{t('notFound.body')}</p>
      <Link href="/">{t('notFound.cta')}</Link>
    </main>
  );
}
