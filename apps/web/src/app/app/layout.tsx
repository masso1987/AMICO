import { AppHeader } from '@/components/AppHeader';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <main>
        <div className="wrap">{children}</div>
      </main>
    </>
  );
}
