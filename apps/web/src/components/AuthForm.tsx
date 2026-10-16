'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { toMsisdn } from '@/lib/format';

type Mode = 'login' | 'register';

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const safeNext = next && next.startsWith('/app') && !next.startsWith('//') ? next : '/app';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const body = {
      phone: toMsisdn(String(form.get('phone') ?? '')),
      password: String(form.get('password') ?? ''),
      fullName: String(form.get('fullName') ?? '').trim(),
    };
    if (body.phone.length !== 12) return setError(t('err.BAD_NUMBER'));
    if (mode === 'register' && body.fullName.length < 2) return setError(t('auth.err.name'));
    if (mode === 'register' && body.password.length < 10) return setError(t('auth.err.password'));
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.code === 'INVALID_CREDENTIALS'
            ? t('auth.err.credentials')
            : data.code === 'PHONE_TAKEN'
              ? t('auth.err.taken')
              : res.status === 429
                ? t('err.RATE_LIMITED')
                : data.code === 'VALIDATION_FAILED'
                  ? t(mode === 'register' ? 'auth.err.register' : 'err.VALIDATION_FAILED')
                  : t('err.GENERIC'),
        );
        return;
      }
      router.replace(safeNext);
      router.refresh();
    } catch {
      setError(t('err.NETWORK'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel auth-card" onSubmit={onSubmit} noValidate>
      <h1 className="page-title">{mode === 'login' ? t('auth.signIn') : t('auth.register')}</h1>
      <p className="lede" style={{ marginBottom: 22 }}>
        {mode === 'login' ? t('auth.signInLede') : t('auth.registerLede')}
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {mode === 'register' && (
        <div className="field">
          <label htmlFor="fullName">{t('auth.fullName')}</label>
          <input className="input" id="fullName" name="fullName" autoComplete="name" required minLength={2} />
        </div>
      )}

      <div className="field">
        <label htmlFor="phone">{t('auth.phone')}</label>
        <div className="input-group">
          <span>+237</span>
          <input className="input" id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="6XX XX XX XX" required />
        </div>
      </div>

      <div className="field">
        <label htmlFor="password">{t('auth.password')}</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'register' ? 10 : 1}
        />
        {mode === 'register' && <span className="hint">{t('auth.passwordHint')}</span>}
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? t('common.wait') : mode === 'login' ? t('auth.signIn') : t('auth.createAccount')}
      </button>

      <p className="muted" style={{ marginTop: 18, fontSize: 15 }}>
        {mode === 'login' ? (
          <>
            {t('auth.newHere')} <Link href={`/register${next ? `?next=${encodeURIComponent(safeNext)}` : ''}`}>{t('auth.createAccount')}</Link>
          </>
        ) : (
          <>
            {t('auth.already')} <Link href={`/login${next ? `?next=${encodeURIComponent(safeNext)}` : ''}`}>{t('auth.signIn')}</Link>
          </>
        )}
      </p>
    </form>
  );
}
