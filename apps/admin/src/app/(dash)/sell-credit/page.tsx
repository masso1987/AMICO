import { SellCredit, type SellRoute } from '@/components/SellCredit';
import { PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.sellCredit') };
}

export default async function Page() {
  const { t } = await getT();
  const staff = await getStaff();
  const routes = await load<SellRoute[]>('/admin/pricing/sell-credit');
  return (
    <>
      <PageHead title={t('nav.sellCredit')} sub={t('sell.sub')} />
      <SellCredit routes={routes} meId={staff.id} canApprove={can(staff, 'PRICING_APPROVE')} />
    </>
  );
}
