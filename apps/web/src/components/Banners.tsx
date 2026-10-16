import { getT } from '@/i18n/server';
import { pick } from '@/i18n/core';
import { dateTime } from '@/lib/format';
import type { Status } from '@/lib/products';

/** Simulation notice, live maintenance and upcoming maintenance, in the visitor's language. */
export async function Banners({ status, simulation }: { status: Status; simulation: boolean }) {
  const { t, locale } = await getT();
  const live = status.global ? [status.global] : status.paused;
  const span = (w: { startsAt: string; endsAt: string | null }) =>
    w.endsAt ? t('banner.window', { from: dateTime(w.startsAt, locale), to: dateTime(w.endsAt, locale) }) : t('banner.from', { from: dateTime(w.startsAt, locale) });
  return (
    <>
      {simulation && (
        <div className="banner banner-sim" role="status">
          {t('banner.simulation')}
        </div>
      )}
      {live.map((w) => (
        <div key={w.id} className="banner banner-maint" role="alert">
          <strong>{w.global ? t('banner.maintenance') : t('banner.paused')}</strong>
          <span>{pick(locale, w.messageEn, w.messageFr)}</span>
          {w.endsAt && <span>· {t('banner.until', { to: dateTime(w.endsAt, locale) })}</span>}
        </div>
      ))}
      {status.upcoming.slice(0, 1).map((w) => (
        <div key={w.id} className="banner banner-upcoming" role="status">
          <strong>{t('banner.upcoming')}</strong>
          <span>{pick(locale, w.messageEn, w.messageFr)}</span>
          <span>({span(w)})</span>
        </div>
      ))}
    </>
  );
}
