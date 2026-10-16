'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Step = { kind: 'password' } | { kind: 'totp' } | { kind: 'enroll'; qrSvg: string; secret: string } | { kind: 'new-password' };

const TITLES: Record<Step['kind'], string> = {
  password: 'Sign in',
  totp: 'Two-step sign-in',
  enroll: 'Set up two-step sign-in',
  'new-password': 'Choose your password',
};

function message(status: number, data: { code?: string; message?: string; details?: unknown }): string {
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (data.code === 'INVALID_CREDENTIALS') return 'Email or password is wrong.';
  if (data.code === 'VALIDATION_FAILED' && Array.isArray(data.details)) {
    return (data.details as Array<{ message: string }>).map((d) => d.message).join('. ');
  }
  return data.message ?? 'Sign-in failed.';
}

export function LoginForm() {
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
        setError(message(res.status, data));
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
      setError('Can’t reach the AMICO API.');
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
      setError('The two passwords don’t match.');
      return;
    }
    return send({ step: 'new-password', newPassword: pw });
  }

  const codeField = (
    <div className="field">
      <label htmlFor="code">6-digit code</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="otp" placeholder="123 456" />
    </div>
  );

  return (
    <form ref={formRef} className="card aform" onSubmit={onSubmit} key={step.kind}>
      <div className="brand">
        <img src="/favicon-64.png" alt="" width={34} height={34} />
        AMICO staff
      </div>
      <h1 className="login-title">{TITLES[step.kind]}</h1>
      {error && (
        <p className="msg err" role="alert">
          {error}
        </p>
      )}

      {step.kind === 'password' && (
        <>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
        </>
      )}

      {step.kind === 'totp' && (
        <>
          <p className="lead">Open your authenticator app and enter the current code for AMICO.</p>
          {codeField}
        </>
      )}

      {step.kind === 'enroll' && (
        <>
          <ol className="steps">
            <li>
              Install an authenticator app on your phone: Google Authenticator, Microsoft Authenticator or similar.
            </li>
            <li>In the app, add an account and scan this code.</li>
          </ol>
          <div className="qr" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: step.qrSvg }} />
          <details className="manual">
            <summary>Can’t scan? Enter this key instead</summary>
            <code className="mono">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            <span>Time-based, 6 digits.</span>
          </details>
          <ol className="steps" start={3}>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          {codeField}
        </>
      )}

      {step.kind === 'new-password' && (
        <>
          <p className="lead">Replace your temporary password. Use at least 12 characters, mixing letters with numbers or symbols.</p>
          <div className="field">
            <label htmlFor="newPassword">New password</label>
            <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
          </div>
          <div className="field">
            <label htmlFor="confirm">Repeat new password</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
          </div>
        </>
      )}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Checking…' : step.kind === 'password' ? 'Continue' : step.kind === 'new-password' ? 'Save and sign in' : 'Verify'}
      </button>
      {step.kind !== 'password' ? (
        <button type="button" className="linkish" onClick={() => { setError(null); setStep({ kind: 'password' }); }}>
          Start again
        </button>
      ) : (
        <p className="hint" style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
          Staff sign-in needs your password and a code from your phone. Sessions end after 15 minutes, and every action is recorded in the audit log.
        </p>
      )}
    </form>
  );
}
