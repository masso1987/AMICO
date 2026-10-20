import { Monitoring, type MonitoringView } from '@/components/Monitoring';
import { PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.monitoring') };
}

export default async function Page() {
  const { t } = await getT();
  const view = await load<MonitoringView>('/admin/monitoring');
  return (
    <>
      <PageHead title={t('nav.monitoring')} sub={t('mon.sub')} />
      <Monitoring initial={view} />
    </>
  );
}
