import type { Metadata } from 'next';
import { Empty, PageHead } from '@/components/ui';
import { CreateStaff, ManageStaff, type StaffRow } from '@/components/StaffControls';
import { roleLabel } from '@/lib/roles';
import { when } from '@/lib/format';
import { getStaff, load } from '@/lib/staff';

export const metadata: Metadata = { title: 'Staff accounts' };

interface Row extends StaffRow {
  lastLoginAt: string | null;
  createdAt: string;
}

export default async function Staff() {
  const [rows, me] = await Promise.all([load<Row[]>('/admin/staff'), getStaff()]);
  const demo = rows.filter((r) => r.active && r.email.endsWith('@amico.local'));

  return (
    <>
      <PageHead
        title="Staff accounts"
        sub="Everyone signs in with their own email, password and authenticator app. Removing a role or switching an account off ends its session at once."
      />
      {demo.length > 0 && (
        <p className="msg err" role="alert" style={{ marginBottom: 16 }}>
          {demo.length} shared demo account{demo.length > 1 ? 's are' : ' is'} still active ({demo.map((d) => d.email).join(', ')}). Once everyone has their own account, switch
          {demo.length > 1 ? ' them' : ' it'} off below.
        </p>
      )}
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', alignItems: 'start' }}>
        <section className="card">
          <h2>People</h2>
          {rows.length === 0 ? (
            <Empty>No staff accounts.</Empty>
          ) : (
            <div className="staff-list">
              {rows.map((s) => (
                <details key={s.id} className={`staff-row${s.active ? '' : ' off'}`}>
                  <summary>
                    <span>
                      <strong>{s.fullName}</strong>
                      {s.id === me.id && <span className="badge" style={{ marginLeft: 6 }}>You</span>}
                      <span className="sub" style={{ display: 'block' }}>{s.email}</span>
                    </span>
                    <span className="sub">{s.roles.map(roleLabel).join(', ')}</span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {!s.active && <span className="badge tone-bad">Switched off</span>}
                      {s.active && (s.twoFactorEnabled ? <span className="badge tone-good">2-step on</span> : <span className="badge tone-review">2-step not set up</span>)}
                      {s.active && s.mustChangePassword && <span className="badge tone-wait">Temporary password</span>}
                    </span>
                  </summary>
                  <div className="staff-body">
                    <p className="sub" style={{ margin: '0 0 12px' }}>
                      Last sign-in: {s.lastLoginAt ? when(s.lastLoginAt) : 'never'} · Created {when(s.createdAt)}
                    </p>
                    {s.id === me.id ? (
                      <p className="sub" style={{ margin: 0 }}>
                        This is you. Change your password on <a href="/account">My account</a>; another administrator changes your roles.
                      </p>
                    ) : (
                      <ManageStaff s={s} />
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <h2>Add a staff member</h2>
          <CreateStaff />
        </section>
      </div>
    </>
  );
}
