import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Brand } from '@/components/Brand';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page() {
  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <Brand />
        </div>
      </header>
      <main>
        <div className="wrap">
          <Suspense>
            <AuthForm mode="login" />
          </Suspense>
        </div>
      </main>
    </>
  );
}
