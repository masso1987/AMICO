import type { Metadata } from 'next';
import { KV, PageHead } from '@/components/ui';
import { ChangePassword, SignOutEverywhere } from '@/components/StaffControls';
import { roleLabel } from '@/lib/roles';
import { when } from '@/lib/format';
import { load } from '@/lib/staff';

export const metadata: Metadata = { title: 'My account' };

interface Me {
  id: string; email: string; fullName: string; roles: string[];
  twoFactorEnabled: boolean; twoFactorSince: string | null; lastLoginAt: string | null; createdAt: string;
}

export default async function Account() {
  const me = await load<Me>('/auth/staff/me');
  return (
    <>
      <PageHead title="My account" sub="Your sign-in details. Lost your phone? Ask an administrator to reset your two-step sign-in." />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card">
          <h2>{me.fullName}</h2>
          <KV
            rows={[
              ['Email', me.email],
              ['Roles', me.roles.map(roleLabel).join(', ')],
              ['Two-step sign-in', me.twoFactorEnabled ? `On since ${when(me.twoFactorSince!)}` : 'Not set up'],
              ['Last sign-in', me.lastLoginAt ? when(me.lastLoginAt) : '—'],
            ]}
          />
          <div style={{ marginTop: 14 }}>
            <SignOutEverywhere />
          </div>
        </section>
        <section className="card">
          <h2>Change password</h2>
          <ChangePassword />
        </section>
      </div>
    </>
  );
}
