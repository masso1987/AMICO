'use client';

import { useI18n } from '@/i18n/client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <main>
      <div className="wrap">
        <h1 className="page-title">{t('error.title')}</h1>
        <p className="lede">{t('error.body')}</p>
        <button className="btn btn-primary" onClick={reset}>
          {t('error.retry')}
        </button>
      </div>
    </main>
  );
}
