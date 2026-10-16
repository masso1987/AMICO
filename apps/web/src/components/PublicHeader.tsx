import Link from 'next/link';
import { getT } from '@/i18n/server';
import { getToken } from '@/lib/session';
import { Brand } from './Brand';
import { LangToggle } from './LangToggle';

export async function PublicHeader() {
  const { t } = await getT();
  const signedIn = Boolean(await getToken());
  return (
    <header className="topbar">
      <div className="wrap">
        <Brand label={t('nav.home')} />
        <nav className="topnav" aria-label={t('nav.main')}>
          <Link href="/bundles" className="hide-sm">
            {t('nav.bundles')}
          </Link>
          <Link href="/#sell" className="hide-sm">
            {t('nav.sell')}
          </Link>
          {signedIn ? (
            <Link href="/app">{t('nav.myAccount')}</Link>
          ) : (
            <>
              <Link href="/login">{t('nav.signIn')}</Link>
              <Link href="/register" className="btn btn-primary btn-sm hide-xs" style={{ marginLeft: 6 }}>
                {t('nav.register')}
              </Link>
            </>
          )}
        </nav>
        <LangToggle />
      </div>
    </header>
  );
}
