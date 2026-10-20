import type { Metadata } from 'next';
import '@fontsource/cinzel/600.css';
import '@fontsource-variable/dm-sans';
import './globals.css';
import { I18nProvider } from '@/i18n/client';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: { default: t('meta.title'), template: `%s · ${t('meta.title')}` }, robots: { index: false, follow: false } };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getT();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
