import Link from 'next/link';
import { getT } from '@/i18n/server';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main>
      <div className="wrap">
        <h1 className="page-title">{t('notFound.title')}</h1>
        <p className="lede">{t('notFound.body')}</p>
        <Link className="btn btn-primary" href="/app">
          {t('notFound.cta')}
        </Link>
      </div>
    </main>
  );
}
