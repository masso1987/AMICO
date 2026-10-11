'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  group: string;
  count?: number;
}

export function Rail({ items, name, roles }: { items: NavItem[]; name: string; roles: string[] }) {
  const path = usePathname();
  const router = useRouter();
  const groups = [...new Set(items.map((i) => i.group))];

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside className="rail">
      <Link href="/" className="brand">
        <img src="/favicon-64.png" alt="" width={30} height={30} />
        <span>
          AMICO
          <small>Staff dashboard</small>
        </span>
      </Link>
      <nav aria-label="Dashboard">
        {groups.map((g) => (
          <div key={g} style={{ display: 'contents' }}>
            <div className="group">{g}</div>
            {items
              .filter((i) => i.group === g)
              .map((i) => {
                const active = i.href === '/' ? path === '/' : path.startsWith(i.href);
                return (
                  <Link key={i.href} href={i.href} aria-current={active ? 'page' : undefined}>
                    {i.label}
                    {i.count ? <span className="count">{i.count}</span> : null}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>
      <div className="me">
        <strong>{name}</strong>
        {roles.map((r) => r.toLowerCase()).join(', ')}
        <br />
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
