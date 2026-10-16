import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/prisma/prisma.service';
import { MessagingService } from '../src/messaging/messaging.service';
import { MonitoringService } from '../src/monitoring/monitoring.module';
import { MaintenanceService } from '../src/maintenance/maintenance.module';
import { accept, bootApp, customer, http, manualTransaction, newPhone, quote, staff, txState, verificationFor } from './helpers';
import { startFakeGateway } from './fake-gateway';

let app: INestApplication;
let prisma: PrismaService;
let messaging: MessagingService;
let admin: Record<string, string>;
let finance: Record<string, string>;
let ops1: Record<string, string>;
let support: Record<string, string>;

const created = <T extends { status: number; body: unknown }>(r: T): T => {
  if (r.status !== 201) throw new Error(`expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
};

beforeAll(async () => {
  ({ app, prisma } = await bootApp());
  messaging = app.get(MessagingService);
  [admin, finance, ops1, support] = await Promise.all(['admin', 'finance', 'ops1', 'support'].map((n) => staff(app, `${n}@amico.local`)));
});
afterAll(async () => app.close());

// ------------------------------------------------------------------ access management

describe('access management', () => {
  it('lists built-in roles with their members and the permission catalogue', async () => {
    const roles = await http(app).get('/admin/access/roles').set(admin).expect(200);
    const keys = roles.body.map((r: { key: string }) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['ADMIN', 'FINANCE', 'OPERATIONS', 'SUPPORT']));
    const perms = await http(app).get('/admin/access/permissions').set(admin).expect(200);
    expect(perms.body.find((p: { key: string }) => p.key === 'MESSAGING_SEND')).toMatchObject({ group: 'Platform' });
    await http(app).get('/admin/access/permissions').set(ops1).expect(403);
  });

  it('a custom role grants exactly its permissions, and edits apply on the next request', async () => {
    const role = await http(app).post('/admin/access/roles').set(admin).send({ name: 'Night checker', permissions: ['TRANSACTION_READ'], reason: 'Night shift reads only' }).expect(201);
    expect(role.body.key).toBe('night-checker');
    const email = `night-${randomUUID().slice(0, 6)}@amico.test`;
    const acc = await http(app).post('/admin/staff').set(admin).send({ email, fullName: 'Night Person', roles: ['night-checker'] }).expect(201);
    await prisma.staffUser.update({ where: { id: acc.body.staff.id }, data: { mustChangePassword: false } });
    const s1 = await http(app).post('/auth/staff/login').send({ email, password: acc.body.temporaryPassword }).expect(200);
    const { totp } = await import('../src/auth/totp');
    const s2 = await http(app).post('/auth/staff/login/totp').send({ challenge: s1.body.challenge, code: totp(s1.body.secret) }).expect(200);
    const night = { Authorization: `Bearer ${s2.body.accessToken}` };
    await http(app).get('/admin/transactions').set(night).expect(200);
    await http(app).get('/admin/verifications').set(night).expect(403);
    await http(app).patch('/admin/access/roles/night-checker').set(admin).send({ permissions: ['TRANSACTION_READ', 'VERIFY_MANUAL'], reason: 'Night shift now checks airtime' }).expect(200);
    await http(app).get('/admin/verifications').set(night).expect(200);
    // In use: cannot be deleted.
    const del = await http(app).delete('/admin/access/roles/night-checker').set(admin).send({ reason: 'No longer needed' }).expect(409);
    expect(del.body.code).toBe('ROLE_IN_USE');
  });

  it('the Administrator role can never lose staff or role management; built-in roles cannot be deleted', async () => {
    const r = await http(app).patch('/admin/access/roles/ADMIN').set(admin).send({ permissions: ['TRANSACTION_READ'], reason: 'Trying to lock everyone out' }).expect(422);
    expect(r.body.code).toBe('LOCKED_PERMISSION');
    const d = await http(app).delete('/admin/access/roles/SUPPORT').set(admin).send({ reason: 'Remove support role' }).expect(422);
    expect(d.body.code).toBe('SYSTEM_ROLE');
    await http(app).post('/admin/staff').set(admin).send({ email: `x-${randomUUID().slice(0, 6)}@amico.test`, fullName: 'X Y', roles: ['NOT_A_ROLE'] }).expect(422);
  });
});

// ------------------------------------------------------------------ settings and cancellation

describe('cancellation (Switchn rules)', () => {
  it('only people with the settings permission can change the cancellation fee', async () => {
    await http(app).patch('/admin/settings/cancellation').set(ops1).send({ value: { feeBps: 0 }, reason: 'Ops tries to waive' }).expect(403);
    const bad = await http(app).patch('/admin/settings/cancellation').set(finance).send({ value: { feeBps: 99_999 }, reason: 'Too high' }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    const cfg = await http(app).get('/public/config').expect(200);
    expect(cfg.body.cancellation.feeBps).toBe(300);
  });

  it('cancelling before sending anything is free and closes the transaction', async () => {
    const c = await customer(app);
    const q = await quote(app, c, 'MTN_AIRTIME__ORANGE_MONEY', 5_000);
    const t = await accept(app, c, q.body.id).then(created);
    expect(t.body.cancellation).toMatchObject({ possible: true, fee: 0 });
    const r = await http(app).post(`/transactions/${t.body.id}/cancel`).set(c.auth).send({ reason: 'Changed my mind' }).expect(200);
    expect(r.body.state).toBe('REJECTED');
    expect(r.body.cancellation.requested).toBe(true);
    const n = await http(app).get('/notifications').set(c.auth).expect(200);
    expect(n.body[0]).toMatchObject({ kind: 'CANCELLED', title: 'Cancelled' });
    // Idempotent.
    await http(app).post(`/transactions/${t.body.id}/cancel`).set(c.auth).send({}).expect(200);
  });

  it('cancelling after sending airtime refunds it minus 3% once staff confirm receipt, and books the fee', async () => {
    const c = await customer(app);
    const id = await manualTransaction(app, c, 5_000);
    const before = await http(app).get(`/transactions/${id}`).set(c.auth).expect(200);
    expect(before.body.cancellation).toMatchObject({ possible: true, fee: 150, feeBps: 300 });
    await http(app).post(`/transactions/${id}/cancel`).set(c.auth).send({ reason: 'Sent to the wrong number' }).expect(200);
    expect(await txState(prisma, id)).toBe('AWAITING_MANUAL_VERIFICATION');

    const mv = await verificationFor(app, id, ops1);
    await http(app).post(`/admin/verifications/${mv.id}/decision?version=${mv.version}`).set(ops1).send({ decision: 'CONFIRM_RECEIVED', receivedAmount: 5_000, evidenceNote: 'Balance SMS shows +5000 at 10:02' }).then(created);
    expect(await txState(prisma, id)).toBe('REFUND_PENDING');
    const refund = await prisma.refund.findFirstOrThrow({ where: { transactionId: id } });
    expect(refund).toMatchObject({ kind: 'CANCELLATION', amount: 4_850, feeRetained: 150, requestedById: 'SYSTEM' });
    // No payout was ever attempted.
    expect(await prisma.providerOperation.count({ where: { transactionId: id } })).toBe(0);

    await http(app).post(`/admin/refunds/${refund.id}/approve`).set(finance).expect(201);
    await http(app).post(`/admin/refunds/${refund.id}/confirm-manual`).set(ops1).send({ evidenceNote: 'Returned 4850 FCFA airtime to the sender at 10:20' }).expect(201);
    expect(await txState(prisma, id)).toBe('REFUNDED');

    const journals = await prisma.ledgerJournal.findMany({ where: { transactionId: id }, include: { entries: { include: { account: true } } } });
    expect(journals.map((j) => j.kind).sort()).toEqual(['CANCELLATION_FEE', 'REFUND_COMPLETED', 'SOURCE_RECEIVED']);
    const payable = journals.flatMap((j) => j.entries).filter((e) => e.account.code === 'CUSTOMER_PAYABLE');
    expect(payable.reduce((s, e) => s + e.credit - e.debit, 0)).toBe(0); // nothing left owed
    const fee = journals.flatMap((j) => j.entries).find((e) => e.account.code === 'CANCELLATION_FEE_REVENUE');
    expect(fee?.credit).toBe(150);
    const n = await http(app).get('/notifications').set(c.auth).expect(200);
    expect(n.body.map((x: { kind: string }) => x.kind)).toEqual(expect.arrayContaining(['CANCEL_REFUND', 'REFUNDED']));
  });

  it('a completed transaction can’t be cancelled', async () => {
    const c = await customer(app);
    const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 5_000);
    const t = await accept(app, c, q.body.id).then(created);
    expect(t.body.state).toBe('COMPLETED');
    expect(t.body.cancellation.possible).toBe(false);
    const r = await http(app).post(`/transactions/${t.body.id}/cancel`).set(c.auth).send({}).expect(409);
    expect(r.body.code).toBe('TOO_LATE_TO_CANCEL');
  });
});

describe('sell credit: one rate for both networks', () => {
  it('drafts the same rate and limits on all four routes, approved by a second person', async () => {
    const drafts = await http(app).post('/admin/pricing/sell-credit').set(finance).send({ ratePercent: 82.5, minAmount: 1_000, maxAmount: 500_000, changeReason: 'New buy-back rate agreed' }).then(created);
    expect(drafts.body).toHaveLength(4);
    expect(drafts.body.every((r: { conversionRatePpm: number; minAmount: number; maxAmount: number; status: string }) => r.conversionRatePpm === 825_000 && r.minAmount === 1_000 && r.maxAmount === 500_000 && r.status === 'PENDING_APPROVAL')).toBe(true);
    const ids = drafts.body.map((r: { id: string }) => r.id);
    await http(app).post('/admin/pricing-rules/approve-many').set(finance).send({ ruleIds: ids }).expect(403); // maker can't approve
    await http(app).post('/admin/pricing-rules/approve-many').set(admin).send({ ruleIds: ids }).then(created);
    try {
      const view = await http(app).get('/admin/pricing/sell-credit').set(finance).expect(200);
      expect(view.body.every((v: { active: { ratePercent: number } }) => v.active.ratePercent === 82.5)).toBe(true);
      const c = await customer(app);
      const q = await quote(app, c, 'ORANGE_AIRTIME__MTN_MOMO', 10_000);
      expect(q.body).toMatchObject({ totalPayable: 10_000, conversionRate: 0.825 });
      expect((await quote(app, c, 'ORANGE_AIRTIME__MTN_MOMO', 999)).status).toBe(422);
    } finally {
      // Retiring the new versions puts the seed's rules back in force for the other test files.
      for (const id of ids) await http(app).post(`/admin/pricing-rules/${id}/retire`).set(finance).send({ reason: 'Test clean-up' }).then(created);
    }
  });
});

// ------------------------------------------------------------------ bundles

describe('bundles (forfaits)', () => {
  it('lists bundles with the wallets that can pay for them', async () => {
    const r = await http(app).get('/bundles?operator=MTN').expect(200);
    expect(r.body.bundles.length).toBeGreaterThan(0);
    expect(r.body.bundles.every((b: { operator: string }) => b.operator === 'MTN')).toBe(true);
    expect(r.body.paymentOptions.map((p: { serviceCode: string }) => p.serviceCode).sort()).toEqual(['MTN_MOMO__MTN_DATA', 'MTN_MOMO__ORANGE_DATA', 'ORANGE_MONEY__MTN_DATA', 'ORANGE_MONEY__ORANGE_DATA']);
    const week = await http(app).get('/bundles?validity=WEEK').expect(200);
    expect(week.body.bundles.every((b: { validity: string }) => b.validity === 'WEEK')).toBe(true);
  });

  it('buys a bundle at its own price, paid from either network', async () => {
    const c = await customer(app);
    const list = await http(app).get('/bundles?operator=MTN&validity=WEEK&category=DATA').expect(200);
    const b = list.body.bundles[0];
    const q = await http(app).post('/quotes').set(c.auth).send({ serviceCode: 'ORANGE_MONEY__MTN_DATA', bundleId: b.id, senderMsisdn: c.phone, recipientMsisdn: '677112233' }).then(created);
    expect(q.body).toMatchObject({ amount: b.price, totalPayable: b.price, platformFee: 0, expectedReceived: b.price, bundle: { id: b.id } });
    const t = await accept(app, c, q.body.id).then(created);
    expect(t.body.state).toBe('COMPLETED');
    expect(t.body.bundle.name).toBe(b.name);
    const n = await http(app).get('/notifications').set(c.auth).expect(200);
    expect(n.body[0].kind).toBe('BUNDLE_COMPLETED');
  });

  it('refuses a bundle of another network, an amount on a bundle route, and a changed price', async () => {
    const c = await customer(app);
    const orange = (await http(app).get('/bundles?operator=ORANGE').expect(200)).body.bundles[0];
    const wrong = await http(app).post('/quotes').set(c.auth).send({ serviceCode: 'MTN_MOMO__MTN_DATA', bundleId: orange.id, senderMsisdn: c.phone, recipientMsisdn: '677112233' });
    expect(wrong.body.code).toBe('BUNDLE_NETWORK_MISMATCH');
    const amount = await http(app).post('/quotes').set(c.auth).send({ serviceCode: 'MTN_MOMO__MTN_DATA', amount: 1_000, senderMsisdn: c.phone, recipientMsisdn: '677112233' });
    expect(amount.body.code).toBe('BUNDLE_REQUIRED');

    const q = await http(app).post('/quotes').set(c.auth).send({ serviceCode: 'MTN_MOMO__ORANGE_DATA', bundleId: orange.id, senderMsisdn: c.phone, recipientMsisdn: '699112233' }).then(created);
    await prisma.bundle.update({ where: { id: orange.id }, data: { price: orange.price + 50 } });
    try {
      const t = await accept(app, c, q.body.id);
      expect(t.status).toBe(409);
      expect(t.body.code).toBe('BUNDLE_PRICE_CHANGED');
    } finally {
      await prisma.bundle.update({ where: { id: orange.id }, data: { price: orange.price } });
    }
  });

  it('staff with the bundle permission add, edit and delete bundles; a sync keeps staff wording but follows the provider price', async () => {
    const body = { operator: 'MTN', productId: `AMC-${randomUUID().slice(0, 6)}`, name: 'Staff Night Pass 3 GB', category: 'DATA', validity: 'DAY', validityDays: 1, price: 300, dataMb: 3072, reason: 'Night promo from MTN' };
    await http(app).post('/admin/bundles').set(ops1).send(body).expect(403);
    const b = await http(app).post('/admin/bundles').set(admin).send(body).then(created);
    expect(b.body.source).toBe('STAFF');
    await http(app).patch(`/admin/bundles/${b.body.id}`).set(admin).send({ nameFr: 'Pass Nuit 3 Go', featured: true, reason: 'French name' }).expect(200);
    expect((await http(app).get('/bundles?operator=MTN').expect(200)).body.bundles.find((x: { id: string }) => x.id === b.body.id)).toMatchObject({ nameFr: 'Pass Nuit 3 Go', featured: true });
    await http(app).delete(`/admin/bundles/${b.body.id}`).set(admin).send({ reason: 'Promo over' }).expect(200);
    expect(await prisma.bundle.findUnique({ where: { id: b.body.id } })).toBeNull(); // never quoted: really deleted

    const provider = await prisma.bundle.findFirstOrThrow({ where: { providerCode: 'MOCK', operator: 'MTN', productId: 'SIM-MTN-D1G' } });
    await http(app).patch(`/admin/bundles/${provider.id}`).set(admin).send({ name: 'Daily 1 GB — staff wording', price: 999, reason: 'Rename' }).expect(200);
    const sync = await http(app).post('/admin/bundles/sync').set(admin).send({ operator: 'MTN' }).then(created);
    expect(sync.body[0]).toMatchObject({ operator: 'MTN', provider: 'MOCK', added: 0, priceChanged: 1 });
    const after = await prisma.bundle.findUniqueOrThrow({ where: { id: provider.id } });
    expect(after).toMatchObject({ name: 'Daily 1 GB — staff wording', price: 500, staffEdited: true });
  });
});

// ------------------------------------------------------------------ maintenance

describe('maintenance mode', () => {
  it('a whole-platform maintenance blocks quotes, shows a bilingual banner and tells customers', async () => {
    const c = await customer(app);
    await http(app).post('/admin/maintenance').set(ops1).send({ scope: 'ALL', messageEn: 'Planned upgrade of the platform', messageFr: 'Mise à jour planifiée de la plateforme', reason: 'Upgrade' }).expect(403);
    const w = await http(app)
      .post('/admin/maintenance')
      .set(admin)
      .send({ scope: 'ALL', messageEn: 'Planned upgrade of the platform', messageFr: 'Mise à jour planifiée de la plateforme', notifyLeadMinutes: 0, reason: 'Upgrade' })
      .then(created);
    try {
      const status = await http(app).get('/status').expect(200);
      expect(status.body.global).toMatchObject({ messageFr: 'Mise à jour planifiée de la plateforme' });
      const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 5_000);
      expect(q.status).toBe(503);
      expect(q.body).toMatchObject({ code: 'MAINTENANCE', details: { global: true } });
      expect((await http(app).get('/services').expect(200)).body).toHaveLength(0);
      const notices = await prisma.outboundMessage.count({ where: { purpose: 'MAINTENANCE', to: c.phone } });
      expect(notices).toBe(1);
      // Notified once only.
      await app.get(MaintenanceService).tick();
      expect(await prisma.outboundMessage.count({ where: { purpose: 'MAINTENANCE', to: c.phone } })).toBe(1);
    } finally {
      await http(app).post(`/admin/maintenance/${w.body.id}/end`).set(admin).send({ reason: 'Upgrade finished' }).then(created);
    }
    expect((await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 5_000)).status).toBe(201);
  });

  it('pausing one product leaves the others open', async () => {
    const c = await customer(app);
    const w = await http(app).post('/admin/maintenance').set(admin).send({ scope: 'SERVICES', productGroups: ['BUNDLES'], messageEn: 'Bundles are paused for an hour', messageFr: 'Les forfaits sont en pause une heure', notifyCustomers: false, reason: 'Provider window' }).then(created);
    try {
      const b = (await http(app).get('/bundles?operator=MTN').expect(200)).body;
      expect(b.bundles).toHaveLength(0);
      expect((await http(app).get('/status').expect(200)).body.pausedServiceCodes).toContain('MTN_MOMO__MTN_DATA');
      expect((await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 5_000)).status).toBe(201);
    } finally {
      await http(app).post(`/admin/maintenance/${w.body.id}/end`).set(admin).send({ reason: 'Provider window over' }).then(created);
    }
  });
});

// ------------------------------------------------------------------ messaging

describe('SMS and WhatsApp', () => {
  let gw: Awaited<ReturnType<typeof startFakeGateway>>;
  beforeAll(async () => {
    gw = await startFakeGateway();
  });
  afterAll(async () => gw.close());

  const configure = (channel: string, body: Record<string, unknown>) => http(app).put(`/admin/messaging/channels/${channel}`).set(admin).send({ reason: 'Gateway setup for tests', ...body });

  it('only people with the configure permission see or change gateways; secrets are never returned', async () => {
    await http(app).get('/admin/messaging/channels').set(ops1).expect(403);
    const r = await configure('SMS_ORANGE', { driver: 'ORANGE_SMS_API', settings: { senderName: 'AMICO' }, secrets: { clientId: 'cid', clientSecret: 'super-secret-value' } }).expect(200);
    expect(JSON.stringify(r.body)).not.toContain('super-secret-value');
    expect(r.body.secretsSet).toEqual({ clientId: true, clientSecret: true });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'messaging.channel.updated', entityId: 'SMS_ORANGE' }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(log)).not.toContain('super-secret-value');
    const live = await configure('WHATSAPP', { driver: 'WHATSAPP_CLOUD', live: true, settings: { phoneNumberId: '123456789012' } }).expect(422);
    expect(live.body.code).toBe('SECRETS_MISSING');
  });

  it('in test mode messages are logged as sent but nothing leaves the platform', async () => {
    const t = await http(app).post('/admin/messaging/channels/SMS_MTN/test').set(admin).send({ to: '677000111' }).then(created);
    expect(t.body).toMatchObject({ ok: true, live: false });
    expect(gw.calls).toHaveLength(0);
  });

  it('routes SMS by the recipient’s network and falls back to the other operator', async () => {
    await configure('SMS_ORANGE', { live: true, settings: { tokenUrl: `${gw.base}/oauth/v3/token`, apiBase: `${gw.base}/smsmessaging/v1`, senderName: 'AMICO' } }).expect(200);
    await configure('SMS_MTN', { driver: 'MTN_SMS_V3', live: true, enabled: true, settings: { tokenUrl: `${gw.base}/mtn/token?grant_type=client_credentials`, sendUrl: `${gw.base}/mtn/send`, senderAddress: 'AMICO' }, secrets: { clientId: 'm', clientSecret: 'n' } }).expect(200);

    const orange = await http(app).post('/admin/messaging/send').set(ops1).send({ to: '699123456', body: 'Bonjour from Orange route' }).then(created);
    expect(orange.body).toMatchObject({ status: 'SENT', channel: 'SMS_ORANGE', testMode: false, providerMessageId: 'or-123' });
    const sms = gw.calls.find((c) => c.path.startsWith('/smsmessaging/v1/outbound/') && c.body.includes('Bonjour from Orange route'))!;
    expect(sms.path).toBe('/smsmessaging/v1/outbound/tel%3A%2B2370000/requests');
    expect(JSON.parse(sms.body)).toEqual({ outboundSMSMessageRequest: { address: 'tel:+237699123456', senderAddress: 'tel:+2370000', senderName: 'AMICO', outboundSMSTextMessage: { message: 'Bonjour from Orange route' } } });
    expect(sms.headers.authorization).toBe('Bearer orange-token');
    const token = gw.calls.find((c) => c.path === '/oauth/v3/token')!;
    expect(token.headers.authorization).toBe(`Basic ${Buffer.from('cid:super-secret-value').toString('base64')}`);

    const mtn = await http(app).post('/admin/messaging/send').set(ops1).send({ to: '677123456', body: 'Hello from MTN route' }).then(created);
    expect(mtn.body).toMatchObject({ status: 'SENT', channel: 'SMS_MTN', providerMessageId: 'mtn-456' });
    const m = JSON.parse(gw.calls.find((c) => c.path === '/mtn/send' && c.body.includes('Hello from MTN route'))!.body);
    expect(m).toMatchObject({ senderAddress: 'AMICO', receiverAddress: ['237677123456'], message: 'Hello from MTN route', requestDeliveryReceipt: false });

    // Orange gateway down (5xx) for an Orange number: the MTN gateway carries it.
    const fb = await http(app).post('/admin/messaging/send').set(ops1).send({ to: '699123456', body: 'FAIL5XX on orange then mtn' }).then(created);
    // Our fake fails every gateway on this text, so the message is queued for retry, with both errors recorded.
    expect(fb.body.status).toBe('QUEUED');
    expect(fb.body.error).toMatch(/SMS_ORANGE: HTTP 503.*SMS_MTN: HTTP 503/);
    // A definitive refusal (4xx) is not retried.
    const refused = await http(app).post('/admin/messaging/send').set(ops1).send({ to: '699123456', body: 'FAIL4XX bad sender' }).then(created);
    expect(refused.body.status).toBe('FAILED');
  });

  it('switching a channel off reroutes to the other operator', async () => {
    await configure('SMS_ORANGE', { enabled: false }).expect(200);
    try {
      const r = await http(app).post('/admin/messaging/send').set(ops1).send({ to: '699555444', body: 'Rerouted via MTN' }).then(created);
      expect(r.body).toMatchObject({ status: 'SENT', channel: 'SMS_MTN' });
    } finally {
      await configure('SMS_ORANGE', { enabled: true }).expect(200);
    }
  });

  it('WhatsApp uses the approved template and falls back to SMS', async () => {
    await configure('WHATSAPP', { live: true, enabled: true, settings: { phoneNumberId: '123456789012', apiBase: gw.base, templateName: 'amico_notice' }, secrets: { accessToken: 'wa-token' } }).expect(200);
    const r = await http(app).post('/admin/messaging/send').set(ops1).send({ to: '677123456', body: 'Line one\nline two', channel: 'WHATSAPP_THEN_SMS' }).then(created);
    expect(r.body).toMatchObject({ status: 'SENT', channel: 'WHATSAPP', providerMessageId: 'wamid.789' });
    const call = gw.calls.find((c) => c.path === '/v21.0/123456789012/messages')!;
    expect(call.headers.authorization).toBe('Bearer wa-token');
    expect(JSON.parse(call.body)).toEqual({
      messaging_product: 'whatsapp', to: '237677123456', type: 'template',
      template: { name: 'amico_notice', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Line one line two' }] }] },
    });
  });

  it('an aggregator gateway can carry a network’s SMS', async () => {
    await configure('SMS_MTN', { driver: 'HTTP_GATEWAY', settings: { url: `${gw.base}/agg/send`, template: '{"to":"{{to}}","from":"{{sender}}","text":"{{message}}"}', sender: 'AMICO', authHeader: 'X-API-Key' }, secrets: { authValue: 'agg-key' } }).expect(200);
    const r = await http(app).post('/admin/messaging/send').set(ops1).send({ to: '677123456', body: 'Quote "test" & more' }).then(created);
    expect(r.body).toMatchObject({ status: 'SENT', channel: 'SMS_MTN', providerMessageId: 'agg-1' });
    const call = gw.calls.filter((c) => c.path === '/agg/send').pop()!;
    expect(call.headers['x-api-key']).toBe('agg-key');
    expect(JSON.parse(call.body)).toEqual({ to: '237677123456', from: 'AMICO', text: 'Quote "test" & more' });
  });

  it('transaction updates reach the customer by SMS in their language', async () => {
    const c = await customer(app, { network: 'MTN', locale: 'fr' });
    const q = await quote(app, c, 'MTN_MOMO__ORANGE_MONEY', 5_000);
    await accept(app, c, q.body.id).then(created);
    while ((await messaging.flush(500)) > 0);
    const msgs = await prisma.outboundMessage.findMany({ where: { to: c.phone, purpose: 'TRANSACTION' }, orderBy: { createdAt: 'asc' } });
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs.every((m) => m.locale === 'fr' && m.status === 'SENT')).toBe(true);
    expect(msgs.map((m) => m.body).join(' ')).toMatch(/livrés au/);
    const n = await http(app).get('/notifications').set(c.auth).expect(200);
    expect(n.body[0].title).toMatch(/terminé/i);
  });

  it('broadcasts go to the chosen audience in each person’s language', async () => {
    const fr = await customer(app, { locale: 'fr' });
    const en = await customer(app);
    const preview = await http(app).post('/admin/messaging/broadcasts/preview').set(ops1).send({ audience: { kind: 'NUMBERS', numbers: [fr.phone, en.phone] } }).then(created);
    expect(preview.body).toMatchObject({ recipients: 2, french: 1 });
    const b = await http(app).post('/admin/messaging/broadcasts').set(ops1).send({ audience: { kind: 'NUMBERS', numbers: [fr.phone, en.phone] }, channel: 'SMS', bodyEn: 'AMICO: new bundles are live', bodyFr: 'AMICO : nouveaux forfaits disponibles' }).then(created);
    const rows = await prisma.outboundMessage.findMany({ where: { broadcastId: b.body.id } });
    expect(rows.find((r) => r.to === fr.phone)!.body).toBe('AMICO : nouveaux forfaits disponibles');
    expect(rows.find((r) => r.to === en.phone)!.body).toBe('AMICO: new bundles are live');
    await http(app).post('/admin/messaging/broadcasts').set(support).send({ audience: { kind: 'ALL' }, bodyEn: 'xx xx', bodyFr: 'yy yy' }).expect(403);
  });

  afterAll(async () => {
    // Back to the seed's test mode for the rest of the run.
    for (const [ch, driver] of [['SMS_MTN', 'MTN_SMS_V3'], ['SMS_ORANGE', 'ORANGE_SMS_API'], ['WHATSAPP', 'WHATSAPP_CLOUD']]) {
      await prisma.messagingChannel.update({ where: { channel: ch as never }, data: { live: false, enabled: true, driver } });
    }
  });
});

// ------------------------------------------------------------------ monitoring, alerts, dashboard, audit

describe('monitoring and alerts', () => {
  it('reports every component and keeps a history', async () => {
    const r = await http(app).get('/admin/monitoring').set(support).expect(200);
    const comps = r.body.checks.map((c: { component: string }) => c.component);
    expect(comps).toEqual(expect.arrayContaining(['API', 'DATABASE', 'QUEUE', 'PROVIDER:MTN', 'PROVIDER:ORANGE', 'VERIFICATIONS', 'REVIEW', 'OUTBOX']));
    expect(r.body.checks.find((c: { component: string }) => c.component === 'DATABASE').status).toBe('UP');
    await http(app).post('/admin/monitoring/sample').set(support).then(created);
    expect(await prisma.healthSample.count({ where: { component: 'DATABASE' } })).toBeGreaterThan(0);
  });

  it('raises an alert to on-call staff once, and resolves it when things recover', async () => {
    const me = await http(app).get('/auth/staff/me').set(admin).expect(200);
    await prisma.staffUser.update({ where: { id: me.body.id }, data: { phone: '237677000999', alertChannels: ['SMS'] } });
    const mon = app.get(MonitoringService);
    await mon.raise('test:queue', 'CRITICAL', 'Job queue: down', 'Redis not reachable');
    await mon.raise('test:queue', 'CRITICAL', 'Job queue: down', 'Redis still not reachable');
    const sms = await prisma.outboundMessage.findMany({ where: { purpose: 'ALERT', to: '237677000999' } });
    expect(sms).toHaveLength(1); // not repeated within the repeat window
    expect(sms[0]!.body).toMatch(/^AMICO CRITICAL: Job queue: down/);
    const open = await http(app).get('/admin/alerts').set(support).expect(200);
    const a = open.body.find((x: { key: string }) => x.key === 'test:queue');
    await http(app).post(`/admin/alerts/${a.id}/acknowledge`).set(support).send({}).then(created);
    await http(app).post(`/admin/alerts/${a.id}/acknowledge`).set(admin).send({}).expect(409);
  });
});

describe('dashboard and audit', () => {
  it('each person gets the widgets their permissions allow, in their own order', async () => {
    const s = await http(app).get('/admin/dashboard').set(support).expect(200);
    expect(s.body.layout).not.toContain('VERIFICATION_QUEUE');
    expect(s.body.layout).toContain('KPIS_TODAY');
    const saved = await http(app).put('/admin/dashboard/layout').set(support).send({ widgets: ['SYSTEM_HEALTH', 'VERIFICATION_QUEUE', 'KPIS_TODAY'] }).expect(200);
    expect(saved.body.layout).toEqual(['SYSTEM_HEALTH', 'KPIS_TODAY']);
    expect(saved.body.data.KPIS_TODAY).toHaveProperty('transactions');
    const o = await http(app).get('/admin/dashboard').set(ops1).expect(200);
    expect(o.body.data.VERIFICATION_QUEUE).toHaveProperty('pending');
  });

  it('filters the audit log and exports it as CSV (and audits the export)', async () => {
    const r = await http(app).get('/admin/audit-logs?action=messaging.&actorType=STAFF&pageSize=5').set(finance).expect(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items.every((i: { action: string }) => i.action.startsWith('messaging.'))).toBe(true);
    expect(Object.values(r.body.actors).length).toBeGreaterThan(0);
    const csv = await http(app).get('/admin/audit-logs/export?action=role.').set(finance).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toContain('createdAt,actorType,actor,action');
    expect(csv.text).toContain('role.created');
    expect(await prisma.auditLog.count({ where: { action: 'audit.exported' } })).toBeGreaterThan(0);
    await http(app).get('/admin/audit-logs/export').set(ops1).expect(403);
  });
});

describe('offers showcase and customer profile', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

  it('staff publish offers with an image; customers see them in both languages', async () => {
    const bad = await http(app).post('/admin/offers').set(admin).send({ titleEn: 'Visit us', titleFr: 'Visitez-nous', ctaKind: 'URL', ctaTarget: 'http://not-https', reason: 'Promo' }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    const o = await http(app).post('/admin/offers').set(admin).send({ titleEn: 'Double data weekend', titleFr: 'Week-end data doublée', operator: 'ORANGE', ctaKind: 'SERVICE', ctaTarget: 'BUNDLES', sortOrder: -5, reason: 'Weekend promo' }).then(created);
    await http(app).post(`/admin/offers/${o.body.id}/image`).set(admin).attach('file', PNG, { filename: 'x.png', contentType: 'image/png' }).then(created);
    await http(app).post(`/admin/offers/${o.body.id}/image`).set(admin).attach('file', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' }).expect(415);
    const live = await http(app).get('/offers?operator=ORANGE').expect(200);
    expect(live.body[0]).toMatchObject({ titleFr: 'Week-end data doublée', ctaTarget: 'BUNDLES' });
    const img = await http(app).get(live.body[0].image).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect((await http(app).get('/offers?operator=MTN').expect(200)).body.find((x: { id: string }) => x.id === o.body.id)).toBeUndefined();
    await http(app).post('/admin/offers').set(support).send({ titleEn: 'xxx', titleFr: 'yyy', reason: 'Not allowed' }).expect(403);
  });

  it('customers choose their language and message preferences', async () => {
    const c = await customer(app);
    const r = await http(app).patch('/auth/customer/me').set(c.auth).send({ locale: 'fr', whatsappOptIn: true, smsOptIn: false }).expect(200);
    expect(r.body).toMatchObject({ locale: 'fr', whatsappOptIn: true, smsOptIn: false });
    // Opted out of announcements: not in an "everyone" broadcast.
    const people = await messaging.audience({ kind: 'ALL' });
    expect(people.find((p) => p.to === c.phone)).toBeUndefined();
    expect(newPhone('ORANGE')).toMatch(/^23769\d{7}$/);
  });
});
