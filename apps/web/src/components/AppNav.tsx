'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const LINKS = [
  { href: '/app', label: 'Exchange' },
  { href: '/app/history', label: 'History' },
  { href: '/app/notifications', label: 'Messages' },
];

export function AppNav() {
  const path = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
    router.refresh();
  }

  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => {
        const active = l.href === '/app' ? path === '/app' || path.startsWith('/app/send') : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}>
            {l.label}
          </Link>
        );
      })}
      <button type="button" onClick={signOut}>
        Sign out
      </button>
    </nav>
  );
}
