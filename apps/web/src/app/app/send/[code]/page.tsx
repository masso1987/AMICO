import { notFound, redirect } from 'next/navigation';
import { findRoute } from '@amico/contracts';
import { groupOf } from '@/lib/catalogue';
import { GROUP_PATH, isGroup } from '@/lib/products';

/** Old links (/app/send/<service code>) go to the product page with the route preselected. */
export default async function Page(props: PageProps<'/app/send/[code]'>) {
  const { code } = await props.params;
  const route = findRoute(code);
  if (!route) notFound();
  const group = groupOf({ sourceAsset: route.source, destinationAsset: route.destination });
  if (!isGroup(group)) notFound();
  redirect(group === 'BUNDLES' ? GROUP_PATH.BUNDLES : `${GROUP_PATH[group]}?code=${encodeURIComponent(code)}`);
}
