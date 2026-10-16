import type { Metadata } from 'next';
import { GroupPage } from '@/components/GroupPage';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('group.BUY_AIRTIME') };
}

export default async function Page(props: PageProps<'/app/airtime'>) {
  const sp = await props.searchParams;
  return <GroupPage group="BUY_AIRTIME" code={typeof sp.code === 'string' ? sp.code : undefined} />;
}
