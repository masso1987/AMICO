'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { LangToggle } from './LangToggle';

export interface NavItem {
  href: string;
  label: string;
  group: string;
  count?: number;
  alert?: boolean;
}

export function Rail({ items, name, roles }: { items: NavItem[]; name: string; roles: string[] }) {
  const { t } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const groups = [...new Set(items.map((i) => i.group))];

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside className={`rail${open ? ' open' : ''}`}>
      <div className="rail-top">
        <Link href="/" className="brand">
          <img src="/favicon-64.png" alt="" width={30} height={30} />
          <span>
            AMICO
            <small>{t('nav.dashboard')}</small>
          </span>
        </Link>
        <button type="button" className="rail-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? t('nav.close') : t('nav.menu')}
        </button>
      </div>
      <nav aria-label={t('nav.dashboard')} onClick={() => setOpen(false)}>
        {groups.map((g) => (
          <div key={g} style={{ display: 'contents' }}>
            <div className="group">{g}</div>
            {items
              .filter((i) => i.group === g)
              .map((i) => {
                const active = i.href === '/' ? path === '/' : path === i.href || path.startsWith(`${i.href}/`);
                return (
                  <Link key={i.href} href={i.href} aria-current={active ? 'page' : undefined}>
                    {i.label}
                    {i.count ? <span className={`count${i.alert ? ' hot' : ''}`}>{i.count}</span> : null}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>
      <div className="me">
        <strong>{name}</strong>
        <span>{roles.join(', ')}</span>
        <div className="me-actions">
          <LangToggle />
          <button type="button" onClick={signOut}>
            {t('nav.signOut')}
          </button>
        </div>
      </div>
    </aside>
  );
}
