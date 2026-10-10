import Link from 'next/link';
import { ASSETS } from '@/lib/format';

export interface ServiceSummary {
  code: string;
  name: string;
  sourceAsset: string;
  destinationAsset: string;
  processingMethod: 'API' | 'MANUAL_SOURCE';
  minAmount: number;
  maxAmount: number;
}

function group(s: ServiceSummary): string {
  const src = ASSETS[s.sourceAsset]?.kind;
  const dst = ASSETS[s.destinationAsset]?.kind;
  if (src === 'money' && dst === 'money') return 'Send money between networks';
  if (src === 'airtime') return 'Turn airtime into money or airtime';
  return 'Buy airtime and data';
}

const ORDER = ['Send money between networks', 'Turn airtime into money or airtime', 'Buy airtime and data'];

export function RouteList({ services, linkBase }: { services: ServiceSummary[]; linkBase: string }) {
  const groups = new Map<string, ServiceSummary[]>();
  for (const s of services) groups.set(group(s), [...(groups.get(group(s)) ?? []), s]);

  return (
    <div>
      {ORDER.filter((g) => groups.has(g)).map((g) => (
        <div className="route-group" key={g}>
          <h2>{g}</h2>
          <ul className="routes">
            {groups.get(g)!.map((s) => {
              const from = ASSETS[s.sourceAsset]!;
              const to = ASSETS[s.destinationAsset]!;
              const href = linkBase.startsWith('/app') ? `${linkBase}/${s.code}` : linkBase;
              return (
                <li key={s.code}>
                  <Link className="route" href={href}>
                    <span className={`op op-${from.operator}`}>{from.label}</span>
                    <span className="arrow" aria-label="to">
                      ⟶
                    </span>
                    <span className={`op op-${to.operator}`}>{to.label}</span>
                    <span className="method">
                      {s.processingMethod === 'MANUAL_SOURCE' ? 'You transfer airtime, we check it' : 'Pay with a phone prompt'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
