'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n/client';
import { GROUP_BLURB, GROUP_PATH, GROUP_TITLE, type Group } from '@/lib/products';
import { GROUP_ICON, Icon } from './Icon';

export interface GroupAvailability {
  group: Group;
  /** Some route of the group is open and not paused. */
  open: boolean;
  /** Every open route of the group is paused by maintenance. */
  paused: boolean;
}

/** The five products, as cards (landing) or as a list (signed-in home). */
export function ServiceCards({ groups, variant = 'cards' }: { groups: GroupAvailability[]; variant?: 'cards' | 'list' }) {
  const { t } = useI18n();
  const visible = groups.filter((g) => g.open || g.paused);
  if (!visible.length) return <div className="empty">{t('home.noServices')}</div>;

  if (variant === 'list') {
    return (
      <ul className="actions">
        {visible.map((g) => (
          <li key={g.group}>
            <Link href={GROUP_PATH[g.group]} className={`action${g.paused ? ' paused' : ''}`}>
              <span className="icon">
                <Icon name={GROUP_ICON[g.group]!} />
              </span>
              <span className="text">
                <strong>{t(GROUP_TITLE[g.group])}</strong>
                <span>{g.paused ? t('home.pausedNow') : t(GROUP_BLURB[g.group])}</span>
              </span>
              <span className="chev">
                <Icon name="chevron" size={18} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="service-cards">
      {visible.map((g) => (
        <Link key={g.group} href={g.group === 'BUNDLES' ? '/bundles' : GROUP_PATH[g.group]} className="service-card">
          <span className="icon">
            <Icon name={GROUP_ICON[g.group]!} />
          </span>
          <strong>{t(GROUP_TITLE[g.group])}</strong>
          <span>{t(GROUP_BLURB[g.group])}</span>
          {g.paused && <span className="paused-note">{t('home.pausedNow')}</span>}
        </Link>
      ))}
    </div>
  );
}
