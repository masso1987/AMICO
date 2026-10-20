'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { callApi, errorText } from '@/lib/client';

export interface RoleOption { key: string; name: string; description: string; system: boolean }

function toMsisdn(v: string) {
  const d = v.replace(/\D/g, '');
  return d.length === 9 ? `237${d}` : d;
}
const local = (msisdn: string | null) => (msisdn ? msisdn.replace(/^237/, '') : '');

/** Shown once after creating an account or resetting a password. */
export function OneTimePassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-once" role="status">
      <strong>{t('staff.tempFor', { email })}</strong>
      <code className="mono">{password}</code>
      <span className="sub">{t('staff.tempHelp')}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-quiet" onClick={() => navigator.clipboard?.writeText(password).then(() => setCopied(true)).catch(() => undefined)}>
          {copied ? t('common.copied') : t('common.copy')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {t('common.done')}
        </button>
      </div>
    </div>
  );
}

function RoleChecks({ roles, defaults = [] }: { roles: RoleOption[]; defaults?: string[] }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <fieldset className="roles">
      <legend>{t('staff.roles')}</legend>
      {roles.map((r) => (
        <label key={r.key} className="check" htmlFor={`${id}-${r.key}`}>
          <input id={`${id}-${r.key}`} type="checkbox" name="roles" value={r.key} defaultChecked={defaults.includes(r.key)} />
          <span>
            <strong>{r.name}</strong>
            {r.description && <span className="sub" style={{ display: 'block' }}>{r.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function AlertFields({ idp, phone, channels }: { idp: string; phone?: string | null; channels?: string[] }) {
  const { t } = useI18n();
  return (
    <fieldset className="roles">
      <legend>{t('staff.alerts')}</legend>
      <div className="field">
        <label htmlFor={`${idp}-phone`}>{t('staff.phone')}</label>
        <input id={`${idp}-phone`} name="phone" type="tel" inputMode="numeric" placeholder="6XX XX XX XX" defaultValue={local(phone ?? null)} />
      </div>
      <label className="check"><input type="checkbox" name="alertChannels" value="SMS" defaultChecked={channels?.includes('SMS')} /> {t('staff.alertSms')}</label>
      <label className="check"><input type="checkbox" name="alertChannels" value="WHATSAPP" defaultChecked={channels?.includes('WHATSAPP')} /> {t('staff.alertWhatsapp')}</label>
      <span className="hint">{t('staff.alertsHint')}</span>
    </fieldset>
  );
}

function useAction() {
  const { t } = useI18n();
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
      setError(errorText(e, t));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function CreateStaff({ roles }: { roles: RoleOption[] }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const phone = String(f.get('phone') ?? '').trim();
    const r = await run(() =>
      callApi<{ staff: { email: string }; temporaryPassword: string }>('admin/staff', {
        method: 'POST',
        body: JSON.stringify({ email: f.get('email'), fullName: f.get('fullName'), roles: f.getAll('roles'), phone: phone ? toMsisdn(phone) : null, alertChannels: f.getAll('alertChannels') }),
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
        <label htmlFor="new-name">{t('staff.fullName')}</label>
        <input id="new-name" name="fullName" type="text" required minLength={2} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="new-email">{t('staff.email')}</label>
        <input id="new-email" name="email" type="email" required autoComplete="off" />
      </div>
      <RoleChecks roles={roles} />
      <AlertFields idp="new" />
      {error && <p className="msg err" role="alert">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? t('common.working') : t('staff.create')}
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
  phone: string | null;
  alertChannels: string[];
}

export function ManageStaff({ s, roles }: { s: StaffRow; roles: RoleOption[] }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [temp, setTemp] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOk(null);
    const f = new FormData(e.currentTarget);
    const phone = String(f.get('phone') ?? '').trim();
    const r = await run(() =>
      callApi(`admin/staff/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: f.get('fullName'), roles: f.getAll('roles'), active: f.get('active') === 'on',
          phone: phone ? toMsisdn(phone) : null, alertChannels: f.getAll('alertChannels'), reason: f.get('reason'),
        }),
      }),
    );
    if (r) setOk(t('staff.saved'));
  }

  async function reset(kind: 'password' | '2fa') {
    setOk(null);
    const reason = window.prompt(kind === 'password' ? t('staff.whyResetPassword') : t('staff.whyReset2fa'));
    if (!reason) return;
    const r = await run(() => callApi<{ temporaryPassword?: string }>(`admin/staff/${s.id}/reset-${kind}`, { method: 'POST', body: JSON.stringify({ reason }) }));
    if (r?.temporaryPassword) setTemp(r.temporaryPassword);
    else if (r) setOk(t('staff.reset2faDone'));
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {temp && <OneTimePassword email={s.email} password={temp} onClose={() => setTemp(null)} />}
      <form className="aform" onSubmit={save}>
        <div className="field">
          <label htmlFor={`${s.id}-name`}>{t('staff.fullName')}</label>
          <input id={`${s.id}-name`} name="fullName" type="text" defaultValue={s.fullName} required minLength={2} />
        </div>
        <RoleChecks roles={roles} defaults={s.roles} />
        <AlertFields idp={s.id} phone={s.phone} channels={s.alertChannels} />
        <label className="check" htmlFor={`${s.id}-active`}>
          <input id={`${s.id}-active`} type="checkbox" name="active" defaultChecked={s.active} /> {t('staff.active')}
        </label>
        <div className="field">
          <label htmlFor={`${s.id}-reason`}>{t('common.reason')}</label>
          <input id={`${s.id}-reason`} name="reason" type="text" required minLength={5} placeholder={t('staff.reasonExample')} />
        </div>
        {error && <p className="msg err" role="alert">{error}</p>}
        {ok && <p className="msg ok" role="status">{ok}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {t('common.save')}
        </button>
      </form>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => reset('password')}>
          {t('staff.resetPassword')}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy || !s.twoFactorEnabled} onClick={() => reset('2fa')}>
          {t('staff.reset2fa')}
        </button>
      </div>
    </div>
  );
}

/** My account: language, phone and alert channels. */
export function MyPreferences({ locale, phone, alertChannels }: { locale: 'en' | 'fr'; phone: string | null; alertChannels: string[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [lang, setLang] = useState(locale);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const f = new FormData(e.currentTarget);
    const p = String(f.get('phone') ?? '').trim();
    setBusy(true);
    try {
      await callApi('auth/staff/me', { method: 'PATCH', body: JSON.stringify({ locale: lang, phone: p ? toMsisdn(p) : null, alertChannels: f.getAll('alertChannels') }) });
      await fetch('/api/lang', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: lang }) });
      setMsg({ ok: true, text: lang === 'fr' ? 'Préférences enregistrées.' : 'Preferences saved.' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="aform" onSubmit={save}>
      <div className="field">
        <span className="label">{t('account.language')}</span>
        <div className="seg">
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          <button type="button" aria-pressed={lang === 'fr'} onClick={() => setLang('fr')}>Français</button>
        </div>
      </div>
      <AlertFields idp="me" phone={phone} channels={alertChannels} />
      {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? t('common.working') : t('common.save')}</button>
    </form>
  );
}

export function ChangePassword() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get('newPassword') !== f.get('confirm')) return setError(t('password.mismatch'));
    setBusy(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.code === 'INVALID_CREDENTIALS' ? t('password.wrongCurrent') : data.code === 'PASSWORD_REUSED' ? t('err.PASSWORD_REUSED') : Array.isArray(data.details) ? data.details.map((d: { message: string }) => d.message).join('. ') : (data.message ?? t('err.GENERIC')));
        return;
      }
      setOk(true);
      form.reset();
    } catch {
      setError(t('err.NETWORK'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="aform" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="cur">{t('password.current')}</label>
        <input id="cur" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div className="field">
        <label htmlFor="np">{t('password.new')}</label>
        <input id="np" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
        <span className="hint">{t('password.rule')}</span>
      </div>
      <div className="field">
        <label htmlFor="np2">{t('password.repeat')}</label>
        <input id="np2" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {error && <p className="msg err" role="alert">{error}</p>}
      {ok && <p className="msg ok" role="status">{t('password.changed')}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? t('common.working') : t('password.submit')}
      </button>
    </form>
  );
}

export function SignOutEverywhere() {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-quiet"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(t('account.signOutAllConfirm'))) return;
        setBusy(true);
        await fetch('/api/auth/revoke', { method: 'POST' }).catch(() => undefined);
        router.replace('/login');
        router.refresh();
      }}
    >
      {t('account.signOutAll')}
    </button>
  );
}
