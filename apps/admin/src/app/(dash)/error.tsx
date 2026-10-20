'use client';

import { useI18n } from '@/i18n/client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card">
      <h2>{t('error.title')}</h2>
      <p className="muted">{t('error.body')}</p>
      <button className="btn btn-quiet" onClick={reset}>{t('error.retry')}</button>
    </div>
  );
}
