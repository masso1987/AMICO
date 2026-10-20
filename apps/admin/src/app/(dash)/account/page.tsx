import { KV, PageHead } from '@/components/ui';
import { ChangePassword, MyPreferences, SignOutEverywhere } from '@/components/StaffControls';
import { getT } from '@/i18n/server';
import { when } from '@/lib/format';
import { apiFetch } from '@/lib/session';
import { load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.account') };
}

interface Me {
  id: string; email: string; fullName: string; roles: string[]; locale: 'en' | 'fr'; phone: string | null; alertChannels: string[];
  twoFactorEnabled: boolean; twoFactorSince: string | null; lastLoginAt: string | null; createdAt: string;
}

export default async function Account() {
  const { t, locale } = await getT();
  const [me, roles] = await Promise.all([load<Me>('/auth/staff/me'), apiFetch<Array<{ key: string; name: string }>>('/admin/access/roles').catch(() => [])]);
  return (
    <>
      <PageHead title={t('nav.account')} sub={t('account.sub')} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <section className="card">
            <h2>{me.fullName}</h2>
            <KV
              rows={[
                [t('account.email'), me.email],
                [t('staff.roles'), me.roles.map((r) => roles.find((x) => x.key === r)?.name ?? r).join(', ')],
                [t('account.twoStep'), me.twoFactorEnabled ? t('account.twoStepOn', { at: when(me.twoFactorSince, locale) }) : t('account.twoStepOff')],
                [t('account.lastSignIn'), when(me.lastLoginAt, locale)],
              ]}
            />
            <div style={{ marginTop: 14 }}>
              <SignOutEverywhere />
            </div>
          </section>
          <section className="card">
            <h2>{t('account.preferences')}</h2>
            <MyPreferences locale={me.locale} phone={me.phone} alertChannels={me.alertChannels} />
          </section>
        </div>
        <section className="card">
          <h2>{t('password.title')}</h2>
          <ChangePassword />
        </section>
      </div>
    </>
  );
}
