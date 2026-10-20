'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n/core';
import { LangToggle } from '@/components/LangToggle';

type Step = { kind: 'password' } | { kind: 'totp' } | { kind: 'enroll'; qrSvg: string; secret: string } | { kind: 'new-password' };

const TITLES: Record<Step['kind'], MessageKey> = {
  password: 'login.title',
  totp: 'login.totpTitle',
  enroll: 'login.enrollTitle',
  'new-password': 'login.newPasswordTitle',
};

function message(t: (k: MessageKey) => string, status: number, data: { code?: string; message?: string; details?: unknown }): string {
  if (status === 429) return t('err.RATE_LIMITED');
  if (data.code === 'INVALID_CREDENTIALS') return t('login.badCredentials');
  if (data.code === 'INVALID_CODE') return t('login.badCode');
  if (data.code === 'CHALLENGE_EXPIRED') return t('login.expired');
  if (data.code === 'VALIDATION_FAILED' && Array.isArray(data.details)) {
    return (data.details as Array<{ message: string }>).map((d) => d.message).join('. ');
  }
  return data.message ?? t('login.failed');
}

export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [step.kind]);

  async function send(body: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'CHALLENGE_EXPIRED') setStep({ kind: 'password' });
        setError(message(t, res.status, data));
        return;
      }
      switch (data.next) {
        case 'DONE': {
          const next = params.get('next');
          router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
          router.refresh();
          return;
        }
        case 'TOTP':
          setStep({ kind: 'totp' });
          break;
        case 'TOTP_ENROLL':
          setStep({ kind: 'enroll', qrSvg: data.qrSvg, secret: data.secret });
          break;
        case 'PASSWORD':
          setStep({ kind: 'new-password' });
          break;
      }
      formRef.current?.reset();
    } catch {
      setError(t('err.NETWORK'));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (step.kind === 'password') return send({ step: 'password', email: f.get('email'), password: f.get('password') });
    if (step.kind === 'totp' || step.kind === 'enroll') return send({ step: 'totp', code: f.get('code') });
    const pw = String(f.get('newPassword') ?? '');
    if (pw !== String(f.get('confirm') ?? '')) {
      setError(t('password.mismatch'));
      return;
    }
    return send({ step: 'new-password', newPassword: pw });
  }

  const codeField = (
    <div className="field">
      <label htmlFor="code">{t('login.code')}</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="otp" placeholder="123 456" />
    </div>
  );

  return (
    <form ref={formRef} className="card aform" onSubmit={onSubmit} key={step.kind}>
      <div className="brand">
        <img src="/favicon-64.png" alt="" width={34} height={34} />
        <span style={{ flex: 1 }}>AMICO</span>
        <LangToggle />
      </div>
      <h1 className="login-title">{t(TITLES[step.kind])}</h1>
      {error && (
        <p className="msg err" role="alert">
          {error}
        </p>
      )}

      {step.kind === 'password' && (
        <>
          <div className="field">
            <label htmlFor="email">{t('staff.email')}</label>
            <input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="password">{t('login.password')}</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
        </>
      )}

      {step.kind === 'totp' && (
        <>
          <p className="lead">{t('login.totpLead')}</p>
          {codeField}
        </>
      )}

      {step.kind === 'enroll' && (
        <>
          <ol className="steps">
            <li>{t('login.enroll1')}</li>
            <li>{t('login.enroll2')}</li>
          </ol>
          <div className="qr" role="img" aria-label={t('login.qr')} dangerouslySetInnerHTML={{ __html: step.qrSvg }} />
          <details className="manual">
            <summary>{t('login.cantScan')}</summary>
            <code className="mono">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            <span>{t('login.timeBased')}</span>
          </details>
          <ol className="steps" start={3}>
            <li>{t('login.enroll3')}</li>
          </ol>
          {codeField}
        </>
      )}

      {step.kind === 'new-password' && (
        <>
          <p className="lead">{t('login.replaceTemp')}</p>
          <div className="field">
            <label htmlFor="newPassword">{t('password.new')}</label>
            <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
          </div>
          <div className="field">
            <label htmlFor="confirm">{t('password.repeat')}</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
          </div>
        </>
      )}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? t('common.working') : step.kind === 'password' ? t('login.continue') : step.kind === 'new-password' ? t('login.saveSignIn') : t('login.verify')}
      </button>
      {step.kind !== 'password' ? (
        <button type="button" className="linkish" onClick={() => { setError(null); setStep({ kind: 'password' }); }}>
          {t('login.startAgain')}
        </button>
      ) : (
        <p className="hint" style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
          {t('login.footer')}
        </p>
      )}
    </form>
  );
}
