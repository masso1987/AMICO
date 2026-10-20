import Link from 'next/link';
import { pretty, STATE_TONE } from '@/lib/format';

export function Badge({ value, label }: { value: string; label?: string }) {
  return <span className={`badge tone-${STATE_TONE[value] ?? 'neutral'}`}>{label ?? pretty(value)}</span>;
}

export { SimTag } from './SimTag';

export function PageHead({ title, sub, back, children }: { title: string; sub?: React.ReactNode; back?: { href: string; label: string }; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {back && (
          <Link className="back" href={back.href}>
            {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="head-actions">{children}</div>}
    </header>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function KV({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
