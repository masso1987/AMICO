import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { totp } from '../src/auth/totp';
import { decrypt } from '../src/common/crypto';
import type { PrismaService } from '../src/prisma/prisma.service';
import { bootApp, http, staff, STAFF_PASSWORD } from './helpers';

let app: INestApplication;
let prisma: PrismaService;
let admin: Record<string, string>;

beforeAll(async () => {
  ({ app, prisma } = await bootApp());
  admin = await staff(app, 'admin@amico.local');
});
afterAll(async () => app.close());

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const email = () => `t-${randomUUID().slice(0, 8)}@amico.test`;

/** Creates an account through the API and returns its one-time password. */
async function createStaff(roles: string[]) {
  const e = email();
  const res = await http(app).post('/admin/staff').set(admin).send({ email: e, fullName: 'Test Person', roles }).expect(201);
  expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
  expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|totpSecret/);
  return { id: res.body.staff.id as string, email: e, password: res.body.temporaryPassword as string };
}

/** First sign-in of a new account: password → enrol authenticator → choose password. */
async function firstSignIn(acc: { email: string; password: string }, newPassword = 'a-new-Password-2026') {
  const s1 = await http(app).post('/auth/staff/login').send({ email: acc.email, password: acc.password }).expect(200);
  expect(s1.body.next).toBe('TOTP_ENROLL');
  expect(s1.body.otpauthUrl).toContain('otpauth://totp/AMICO');
  const s2 = await http(app).post('/auth/staff/login/totp').send({ challenge: s1.body.challenge, code: totp(s1.body.secret) }).expect(200);
  expect(s2.body.next).toBe('PASSWORD');
  const s3 = await http(app).post('/auth/staff/login/password').send({ challenge: s2.body.challenge, newPassword }).expect(200);
  expect(s3.body.next).toBe('DONE');
  return { token: s3.body.accessToken as string, secret: s1.body.secret as string };
}

describe('staff two-step sign-in', () => {
  it('a password alone never yields an access token', async () => {
    const r = await http(app).post('/auth/staff/login').send({ email: 'ops1@amico.local', password: STAFF_PASSWORD }).expect(200);
    expect(r.body.accessToken).toBeUndefined();
    expect(['TOTP', 'TOTP_ENROLL']).toContain(r.body.next);
    // The challenge is not a session.
    await http(app).get('/auth/staff/me').set(bearer(r.body.challenge)).expect(403);
  });

  it('wrong password and wrong code are refused; a code cannot be used twice', async () => {
    const acc = await createStaff(['SUPPORT']);
    await firstSignIn(acc);
    await http(app).post('/auth/staff/login').send({ email: acc.email, password: 'wrong-password' }).expect(401);
    const r = await http(app).post('/auth/staff/login').send({ email: acc.email, password: 'a-new-Password-2026' }).expect(200);
    expect(r.body.next).toBe('TOTP');
    expect(r.body.secret).toBeUndefined(); // the secret is shown only before enrolment
    const bad = await http(app).post('/auth/staff/login/totp').send({ challenge: r.body.challenge, code: '000000' }).expect(401);
    expect(bad.body.code).toBe('INVALID_CODE');
    const row = await prisma.staffUser.findUniqueOrThrow({ where: { email: acc.email } });
    // The code from enrolment (same 30 s step) is already spent.
    const used = totp(decrypt(row.totpSecretEncrypted!, process.env.APP_ENCRYPTION_KEY!), row.totpLastStep! * 30_000);
    const replay = await http(app).post('/auth/staff/login/totp').send({ challenge: r.body.challenge, code: used }).expect(401);
    expect(replay.body.code).toBe('INVALID_CODE');
    const fresh = totp(decrypt(row.totpSecretEncrypted!, process.env.APP_ENCRYPTION_KEY!), (row.totpLastStep! + 1) * 30_000);
    await http(app).post('/auth/staff/login/totp').send({ challenge: r.body.challenge, code: fresh }).expect(200);
  });

  it('a new account must set up the authenticator and replace its temporary password', async () => {
    const acc = await createStaff(['SUPPORT']);
    await http(app).post('/auth/staff/login/password').send({ challenge: 'x'.repeat(20), newPassword: 'whatever-2026-x' }).expect(401);
    const { token } = await firstSignIn(acc);
    const me = await http(app).get('/auth/staff/me').set(bearer(token)).expect(200);
    expect(me.body).toMatchObject({ email: acc.email, twoFactorEnabled: true, roles: ['SUPPORT'] });
    // The temporary password is dead.
    await http(app).post('/auth/staff/login').send({ email: acc.email, password: acc.password }).expect(401);
  });

  it('weak new passwords are refused', async () => {
    const acc = await createStaff(['SUPPORT']);
    const s1 = await http(app).post('/auth/staff/login').send({ email: acc.email, password: acc.password }).expect(200);
    const s2 = await http(app).post('/auth/staff/login/totp').send({ challenge: s1.body.challenge, code: totp(s1.body.secret) }).expect(200);
    await http(app).post('/auth/staff/login/password').send({ challenge: s2.body.challenge, newPassword: 'short1' }).expect(400);
    await http(app).post('/auth/staff/login/password').send({ challenge: s2.body.challenge, newPassword: 'onlyletterslong' }).expect(400);
  });

  it('changing your password ends your other sessions', async () => {
    const acc = await createStaff(['SUPPORT']);
    const { token } = await firstSignIn(acc, 'first-Password-2026');
    const r = await http(app).post('/auth/staff/password').set(bearer(token)).send({ currentPassword: 'first-Password-2026', newPassword: 'second-Password-2026' }).expect(200);
    await http(app).get('/auth/staff/me').set(bearer(token)).expect(401);
    await http(app).get('/auth/staff/me').set(bearer(r.body.accessToken)).expect(200);
    await http(app).post('/auth/staff/sessions/revoke').set(bearer(r.body.accessToken)).expect(200);
    await http(app).get('/auth/staff/me').set(bearer(r.body.accessToken)).expect(401);
  });
});

describe('staff account management', () => {
  it('only administrators manage staff', async () => {
    const ops = await staff(app, 'ops2@amico.local');
    await http(app).get('/admin/staff').set(ops).expect(403);
    await http(app).post('/admin/staff').set(ops).send({ email: email(), fullName: 'X Y', roles: ['ADMIN'] }).expect(403);
    const list = await http(app).get('/admin/staff').set(admin).expect(200);
    expect(list.body.find((s: { email: string }) => s.email === 'admin@amico.local')).toMatchObject({ twoFactorEnabled: true, active: true });
    await http(app).post('/admin/staff').set(admin).send({ email: 'admin@amico.local', fullName: 'Dup', roles: ['SUPPORT'] }).expect(409);
  });

  it('administrators cannot change their own account from the staff page', async () => {
    const me = await http(app).get('/auth/staff/me').set(admin).expect(200);
    const r = await http(app).patch(`/admin/staff/${me.body.id}`).set(admin).send({ active: false, reason: 'testing self' }).expect(403);
    expect(r.body.code).toBe('SELF_CHANGE');
  });

  it('removing a role or deactivating takes effect immediately', async () => {
    const acc = await createStaff(['FINANCE', 'SUPPORT']);
    const { token } = await firstSignIn(acc);
    await http(app).get('/admin/refunds').set(bearer(token)).expect(200);
    await http(app).patch(`/admin/staff/${acc.id}`).set(admin).send({ roles: ['SUPPORT'], reason: 'Moved to support desk' }).expect(200);
    await http(app).get('/auth/staff/me').set(bearer(token)).expect(401); // must sign in again
    await http(app).patch(`/admin/staff/${acc.id}`).set(admin).send({ active: false, reason: 'Left the company' }).expect(200);
    await http(app).post('/auth/staff/login').send({ email: acc.email, password: 'a-new-Password-2026' }).expect(401);
    const log = await prisma.auditLog.findMany({ where: { entityId: acc.id, action: 'staff.updated' } });
    expect(log).toHaveLength(2);
  });

  it('resetting 2FA ends the session and forces a new authenticator', async () => {
    const acc = await createStaff(['OPERATIONS']);
    const { token, secret } = await firstSignIn(acc);
    await http(app).post(`/admin/staff/${acc.id}/reset-2fa`).set(admin).send({ reason: 'Lost phone' }).expect(201);
    await http(app).get('/auth/staff/me').set(bearer(token)).expect(401);
    const r = await http(app).post('/auth/staff/login').send({ email: acc.email, password: 'a-new-Password-2026' }).expect(200);
    expect(r.body.next).toBe('TOTP_ENROLL');
    expect(r.body.secret).not.toBe(secret);
  });

  it('resetting a password issues a new one-time password', async () => {
    const acc = await createStaff(['OPERATIONS']);
    await firstSignIn(acc);
    const r = await http(app).post(`/admin/staff/${acc.id}/reset-password`).set(admin).send({ reason: 'Forgot password' }).expect(201);
    await http(app).post('/auth/staff/login').send({ email: acc.email, password: 'a-new-Password-2026' }).expect(401);
    const s1 = await http(app).post('/auth/staff/login').send({ email: acc.email, password: r.body.temporaryPassword }).expect(200);
    expect(s1.body.next).toBe('TOTP'); // the authenticator is kept
  });
});
