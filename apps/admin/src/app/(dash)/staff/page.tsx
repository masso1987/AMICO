import { Empty, PageHead } from '@/components/ui';
import { CreateStaff, ManageStaff, type RoleOption, type StaffRow } from '@/components/StaffControls';
import { getT } from '@/i18n/server';
import { phone, when } from '@/lib/format';
import { getStaff, load } from '@/lib/staff';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('nav.staff') };
}

interface Row extends StaffRow {
  lastLoginAt: string | null;
  createdAt: string;
}

export default async function Staff() {
  const { t, locale } = await getT();
  const [rows, me, roles] = await Promise.all([load<Row[]>('/admin/staff'), getStaff(), load<RoleOption[]>('/admin/access/roles')]);
  const demo = rows.filter((r) => r.active && r.email.endsWith('@amico.local'));
  const roleName = (k: string) => roles.find((r) => r.key === k)?.name ?? k;

  return (
    <>
      <PageHead title={t('nav.staff')} sub={t('staff.sub')} />
      {demo.length > 0 && (
        <p className="msg err" role="alert" style={{ marginBottom: 16 }}>
          {t('staff.demoWarning', { n: demo.length, emails: demo.map((d) => d.email).join(', ') })}
        </p>
      )}
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', alignItems: 'start' }}>
        <section className="card">
          <h2>{t('staff.people')}</h2>
          {rows.length === 0 ? (
            <Empty>{t('staff.none')}</Empty>
          ) : (
            <div className="staff-list">
              {rows.map((s) => (
                <details key={s.id} className={`staff-row${s.active ? '' : ' off'}`}>
                  <summary>
                    <span>
                      <strong>{s.fullName}</strong>
                      {s.id === me.id && <span className="badge" style={{ marginLeft: 6 }}>{t('staff.you')}</span>}
                      <span className="sub" style={{ display: 'block' }}>{s.email}{s.phone ? ` · ${phone(s.phone)}` : ''}</span>
                    </span>
                    <span className="sub">{s.roles.map(roleName).join(', ')}</span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {!s.active && <span className="badge tone-bad">{t('staff.off')}</span>}
                      {s.active && (s.twoFactorEnabled ? <span className="badge tone-good">{t('staff.twoStepOn')}</span> : <span className="badge tone-review">{t('staff.twoStepMissing')}</span>)}
                      {s.active && s.mustChangePassword && <span className="badge tone-wait">{t('staff.tempPassword')}</span>}
                      {s.active && s.alertChannels.length > 0 && <span className="badge">{t('staff.getsAlerts')}</span>}
                    </span>
                  </summary>
                  <div className="staff-body">
                    <p className="sub" style={{ margin: '0 0 12px' }}>
                      {t('staff.lastSignIn', { at: s.lastLoginAt ? when(s.lastLoginAt, locale) : t('staff.never'), created: when(s.createdAt, locale) })}
                    </p>
                    {s.id === me.id ? <p className="sub" style={{ margin: 0 }}>{t('staff.thisIsYou')}</p> : <ManageStaff s={s} roles={roles} />}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <h2>{t('staff.add')}</h2>
          <CreateStaff roles={roles} />
        </section>
      </div>
    </>
  );
}
