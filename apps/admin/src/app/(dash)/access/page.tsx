import { RoleCard, type Permission, type Role } from '@/components/Access';
import { PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.access') };
}

export default async function Page() {
  const { t } = await getT();
  const [permissions, roles] = await Promise.all([load<Permission[]>('/admin/access/permissions'), load<Role[]>('/admin/access/roles')]);
  return (
    <>
      <PageHead title={t('nav.access')} sub={t('access.sub')} />
      <p className="note info">{t('access.help')}</p>
      <div className="stack">
        {roles.map((r) => (
          <RoleCard key={r.key} role={r} permissions={permissions} />
        ))}
        <RoleCard permissions={permissions} />
      </div>
    </>
  );
}
