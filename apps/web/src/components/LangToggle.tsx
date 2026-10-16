'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import type { Locale } from '@/i18n/core';

export function LangToggle() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function choose(next: Locale) {
    if (next === locale || busy) return;
    setBusy(true);
    await fetch('/api/lang', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: next }) }).catch(() => undefined);
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="lang" role="group" aria-label={t('nav.language')}>
      <button type="button" aria-pressed={locale === 'en'} onClick={() => choose('en')} lang="en" title="English">
        EN
      </button>
      <button type="button" aria-pressed={locale === 'fr'} onClick={() => choose('fr')} lang="fr" title="Français">
        FR
      </button>
    </div>
  );
}
