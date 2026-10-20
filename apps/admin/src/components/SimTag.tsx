'use client';

import { useI18n } from '@/i18n/client';

export function SimTag({ on }: { on: boolean }) {
  const { t } = useI18n();
  return on ? <span className="sim-tag">{t('common.simulated')}</span> : null;
}
