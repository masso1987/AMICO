'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n/core';
import { Brand } from './Brand';
import { Icon } from './Icon';
import { LangToggle } from './LangToggle';

const LINKS: { href: string; label: MessageKey; icon: string }[] = [
  { href: '/app', label: 'nav.home', icon: 'home' },
  { href: '/app/history', label: 'nav.history', icon: 'history' },
  { href: '/app/notifications', label: 'nav.messages', icon: 'bell' },
  { href: '/app/settings', label: 'nav.settings', icon: 'settings' },
];

function isActive(path: string, href: string) {
  if (href === '/app') return path === '/app' || ['/app/airtime', '/app/bundles', '/app/sell', '/app/swap', '/app/exchange', '/app/send'].some((p) => path.startsWith(p));
  if (href === '/app/history') return path.startsWith('/app/history') || path.startsWith('/app/transactions');
  return path.startsWith(href);
}

export function AppHeader() {
  const { t } = useI18n();
  const path = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
    router.refresh();
  }

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <Brand href="/app" label={t('nav.home')} />
          <nav className="topnav app-links" aria-label={t('nav.main')}>
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={isActive(path, l.href) ? 'page' : undefined}>
                {t(l.label)}
              </Link>
            ))}
            <button type="button" onClick={signOut}>
              {t('nav.signOut')}
            </button>
          </nav>
          <div style={{ marginLeft: 'auto' }} className="show-sm">
            <button type="button" className="icon-btn" onClick={signOut} aria-label={t('nav.signOut')}>
              <Icon name="logout" size={20} />
            </button>
          </div>
          <LangToggle />
        </div>
      </header>
      <nav className="tabbar" aria-label={t('nav.main')}>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={isActive(path, l.href) ? 'page' : undefined}>
            <Icon name={l.icon} size={22} />
            {t(l.label)}
          </Link>
        ))}
      </nav>
    </>
  );
}
