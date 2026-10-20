import { MaintenanceBoard, type Window } from '@/components/MaintenanceBoard';
import { PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.maintenance') };
}

export default async function Page() {
  const { t } = await getT();
  const staff = await getStaff();
  const data = await load<{ windows: Window[] }>('/admin/maintenance');
  return (
    <>
      <PageHead title={t('nav.maintenance')} sub={t('maint.sub')} />
      <MaintenanceBoard windows={data.windows} canManage={can(staff, 'MAINTENANCE_MANAGE')} />
    </>
  );
}
