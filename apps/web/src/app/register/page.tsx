import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';
import { PublicHeader } from '@/components/PublicHeader';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('auth.register') };
}

export default async function Page(props: PageProps<'/register'>) {
  const sp = await props.searchParams;
  const next = typeof sp.next === 'string' ? sp.next : undefined;
  return (
    <>
      <PublicHeader />
      <main>
        <div className="wrap">
          <AuthForm mode="register" next={next} />
        </div>
      </main>
    </>
  );
}
