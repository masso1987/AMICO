'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { callApi, errorText } from '@/lib/client';

export type Field =
  | { name: string; label: string; kind: 'text' | 'textarea'; required?: boolean; minLength?: number; hint?: string; placeholder?: string; defaultValue?: string }
  | { name: string; label: string; kind: 'fcfa' | 'int'; required?: boolean; hint?: string; defaultValue?: number | string; min?: number; max?: number }
  | { name: string; label: string; kind: 'select'; options: Array<{ value: string; label: string }>; hint?: string; defaultValue?: string }
  | { name: string; label: string; kind: 'checkbox'; hint?: string; defaultValue?: boolean }
  | { name: string; label: string; kind: 'date'; hint?: string; defaultValue?: string; required?: boolean };

/**
 * Small form that posts to the API bridge and refreshes the page.
 * `fixed` values are merged into the body; empty optional fields are left out.
 */
export function ActionForm({
  path,
  method = 'POST',
  fields = [],
  fixed = {},
  submit,
  variant = 'primary',
  confirm,
  done,
  onResult,
  compact,
  columns,
}: {
  path: string;
  method?: 'POST' | 'PATCH';
  fields?: Field[];
  fixed?: Record<string, unknown>;
  submit: string;
  variant?: 'primary' | 'quiet' | 'danger';
  confirm?: string;
  done?: string;
  onResult?: (r: unknown) => void;
  compact?: boolean;
  columns?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (confirm && !window.confirm(confirm)) return;
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...fixed };
    for (const f of fields) {
      if (f.kind === 'checkbox') {
        body[f.name] = form.get(f.name) === 'on';
        continue;
      }
      const raw = String(form.get(f.name) ?? '').trim();
      if (raw === '') continue;
      if (f.kind === 'fcfa' || f.kind === 'int') {
        const n = Number(raw.replace(/\s/g, ''));
        if (!Number.isInteger(n)) {
          setError(`${f.label}: enter a whole number`);
          return;
        }
        body[f.name] = n;
      } else if (f.kind === 'date') {
        // datetime-local has no zone: read it in the browser's zone and send an exact instant.
        body[f.name] = new Date(raw).toISOString();
      } else body[f.name] = raw;
    }
    setBusy(true);
    try {
      const r = await callApi<unknown>(path, { method, body: JSON.stringify(body) });
      onResult?.(r);
      if (done) setOk(done);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={`aform${compact ? ' compact' : ''}${columns ? ' cols' : ''}`} noValidate>
      {fields.map((f) => {
        const fid = `${id}-${f.name}`;
        if (f.kind === 'checkbox') {
          return (
            <label key={f.name} className="check" htmlFor={fid}>
              <input id={fid} name={f.name} type="checkbox" defaultChecked={f.defaultValue} /> {f.label}
            </label>
          );
        }
        return (
          <div className={`field${f.kind === 'textarea' ? ' wide' : ''}`} key={f.name}>
            <label htmlFor={fid}>{f.label}</label>
            {f.kind === 'textarea' ? (
              <textarea id={fid} name={f.name} rows={3} required={f.required} minLength={f.minLength} placeholder={f.placeholder} defaultValue={f.defaultValue} />
            ) : f.kind === 'select' ? (
              <select id={fid} name={f.name} defaultValue={f.defaultValue}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={fid}
                name={f.name}
                type={f.kind === 'date' ? 'datetime-local' : 'text'}
                inputMode={f.kind === 'fcfa' || f.kind === 'int' ? 'numeric' : undefined}
                required={'required' in f ? f.required : undefined}
                placeholder={'placeholder' in f ? f.placeholder : undefined}
                defaultValue={f.defaultValue as string | undefined}
              />
            )}
            {f.hint && <span className="hint">{f.hint}</span>}
          </div>
        );
      })}
      {error && (
        <p className="msg err" role="alert">
          {error}
        </p>
      )}
      {ok && (
        <p className="msg ok" role="status">
          {ok}
        </p>
      )}
      <button className={`btn btn-${variant}`} type="submit" disabled={busy}>
        {busy ? 'Working…' : submit}
      </button>
    </form>
  );
}
