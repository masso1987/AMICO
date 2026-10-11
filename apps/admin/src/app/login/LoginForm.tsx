'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? 'Too many attempts. Wait a minute.' : data.code === 'INVALID_CREDENTIALS' ? 'Email or password is wrong.' : (data.message ?? 'Sign-in failed.'));
        return;
      }
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      router.refresh();
    } catch {
      setError('Can’t reach the AMICO API.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card aform" onSubmit={onSubmit}>
      <div className="brand">
        <img src="/favicon-64.png" alt="" width={34} height={34} />
        AMICO staff
      </div>
      {error && (
        <p className="msg err" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="hint" style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
        Sessions end after 15 minutes. Every action you take is recorded in the audit log.
      </p>
    </form>
  );
}
