'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

type Mode = 'login' | 'register';

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const body = {
      phone: String(form.get('phone') ?? ''),
      password: String(form.get('password') ?? ''),
      fullName: String(form.get('fullName') ?? ''),
    };
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data.details) ? data.details.map((d: { message: string }) => d.message).join('. ') : null;
        setError(
          data.code === 'INVALID_CREDENTIALS'
            ? 'That number and password don’t match. Check both and try again.'
            : data.code === 'PHONE_TAKEN'
              ? 'An account already exists for this number. Sign in instead.'
              : res.status === 429
                ? 'Too many attempts. Wait a minute, then try again.'
                : (detail ?? data.message ?? 'Something went wrong. Try again.'),
        );
        return;
      }
      const next = params.get('next');
      router.replace(next && next.startsWith('/app') ? next : '/app');
      router.refresh();
    } catch {
      setError('Can’t reach AMICO right now. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel auth-card" onSubmit={onSubmit} noValidate>
      <h1 className="page-title">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
      <p className="lede" style={{ marginBottom: 22 }}>
        {mode === 'login' ? 'Use the phone number you registered with.' : 'Your phone number is your AMICO login.'}
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {mode === 'register' && (
        <div className="field">
          <label htmlFor="fullName">Full name</label>
          <input className="input" id="fullName" name="fullName" autoComplete="name" required minLength={2} />
        </div>
      )}

      <div className="field">
        <label htmlFor="phone">Phone number</label>
        <div className="input-prefix">
          <span>+237</span>
          <input
            className="input"
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="6XX XX XX XX"
            required
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'register' ? 10 : 1}
        />
        {mode === 'register' && <span className="hint">At least 10 characters.</span>}
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>

      <p className="muted" style={{ marginTop: 18, marginBottom: 0, fontSize: 15 }}>
        {mode === 'login' ? (
          <>
            New to AMICO? <Link href="/register">Create an account</Link>
          </>
        ) : (
          <>
            Already registered? <Link href="/login">Sign in</Link>
          </>
        )}
      </p>
    </form>
  );
}
