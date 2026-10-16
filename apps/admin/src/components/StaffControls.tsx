'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { callApi, errorText } from '@/lib/client';
import { ROLE_INFO } from '@/lib/roles';


/** Shown once after creating an account or resetting a password. */
export function OneTimePassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-once" role="status">
      <strong>Temporary password for {email}</strong>
      <code className="mono">{password}</code>
      <span className="sub">
        Give it to them in person or by phone, not by email. It is shown only once. At first sign-in they set up an authenticator app and choose their own password.
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => navigator.clipboard?.writeText(password).then(() => setCopied(true)).catch(() => undefined)}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function RoleChecks({ defaults = [] }: { defaults?: string[] }) {
  const id = useId();
  return (
    <fieldset className="roles">
      <legend>Roles</legend>
      {ROLE_INFO.map((r) => (
        <label key={r.role} className="check" htmlFor={`${id}-${r.role}`}>
          <input id={`${id}-${r.role}`} type="checkbox" name="roles" value={r.role} defaultChecked={defaults.includes(r.role)} />
          <span>
            <strong>{r.label}</strong>
            <span className="sub" style={{ display: 'block' }}>{r.does}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    setBusy(true);
    try {
      const r = await fn();
      router.refresh();
      return r;
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function CreateStaff() {
  const { busy, error, run } = useAction();
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const r = await run(() =>
      callApi<{ staff: { email: string }; temporaryPassword: string }>('admin/staff', {
        method: 'POST',
        body: JSON.stringify({ email: f.get('email'), fullName: f.get('fullName'), roles: f.getAll('roles') }),
      }),
    );
    if (r) {
      setCreated({ email: r.staff.email, password: r.temporaryPassword });
      form.reset();
    }
  }

  if (created) return <OneTimePassword {...created} onClose={() => setCreated(null)} />;
  return (
    <form className="aform" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="new-name">Full name</label>
        <input id="new-name" name="fullName" type="text" required minLength={2} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="new-email">Work email</label>
        <input id="new-email" name="email" type="email" required autoComplete="off" />
      </div>
      <RoleChecks />
      {error && <p className="msg err" role="alert">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}

export interface StaffRow {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  active: boolean;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
}

export function ManageStaff({ s }: { s: StaffRow }) {
  const { busy, error, run } = useAction();
  const [temp, setTemp] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOk(null);
    const f = new FormData(e.currentTarget);
    const r = await run(() =>
      callApi(`admin/staff/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fullName: f.get('fullName'), roles: f.getAll('roles'), active: f.get('active') === 'on', reason: f.get('reason') }),
      }),
    );
    if (r) setOk('Saved. If you removed a role or switched the account off, their current session has ended.');
  }

  async function reset(kind: 'password' | '2fa') {
    setOk(null);
    const what = kind === 'password' ? 'reset this password' : 'reset two-step sign-in (they will scan a new QR code)';
    const reason = window.prompt(`Why do you want to ${what}?`);
    if (!reason) return;
    const r = await run(() => callApi<{ temporaryPassword?: string }>(`admin/staff/${s.id}/reset-${kind}`, { method: 'POST', body: JSON.stringify({ reason }) }));
    if (r?.temporaryPassword) setTemp(r.temporaryPassword);
    else if (r) setOk('Two-step sign-in reset. They set up a new authenticator at their next sign-in.');
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {temp && <OneTimePassword email={s.email} password={temp} onClose={() => setTemp(null)} />}
      <form className="aform" onSubmit={save}>
        <div className="field">
          <label htmlFor={`${s.id}-name`}>Full name</label>
          <input id={`${s.id}-name`} name="fullName" type="text" defaultValue={s.fullName} required minLength={2} />
        </div>
        <RoleChecks defaults={s.roles} />
        <label className="check" htmlFor={`${s.id}-active`}>
          <input id={`${s.id}-active`} type="checkbox" name="active" defaultChecked={s.active} /> Account active
        </label>
        <div className="field">
          <label htmlFor={`${s.id}-reason`}>Reason for the change</label>
          <input id={`${s.id}-reason`} name="reason" type="text" required minLength={5} placeholder="e.g. Joined the finance team" />
        </div>
        {error && <p className="msg err" role="alert">{error}</p>}
        {ok && <p className="msg ok" role="status">{ok}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Save changes
        </button>
      </form>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => reset('password')}>
          Reset password
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy || !s.twoFactorEnabled} onClick={() => reset('2fa')}>
          Reset two-step sign-in
        </button>
      </div>
    </div>
  );
}

/** My account: change password, sign out everywhere. */
export function ChangePassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get('newPassword') !== f.get('confirm')) return setError('The two new passwords don’t match.');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(Array.isArray(data.details) ? data.details.map((d: { message: string }) => d.message).join('. ') : (data.message ?? 'Could not change the password.'));
        return;
      }
      setOk(true);
      form.reset();
    } catch {
      setError('Can’t reach the AMICO API.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="aform" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="cur">Current password</label>
        <input id="cur" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div className="field">
        <label htmlFor="np">New password</label>
        <input id="np" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
        <span className="hint">At least 12 characters, mixing letters with numbers or symbols.</span>
      </div>
      <div className="field">
        <label htmlFor="np2">Repeat new password</label>
        <input id="np2" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {error && <p className="msg err" role="alert">{error}</p>}
      {ok && <p className="msg ok" role="status">Password changed. Your other sessions have been signed out.</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

export function SignOutEverywhere() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-quiet"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm('Sign out on every device, including this one?')) return;
        setBusy(true);
        await fetch('/api/auth/revoke', { method: 'POST' }).catch(() => undefined);
        router.replace('/login');
        router.refresh();
      }}
    >
      Sign out everywhere
    </button>
  );
}
