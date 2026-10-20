import { Dashboard, type DashboardView } from '@/components/Dashboard';
import { PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { getStaff, load } from '@/lib/staff';

export default async function Home(props: PageProps<'/'>) {
  const { t } = await getT();
  const denied = (await props.searchParams).denied === '1';
  const staff = await getStaff();
  const view = await load<DashboardView>('/admin/dashboard');
  return (
    <>
      <PageHead title={t('dash.hello', { name: staff.fullName.split(' ')[0] ?? '' })} sub={t('dash.sub')} />
      {denied && <p className="note" role="alert">{t('dash.denied')}</p>}
      <Dashboard initial={view} />
    </>
  );
}
