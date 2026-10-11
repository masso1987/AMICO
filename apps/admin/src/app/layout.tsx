import type { Metadata } from 'next';
import '@fontsource/cinzel/600.css';
import '@fontsource-variable/manrope';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AMICO staff', template: '%s · AMICO staff' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
