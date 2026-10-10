import type { Metadata, Viewport } from 'next';
import '@fontsource/cinzel/600.css';
import '@fontsource-variable/manrope';
import './globals.css';
import { apiUrl } from '@/lib/session';

export const metadata: Metadata = {
  title: { default: 'AMICO — MTN and Orange exchange', template: '%s · AMICO' },
  description: 'Move money and airtime between MTN and Orange in Cameroon.',
};

export const viewport: Viewport = { themeColor: '#0e1424', width: 'device-width', initialScale: 1 };

async function simulationMode(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/health'), { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    const body = await res.json();
    return body.simulationMode !== false;
  } catch {
    return true; // if we can't tell, say so: never imply money is real
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sim = await simulationMode();
  return (
    <html lang="en">
      <body>
        {sim && (
          <div className="sim-banner" role="status">
            Simulation mode — no real money or airtime moves on this site.
          </div>
        )}
        {children}
        <footer className="footer">
          <div className="wrap">AMICO Cameroon, Alpha Multi-Integrated Corporation</div>
        </footer>
      </body>
    </html>
  );
}
