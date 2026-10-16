import type { Metadata, Viewport } from 'next';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource-variable/dm-sans';
import './globals.css';
import { Banners } from '@/components/Banners';
import { Footer } from '@/components/Footer';
import { I18nProvider } from '@/i18n/client';
import { getT } from '@/i18n/server';
import { getStatus, simulationMode } from '@/lib/data';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { default: t('meta.title'), template: '%s · AMICO' },
    description: t('meta.description'),
  };
}

export const viewport: Viewport = { themeColor: '#0e1116', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getT();
  const [status, sim] = await Promise.all([getStatus(), simulationMode()]);
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
          <Banners status={status} simulation={sim} />
          {children}
          <Footer />
        </I18nProvider>
      </body>
    </html>
  );
}
