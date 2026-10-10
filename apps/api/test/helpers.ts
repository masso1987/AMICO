import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomInt, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

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

export function newPhone(): string {
  return `2376${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

export async function customer(app: INestApplication) {
  const phone = newPhone();
  const res = await http(app).post('/auth/customer/register').send({ phone, fullName: 'Test Customer', password: 'a-long-password-1' }).expect(201);
  return { phone, token: res.body.accessToken as string, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

export async function staff(app: INestApplication, email: string) {
  const res = await http(app).post('/auth/staff/login').send({ email, password: STAFF_PASSWORD }).expect(200);
  return { Authorization: `Bearer ${res.body.accessToken}` };
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
