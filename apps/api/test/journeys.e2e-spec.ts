import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { canonicalJson } from '../src/common/crypto';
import type { PrismaService } from '../src/prisma/prisma.service';
import { accept, amountWithPayoutTail, bootApp, customer, http, manualTransaction, quote, staff, txState, verificationFor } from './helpers';

const created = <T extends { status: number; body: unknown }>(r: T): T => {
  if (r.status !== 201) throw new Error(`expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};

let app: INestApplication;
let prisma: PrismaService;
let ops1: Record<string, string>;
let ops2: Record<string, string>;
let finance: Record<string, string>;
let admin: Record<string, string>;
let support: Record<string, string>;

beforeAll(async () => {
  ({ app, prisma } = await bootApp());
  [ops1, ops2, finance, admin, support] = await Promise.all(
    ['ops1', 'ops2', 'finance', 'admin', 'support'].map((n) => staff(app, `${n}@amico.local`)),
  );
});
afterAll(async () => app.close());

describe('catalogue and quotes', () => {
  it('lists only usable services (disabled routes are hidden)', async () => {
    const res = await http(app).get('/services').expect(200);
    const codes = res.body.map((s: { code: string }) => s.code);
    expect(codes).toContain('MTN_MOMO__ORANGE_MONEY');
    expect(codes).not.toContain('ORANGE_AIRTIME__MTN_AIRTIME');
  });

  it('refuses a quote for a disabled service', async () => {
    const c = await customer(app);
    const res = await quote(app, c, 'ORANGE_AIRTIME__MTN_AIRTIME', 5000);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('returns a labelled quote with separate platform and provider fees', async () => {
    const c = await customer(app);
    const res = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 10_000).then(created);
    expect(res.body).toMatchObject({
      kind: 'ESTIMATED_QUOTE', simulated: true, platformFee: 150, providerFee: { amount: 100, status: 'ESTIMATE' },
      totalPayable: 10_000, expectedReceived: 9_750, pricingRuleVersion: 1,
    });
    expect(res.body.notice).toMatch(/No money has moved/);
    // A quote alone creates no transaction and no ledger entry.
    expect(await prisma.transaction.count({ where: { quoteId: res.body.id } })).toBe(0);
  });

  it('rejects amounts outside the rule limits and non-integer amounts', async () => {
    const c = await customer(app);
    expect((await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 100)).body.code).toBe('BELOW_MIN_AMOUNT');
    expect((await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 1_000_000)).body.code).toBe('ABOVE_MAX_AMOUNT');
    expect((await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 1000.5)).status).toBe(400);
  });

  it('refuses an expired quote', async () => {
    const c = await customer(app);
    const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 10_000);
    await prisma.quote.update({ where: { id: q.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const t = await accept(app, c, q.body.id);
    expect(t.status).toBe(409);
    expect(t.body.code).toBe('QUOTE_EXPIRED');
  });
});

describe('API route: MoMo → Orange Money (mock provider)', () => {
  it('completes only after delivery is verified, and posts a balanced ledger', async () => {
    const c = await customer(app);
    const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 10_000);
    const t = await accept(app, c, q.body.id).then(created);
    const view = await http(app).get(`/transactions/${t.body.id}`).set(c.auth).expect(200);
    expect(view.body.state).toBe('COMPLETED');
    expect(view.body.timeline.map((h: { toState: string }) => h.toState)).toEqual([
      'CREATED', 'QUOTE_PENDING_CONFIRMATION', 'AWAITING_SOURCE_PAYMENT', 'PAYMENT_PROCESSING', 'SOURCE_VERIFIED', 'PAYOUT_PROCESSING', 'DELIVERY_PENDING', 'COMPLETED',
    ]);
    expect(view.body.receipt).toMatchObject({ delivered: 9_750, simulated: true });
    expect(view.body.simulationNotice).toMatch(/SIMULATION/);
    const journals = await prisma.ledgerJournal.findMany({ where: { transactionId: t.body.id }, include: { entries: true } });
    expect(journals.map((j) => j.kind).sort()).toEqual(['PAYOUT_COMPLETED', 'SOURCE_RECEIVED']);
    for (const j of journals) {
      expect(j.book).toBe('SIMULATED');
      expect(j.entries.reduce((s, e) => s + e.debit - e.credit, 0)).toBe(0);
    }
  });

  it('is idempotent on Idempotency-Key and refuses reusing a key for another quote', async () => {
    const c = await customer(app);
    const q1 = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 10_000);
    const q2 = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 12_000);
    const a = await accept(app, c, q1.body.id, 'same-key-123');
    const b = await accept(app, c, q1.body.id, 'same-key-123');
    expect(b.body.id).toBe(a.body.id);
    const other = await accept(app, c, q2.body.id, 'same-key-123');
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // And a quote cannot be accepted twice under different keys.
    const again = await accept(app, c, q1.body.id, 'another-key-456');
    expect(again.body.code).toBe('QUOTE_ALREADY_USED');
  });

  it('a definitive payout failure ends FAILED with the slot released, then refunds through maker-checker', async () => {
    const c = await customer(app);
    const amount = amountWithPayoutTail(13);
    const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', amount);
    const t = await accept(app, c, q.body.id).then(created);
    expect(await txState(prisma, t.body.id)).toBe('FAILED');
    const ops = await prisma.providerOperation.findMany({ where: { transactionId: t.body.id, kind: 'DISBURSE' } });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ status: 'FAILED', payoutSlot: null });

    const r = await http(app).post(`/admin/transactions/${t.body.id}/refunds`).set(finance).send({ reason: 'Payout declined by provider' }).expect(201);
    // Requester cannot approve their own refund.
    await http(app).post(`/admin/refunds/${r.body.id}/approve`).set(finance).expect(403);
    // Operations can request but not approve.
    await http(app).post(`/admin/refunds/${r.body.id}/approve`).set(ops1).expect(403);
    const finance2 = admin; // admin lacks REFUND_APPROVE
    await http(app).post(`/admin/refunds/${r.body.id}/approve`).set(finance2).expect(403);
    // A second finance user approves.
    await prisma.staffUser.upsert({
      where: { email: 'finance2@amico.local' },
      update: {},
      create: { email: 'finance2@amico.local', fullName: 'Finance 2', roles: ['FINANCE'], passwordHash: (await prisma.staffUser.findUniqueOrThrow({ where: { email: 'finance@amico.local' } })).passwordHash },
    });
    const f2 = await staff(app, 'finance2@amico.local');
    await http(app).post(`/admin/refunds/${r.body.id}/approve`).set(f2).expect(201);
    expect(await txState(prisma, t.body.id)).toBe('REFUNDED');
    const kinds = (await prisma.ledgerJournal.findMany({ where: { transactionId: t.body.id } })).map((j) => j.kind).sort();
    expect(kinds).toEqual(['REFUND_COMPLETED', 'SOURCE_RECEIVED']);
  });

  it('an uncertain payout is status-queried, never retried blindly (…17 resolves to success)', async () => {
    const c = await customer(app);
    const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', amountWithPayoutTail(17));
    const t = await accept(app, c, q.body.id);
    expect(await txState(prisma, t.body.id)).toBe('COMPLETED');
    expect(await prisma.providerOperation.count({ where: { transactionId: t.body.id, kind: 'DISBURSE' } })).toBe(1);
  });

  it('an uncertain payout that resolves to failure (…19) ends FAILED', async () => {
    const c = await customer(app);
    const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', amountWithPayoutTail(19));
    const t = await accept(app, c, q.body.id);
    expect(await txState(prisma, t.body.id)).toBe('FAILED');
  });

  it('an outcome that never resolves (…29) escalates to UNDER_REVIEW and blocks refunds', async () => {
    const c = await customer(app);
    const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', amountWithPayoutTail(29));
    const t = await accept(app, c, q.body.id);
    expect(await txState(prisma, t.body.id)).toBe('UNDER_REVIEW');
    const op = await prisma.providerOperation.findFirstOrThrow({ where: { transactionId: t.body.id, kind: 'DISBURSE' } });
    expect(op).toMatchObject({ status: 'UNKNOWN', statusChecks: 5, payoutSlot: t.body.id });
    const r = await http(app).post(`/admin/transactions/${t.body.id}/refunds`).set(finance).send({ reason: 'Customer asked for money back' });
    expect(r.body.code).toBe('PAYOUT_OUTCOME_UNCERTAIN');
    // The unique payout slot makes a second live payout impossible at the DB level.
    await expect(
      prisma.providerOperation.create({ data: { transactionId: t.body.id, kind: 'DISBURSE', operator: 'ORANGE', providerCode: 'MOCK', idempotencyKey: `${t.body.id}:dup`, payoutSlot: t.body.id, amount: 100, msisdn: 'x', simulated: true } }),
    ).rejects.toThrow();
  });

  it('a declined collection is REJECTED with no ledger posting', async () => {
    const c = await customer(app);
    const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 10_013);
    const t = await accept(app, c, q.body.id);
    expect(await txState(prisma, t.body.id)).toBe('REJECTED');
    expect(await prisma.ledgerJournal.count({ where: { transactionId: t.body.id } })).toBe(0);
  });
});

describe('manual airtime verification', () => {
  it('shows the receiving SIM number and holds until staff confirm', async () => {
    const c = await customer(app);
    const q = await quote(app, c, 'MTN_AIRTIME__ORANGE_MONEY', 5_000);
    expect(q.body.conversionRate).toBe(0.85);
    expect(q.body.restrictions.join(' ')).toMatch(/not proof of receipt/);
    const t = await accept(app, c, q.body.id).then(created);
    expect(t.body.paymentInstructions).toMatchObject({ method: 'MANUAL_AIRTIME_TRANSFER', sendTo: '237670000002', amount: 5_000 });
    await http(app).post(`/transactions/${t.body.id}/source-reference`).set(c.auth).send({ customerReference: 'MP-REF-0002' }).expect(201);
    // The reference alone moves nothing.
    expect(await txState(prisma, t.body.id)).toBe('AWAITING_MANUAL_VERIFICATION');
    expect(await prisma.ledgerJournal.count({ where: { transactionId: t.body.id } })).toBe(0);
  });

  it('confirming requires an amount and an evidence note', async () => {
    const c = await customer(app);
    const id = await manualTransaction(app, c, 5_000);
    const mv = await verificationFor(app, id, ops1);
    const res = await http(app).post(`/admin/verifications/${mv.id}/decision?version=${mv.version}`).set(ops1).send({ decision: 'CONFIRM_RECEIVED', receivedAmount: 5_000 });
    expect(res.status).toBe(400);
  });

  it('approval completes the transfer; a duplicate click is refused', async () => {
    const c = await customer(app);
    const id = await manualTransaction(app, c, 5_000);
    const mv = await verificationFor(app, id, ops1);
    const body = { decision: 'CONFIRM_RECEIVED', receivedAmount: 5_000, evidenceNote: 'Balance SMS shows +5000 FCFA at 10:02' };
    const [a, b] = await Promise.all([
      http(app).post(`/admin/verifications/${mv.id}/decision?version=${mv.version}`).set(ops1).send(body),
      http(app).post(`/admin/verifications/${mv.id}/decision?version=${mv.version}`).set(ops2).send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await txState(prisma, id)).toBe('COMPLETED');
    expect(await prisma.providerOperation.count({ where: { transactionId: id, kind: 'DISBURSE' } })).toBe(1);
  });

  it('rejection when airtime never arrived', async () => {
    const c = await customer(app);
    const id = await manualTransaction(app, c, 5_000);
    const mv = await verificationFor(app, id, ops1);
    await http(app).post(`/admin/verifications/${mv.id}/decision?version=${mv.version}`).set(ops1).send({ decision: 'NOT_RECEIVED', reason: 'No incoming transfer on the SIM in the last 2 hours' }).expect(201);
    expect(await txState(prisma, id)).toBe('REJECTED');
  });

  it('a partial or wrong amount is held for review and never paid automatically', async () => {
    const c = await customer(app);
    const id = await manualTransaction(app, c, 5_000);
    const mv = await verificationFor(app, id, ops1);
    const res = await http(app).post(`/admin/verifications/${mv.id}/decision?version=${mv.version}`).set(ops1).send({ decision: 'CONFIRM_RECEIVED', receivedAmount: 3_000, evidenceNote: 'Balance SMS shows only +3000 FCFA' }).expect(201);
    expect(res.body.status).toBe('ON_HOLD');
    expect(await txState(prisma, id)).toBe('UNDER_REVIEW');
    expect(await prisma.providerOperation.count({ where: { transactionId: id } })).toBe(0);
  });

  it('high-risk transactions need a second, different approver', async () => {
    const c = await customer(app);
    const id = await manualTransaction(app, c, 60_000);
    const mv = await verificationFor(app, id, ops1);
    const first = await http(app).post(`/admin/verifications/${mv.id}/decision?version=${mv.version}`).set(ops1).send({ decision: 'CONFIRM_RECEIVED', receivedAmount: 60_000, evidenceNote: 'Balance SMS shows +60000 FCFA at 11:15' }).expect(201);
    expect(first.body.status).toBe('AWAITING_SECOND_APPROVAL');
    expect(await txState(prisma, id)).toBe('AWAITING_MANUAL_VERIFICATION');
    const same = await http(app).post(`/admin/verifications/${mv.id}/second-approval?version=${first.body.version}`).set(ops1).send({ receivedAmount: 60_000, evidenceNote: 'Checked again myself' });
    expect(same.body.code).toBe('DUAL_APPROVAL_SAME_PERSON');
    const fresh = await verificationFor(app, id, ops2);
    await http(app).post(`/admin/verifications/${mv.id}/second-approval?version=${fresh.version}`).set(ops2).send({ receivedAmount: 60_000, evidenceNote: 'Independently checked SIM SMS log' }).expect(201);
    expect(await txState(prisma, id)).toBe('COMPLETED');
  });
});

describe('fees, permissions and controls', () => {
  it('a fee change after a quote requires a new confirmation; accepted transactions keep their terms', async () => {
    const c = await customer(app);
    const accepted = await quote(app, c, 'ORANGE_MONEY__MTN_MOMO', 10_000);
    const done = await accept(app, c, accepted.body.id).then(created);
    const pending = await quote(app, c, 'ORANGE_MONEY__MTN_MOMO', 10_000);

    const draft = await http(app).post('/admin/pricing-rules').set(finance).send({
      serviceCode: 'ORANGE_MONEY__MTN_MOMO', feeType: 'FIXED', fixedFee: 300, minAmount: 500, maxAmount: 500_000,
      deductionMethod: 'DEDUCT_FROM_DESTINATION', conversionRatePpm: 1_000_000, effectiveFrom: new Date(Date.now() - 1000).toISOString(), changeReason: 'Flat fee trial',
    }).expect(201);
    expect(draft.body.status).toBe('PENDING_APPROVAL');
    // Maker cannot approve; support cannot even draft.
    expect((await http(app).post(`/admin/pricing-rules/${draft.body.id}/approve`).set(finance)).body.code).toBe('MAKER_CHECKER');
    await http(app).post('/admin/pricing-rules').set(support).send({}).expect(403);
    await http(app).post(`/admin/pricing-rules/${draft.body.id}/approve`).set(admin).expect(201);

    const late = await accept(app, c, pending.body.id);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('PRICING_CHANGED');
    const kept = await prisma.transaction.findUniqueOrThrow({ where: { id: done.body.id } });
    expect(kept.platformFee).toBe(150);
    const fresh = await quote(app, c, 'ORANGE_MONEY__MTN_MOMO', 10_000);
    expect(fresh.body.platformFee).toBe(300);
  });

  it('the fee simulator uses the same engine and can preview a staff-entered provider charge', async () => {
    const res = await http(app).post('/admin/pricing/simulate').set(finance).send({ serviceCode: 'MTN_MOMO__ORANGE_MONEY', amount: 10_000, providerFeeAmount: 250 }).expect(201);
    expect(res.body).toMatchObject({ ok: true, customerPays: 10_000, platformRevenue: 150, providerCost: 250, destinationAmount: 9_600 });
  });

  it('protects SIM numbers: masked by default, reveal needs permission and is audited', async () => {
    const list = await http(app).get('/admin/sim-accounts').set(support).expect(200);
    expect(list.body).toHaveLength(4);
    expect(JSON.stringify(list.body)).not.toMatch(/237670000002/);
    expect(list.body[0]).not.toHaveProperty('msisdnEncrypted');
    const sim = list.body.find((s: { code: string }) => s.code === 'SIM-MTN-NORMAL');
    await http(app).post(`/admin/sim-accounts/${sim.id}/reveal`).set(support).send({ reason: 'curious' }).expect(403);
    const r = await http(app).post(`/admin/sim-accounts/${sim.id}/reveal`).set(ops1).send({ reason: 'Checking incoming transfer' }).expect(201);
    expect(r.body.msisdn).toBe('237670000002');
    expect(await prisma.auditLog.count({ where: { action: 'sim.reveal_number', entityId: sim.id } })).toBeGreaterThan(0);
    // No field for PINs or secrets is accepted.
    await http(app).patch(`/admin/sim-accounts/${sim.id}`).set(admin).send({ pin: '1234', reason: 'test' }).expect(400);
    // Customers cannot reach admin routes.
    const c = await customer(app);
    await http(app).get('/admin/sim-accounts').set(c.auth).expect(403);
  });

  it('a disabled provider capability makes a service unavailable, and it cannot be re-enabled until verified', async () => {
    const cap = await prisma.providerCapability.findFirstOrThrow({ where: { operator: 'MTN', capability: 'AIRTIME_TOPUP' } });
    await http(app).post(`/admin/providers/capabilities/${cap.id}/disable`).set(admin).send({ notes: 'Provider maintenance window' }).expect(201);
    const c = await customer(app);
    expect((await quote(app, c, 'MTN_MOMO__MTN_AIRTIME', 5_000)).body.code).toBe('SERVICE_UNAVAILABLE');
    const svc = await prisma.service.findUniqueOrThrow({ where: { code: 'MTN_MOMO__MTN_AIRTIME' } });
    await http(app).post(`/admin/services/${svc.id}/disable`).set(admin).send({ reason: 'Capability down' }).expect(201);
    const enable = await http(app).post(`/admin/services/${svc.id}/enable`).set(admin).send({ reason: 'Try again' });
    expect(enable.body.code).toBe('SERVICE_NOT_READY');
    await http(app).post(`/admin/providers/capabilities/${cap.id}/verify`).set(admin).send({ notes: 'Re-verified for simulation' }).expect(201);
    await http(app).post(`/admin/services/${svc.id}/enable`).set(admin).send({ reason: 'Capability back' }).expect(201);
  });

  it('duplicate provider callbacks are dropped; bad signatures refused', async () => {
    const body = { eventId: `evt-${Date.now()}`, providerReference: 'SIM-NOT-EXISTING', status: 'SUCCESSFUL' };
    const sig = createHmac('sha256', process.env.CALLBACK_SHARED_SECRET!).update(canonicalJson(body)).digest('hex');
    const first = await http(app).post('/callbacks/MOCK').set('x-amico-signature', sig).send(body).expect(200);
    const second = await http(app).post('/callbacks/MOCK').set('x-amico-signature', sig).send(body).expect(200);
    expect(first.body).toMatchObject({ accepted: true, duplicate: false });
    expect(second.body).toMatchObject({ accepted: true, duplicate: true });
    await http(app).post('/callbacks/MOCK').set('x-amico-signature', 'nope').send(body).expect(401);
  });

  it('ledger and history are immutable at the database level', async () => {
    const e = await prisma.ledgerEntry.findFirstOrThrow();
    await expect(prisma.ledgerEntry.update({ where: { id: e.id }, data: { debit: e.debit + 1 } })).rejects.toThrow(/append-only/);
    const h = await prisma.transactionStateHistory.findFirstOrThrow();
    await expect(prisma.transactionStateHistory.delete({ where: { id: h.id } })).rejects.toThrow(/append-only/);
  });

  it('reconciliation is clean and both books balance', async () => {
    const r = await http(app).get('/admin/reports/reconciliation').set(finance).expect(200);
    for (const b of r.body.books) expect(b.balanced).toBe(true);
    expect(r.body.exceptions.completedWithoutPayoutJournal).toHaveLength(0);
    expect(r.body.exceptions.succeededButNotCompleted).toHaveLength(0);
    const rev = await http(app).get('/admin/reports/revenue?simulated=true').set(finance).expect(200);
    expect(rev.body.rows.reduce((s: number, x: { transactions: number }) => s + x.transactions, 0)).toBeGreaterThan(0);
  });
});
