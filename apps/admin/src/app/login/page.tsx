import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function Login() {
  return (
    <main className="login">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
