import type { Metadata } from 'next';
import { SettingsForm } from '@/components/SettingsForm';
import { getT } from '@/i18n/server';
import { getMe } from '@/lib/me';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('nav.settings') };
}

export default async function Settings() {
  const { t } = await getT();
  const me = await getMe('/app/settings');
  return (
    <>
      <h1 className="page-title">{t('settings.title')}</h1>
      <p className="lede">{t('settings.lede')}</p>
      <SettingsForm me={me} />
    </>
  );
}
