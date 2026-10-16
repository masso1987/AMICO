import Link from 'next/link';
import { getT } from '@/i18n/server';

export async function Footer() {
  const { t } = await getT();
  return (
    <footer className="footer">
      <div className="wrap">
        <span>{t('footer.company')}</span>
        <span style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Link href="/#policy">{t('footer.refunds')}</Link>
          <Link href="/#faq">{t('footer.faq')}</Link>
          <span>{t('footer.networks')}</span>
        </span>
      </div>
    </footer>
  );
}
