'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n/core';
import type { Bundle } from '@/lib/products';
import { BundleCard } from './BundleCard';

const CATEGORIES = ['ALL', 'DATA', 'VOICE', 'SMS', 'COMBO'] as const;

export function PublicBundles({ bundles }: { bundles: Bundle[] }) {
  const { t } = useI18n();
  const [operator, setOperator] = useState<'ALL' | 'MTN' | 'ORANGE'>('ALL');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('ALL');
  const list = bundles.filter((b) => (operator === 'ALL' || b.operator === operator) && (category === 'ALL' || b.category === category));
  return (
    <>
      <div className="filters">
        <div className="segmented" role="group" aria-label={t('bundles.network')} style={{ minWidth: 260 }}>
          {(['ALL', 'MTN', 'ORANGE'] as const).map((o) => (
            <button key={o} type="button" aria-pressed={operator === o} onClick={() => setOperator(o)}>
              {o === 'ALL' ? t('common.all') : <span className={`op op-${o}`}>{t(`op.${o}` as MessageKey)}</span>}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label={t('bundles.category')}>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {t(`category.${c}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      {list.length ? (
        <div className="bundles">
          {list.map((b) => (
            <BundleCard key={b.id} bundle={b} href={`/app/bundles?bundle=${b.id}`} />
          ))}
        </div>
      ) : (
        <div className="empty">{bundles.length ? t('bundles.noMatch') : t('bundles.none')}</div>
      )}
    </>
  );
}
