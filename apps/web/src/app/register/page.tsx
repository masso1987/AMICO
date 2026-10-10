import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Brand } from '@/components/Brand';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = { title: 'Create account' };

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
            <AuthForm mode="register" />
          </Suspense>
        </div>
      </main>
    </>
  );
}
