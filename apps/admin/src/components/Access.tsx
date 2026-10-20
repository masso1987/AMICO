'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';
import { pick } from '@/i18n/core';
import { callApi, errorText } from '@/lib/client';

export interface Permission { key: string; group: string; en: string; fr: string }
export interface Role { key: string; name: string; description: string; permissions: string[]; system: boolean; members: number }

/** One role with its permission grid. Without `role` it's the "new role" form. */
export function RoleCard({ role, permissions }: { role?: Role; permissions: Permission[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const groups = [...new Set(permissions.map((p) => p.group))];
  const changed = !role || name !== role.name || description !== role.description || perms.slice().sort().join() !== role.permissions.slice().sort().join();

  function toggle(k: string, on: boolean) {
    setPerms(on ? [...perms, k] : perms.filter((p) => p !== k));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      if (role) {
        const body: Record<string, unknown> = { reason: reason.trim() };
        if (name !== role.name) body.name = name.trim();
        if (description !== role.description) body.description = description.trim();
        if (perms.slice().sort().join() !== role.permissions.slice().sort().join()) body.permissions = perms;
        await callApi(`admin/access/roles/${role.key}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await callApi('admin/access/roles', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim(), permissions: perms, reason: reason.trim() }) });
        setName('');
        setDescription('');
        setPerms([]);
      }
      setReason('');
      setMsg({ ok: true, text: role ? t('access.saved') : t('access.created') });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!role) return;
    const why = window.prompt(t('access.deleteReason'));
    if (!why || why.trim().length < 5) return;
    try {
      await callApi(`admin/access/roles/${role.key}`, { method: 'DELETE', body: JSON.stringify({ reason: why.trim() }) });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    }
  }

  return (
    <section className={`card role${open ? ' open' : ''}`}>
      <button type="button" className="role-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>
          <strong>{role ? role.name : `+ ${t('access.new')}`}</strong>
          {role?.system && <span className="badge" style={{ marginLeft: 8 }}>{t('access.builtIn')}</span>}
          {role && <span className="muted small"> · {t('access.members', { n: role.members })} · {t('access.permCount', { n: role.permissions.length })}</span>}
          {role?.description && <span className="muted small role-desc">{role.description}</span>}
        </span>
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <form className="aform" onSubmit={save} noValidate>
          <div className="cols-2">
            <div className="field">
              <label htmlFor={`${role?.key ?? 'new'}-name`}>{t('access.name')}</label>
              <input id={`${role?.key ?? 'new'}-name`} type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${role?.key ?? 'new'}-desc`}>{t('access.description')}</label>
              <input id={`${role?.key ?? 'new'}-desc`} type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="perm-grid">
            {groups.map((g) => (
              <fieldset key={g} className="roles">
                <legend>{t(`permGroup.${g}` as 'permGroup.Operations')}</legend>
                {permissions.filter((p) => p.group === g).map((p) => (
                  <label key={p.key} className="check">
                    <input type="checkbox" checked={perms.includes(p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />
                    <span>
                      {pick(locale, p.en, p.fr)}
                      <span className="mono muted small"> {p.key}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="field">
            <label htmlFor={`${role?.key ?? 'new'}-reason`}>{t('common.reason')}</label>
            <input id={`${role?.key ?? 'new'}-reason`} type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {msg && <p className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</p>}
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy || !changed}>{busy ? t('common.working') : role ? t('common.save') : t('access.create')}</button>
            {role && !role.system && <button type="button" className="btn btn-danger" onClick={remove}>{t('access.delete')}</button>}
          </div>
          <p className="muted small">{t('access.makerChecker')}</p>
        </form>
      )}
    </section>
  );
}
