import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomInt, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { STEP_SECONDS, stepAt, totp } from '../src/auth/totp';
import { decrypt } from '../src/common/crypto';

export const STAFF_PASSWORD = 'Test-Password-2026';

export async function bootApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export type Http = ReturnType<typeof request>;

export function http(app: INestApplication) {
  return request(app.getHttpServer());
}

export function newPhone(network: 'MTN' | 'ORANGE' | 'ANY' = 'ANY'): string {
  if (network === 'MTN') return `23767${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  if (network === 'ORANGE') return `23769${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  return `2376${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

export async function customer(app: INestApplication, opts: { network?: 'MTN' | 'ORANGE' | 'ANY'; locale?: 'en' | 'fr' } = {}) {
  const phone = newPhone(opts.network);
  const res = await http(app).post('/auth/customer/register').send({ phone, fullName: 'Test Customer', password: 'a-long-password-1', locale: opts.locale ?? 'en' }).expect(201);
  return { phone, token: res.body.accessToken as string, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

/** Authenticator secrets the helper enrolled, and the last step it used (codes are single-use). */
const authenticators = new Map<string, { secret: string; lastStep: number }>();

/**
 * Next unused code for an enrolled test account. The server accepts one step of
 * drift and never the same step twice, so rapid repeat sign-ins wait for the clock.
 */
export async function nextCode(email: string): Promise<string> {
  const a = authenticators.get(email);
  if (!a) throw new Error(`no authenticator for ${email}`);
  const step = Math.max(stepAt(Date.now()), a.lastStep + 1);
  a.lastStep = step;
  const waitMs = (step - 1) * STEP_SECONDS * 1000 - Date.now();
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs + 50));
  return totp(a.secret, step * STEP_SECONDS * 1000);
}

/** Full staff sign-in: password, then authenticator enrolment or code. Returns the Authorization header. */
export async function staff(app: INestApplication, email: string, password = STAFF_PASSWORD) {
  const first = await http(app).post('/auth/staff/login').send({ email, password }).expect(200);
  if (first.body.next === 'TOTP_ENROLL') authenticators.set(email, { secret: first.body.secret, lastStep: -1 });
  else if (!authenticators.has(email)) {
    // Enrolled by another test file: read the secret (and last used step) the way a phone would have kept it.
    const row = await app.get(PrismaService).staffUser.findUniqueOrThrow({ where: { email } });
    authenticators.set(email, { secret: decrypt(row.totpSecretEncrypted!, process.env.APP_ENCRYPTION_KEY!), lastStep: row.totpLastStep ?? -1 });
  }
  const second = await http(app).post('/auth/staff/login/totp').send({ challenge: first.body.challenge, code: await nextCode(email) }).expect(200);
  if (second.body.next !== 'DONE') throw new Error(`unexpected step ${second.body.next}`);
  return { Authorization: `Bearer ${second.body.accessToken}` };
}

export async function quote(app: INestApplication, c: { phone: string; auth: Record<string, string> }, serviceCode: string, amount: number) {
  return http(app).post('/quotes').set(c.auth).send({ serviceCode, amount, senderMsisdn: c.phone, recipientMsisdn: '699112233' });
}

export async function accept(app: INestApplication, c: { auth: Record<string, string> }, quoteId: string, key = `k-${randomUUID()}`) {
  return http(app).post('/transactions').set(c.auth).set('Idempotency-Key', key).send({ quoteId, acceptedTerms: true });
}

/** Full happy path up to a submitted manual reference. */
export async function manualTransaction(app: INestApplication, c: { phone: string; auth: Record<string, string> }, amount: number) {
  const q = await quote(app, c, 'MTN_AIRTIME__ORANGE_MONEY', amount);
  if (q.status !== 201) throw new Error(`quote failed: ${JSON.stringify(q.body)}`);
  const t = await accept(app, c, q.body.id);
  if (t.status !== 201) throw new Error(`accept failed: ${JSON.stringify(t.body)}`);
  await http(app).post(`/transactions/${t.body.id}/source-reference`).set(c.auth).send({ customerReference: 'MP-REF-0001' }).expect(201);
  return t.body.id as string;
}

/**
 * Finds a source amount whose payout instruction ends with `tail` for the
 * MTN MoMo → Orange Money demo rule (1% + 50, min 100, max 2000; provider fee 100),
 * while the collection amount itself ends normally.
 */
export function amountWithPayoutTail(tail: number): number {
  for (let a = 5_000; a < 200_000; a++) {
    const fee = Math.min(Math.max(Math.ceil(a / 100) + 50, 100), 2000);
    const payout = a - fee - 100;
    if (payout % 100 === tail && ![13, 17, 19, 23, 29].includes(a % 100)) return a;
  }
  throw new Error('no amount found');
}

export async function verificationFor(app: INestApplication, transactionId: string, auth: Record<string, string>) {
  const list = await http(app).get('/admin/verifications?status=PENDING,AWAITING_SECOND_APPROVAL,ON_HOLD,ESCALATED').set(auth).expect(200);
  const mv = list.body.find((x: { transactionId: string }) => x.transactionId === transactionId);
  if (!mv) throw new Error('verification not in queue');
  return mv as { id: string; version: number; status: string };
}

export async function txState(prisma: PrismaService, id: string) {
  return (await prisma.transaction.findUniqueOrThrow({ where: { id } })).state;
}
