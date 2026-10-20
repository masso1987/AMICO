import { SettingForm, type SettingField } from '@/components/Settings';
import { PageHead } from '@/components/ui';
import { getT } from '@/i18n/server';
import { can, getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.settings') };
}

type All = Record<string, { value: Record<string, unknown>; permission: string }>;

const FIELDS: Record<string, SettingField[]> = {
  cancellation: [
    { key: 'feeBps', kind: 'percentBps' },
    { key: 'allowAfterPayment', kind: 'bool' },
  ],
  refunds: [{ key: 'autoRequestOnFailure', kind: 'bool' }],
  messaging: [
    { key: 'transactionMessages', kind: 'bool' },
    { key: 'fallbackToOtherOperator', kind: 'bool' },
    { key: 'maxAttempts', kind: 'int' },
  ],
  numberPlan: [
    { key: 'MTN', kind: 'list' },
    { key: 'ORANGE', kind: 'list' },
  ],
  alerts: [
    { key: 'enabled', kind: 'bool' },
    { key: 'verificationWaitMinutes', kind: 'int' },
    { key: 'verificationQueueSize', kind: 'int' },
    { key: 'failureRatePercent', kind: 'int' },
    { key: 'slowProviderMs', kind: 'int' },
    { key: 'underReviewCount', kind: 'int' },
    { key: 'failedMessagesPerHour', kind: 'int' },
    { key: 'repeatAfterMinutes', kind: 'int' },
  ],
};

export default async function Page() {
  const { t } = await getT();
  const staff = await getStaff();
  const all = await load<All>('/admin/settings');
  return (
    <>
      <PageHead title={t('nav.settings')} sub={t('settings.sub')} />
      <div className="settings-grid">
        {Object.keys(FIELDS).filter((k) => all[k]).map((k) => (
          <SettingForm key={k} settingKey={k} value={all[k]!.value} fields={FIELDS[k]!} canEdit={can(staff, all[k]!.permission)} />
        ))}
      </div>
    </>
  );
}
