import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { operatorOfMsisdn } from '@amico/contracts';
import { ENV, type Env } from '../config/env';
import { decrypt, encrypt } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.module';
import { CHANNEL_DRIVERS, DEFAULT_DRIVER, DRIVERS, type SendResult } from './drivers';
import type { MessageChannel, MessagingChannel, OutboundMessage, Prisma } from '../generated/prisma/client';

export const CHANNELS: MessageChannel[] = ['SMS_MTN', 'SMS_ORANGE', 'WHATSAPP'];

/**
 * How a message should travel:
 *  SMS                — the recipient's own network, then the other operator if allowed;
 *  WHATSAPP_THEN_SMS  — WhatsApp, falling back to SMS;
 *  SMS_MTN | SMS_ORANGE | WHATSAPP — exactly that gateway (tests, staff choice).
 */
export type Requested = 'SMS' | 'WHATSAPP_THEN_SMS' | MessageChannel;

export interface QueueInput {
  to: string;
  body: string;
  locale?: string;
  purpose: 'TRANSACTION' | 'BROADCAST' | 'ALERT' | 'MAINTENANCE' | 'TEST' | 'DIRECT';
  requested: Requested;
  customerId?: string | null;
  staffId?: string | null;
  broadcastId?: string | null;
}

const LEASE_MS = 5 * 60_000;
const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** (attempt - 1), 30 * 60_000);

type Db = Tx | PrismaService;

@Injectable()
export class MessagingService {
  private readonly log = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------------------------------------------------------------- outbox

  /** Writes the message to the outbox. Pass the caller's transaction so it commits (or not) with its cause. */
  queue(db: Db, m: QueueInput): Promise<OutboundMessage> {
    return db.outboundMessage.create({
      data: {
        to: m.to,
        body: m.body,
        locale: m.locale ?? 'en',
        purpose: m.purpose,
        requested: m.requested,
        customerId: m.customerId ?? null,
        staffId: m.staffId ?? null,
        broadcastId: m.broadcastId ?? null,
      },
    });
  }

  /**
   * Sends due messages. Rows are claimed with SKIP LOCKED and a lease, so several
   * workers never send the same message; a worker that dies mid-send releases it when
   * the lease runs out.
   */
  async flush(limit = 50): Promise<number> {
    await this.prisma.$executeRaw`UPDATE "OutboundMessage" SET status = 'QUEUED' WHERE status = 'SENDING' AND "nextAttemptAt" <= now()`;
    const claimed = await this.prisma.$queryRaw<OutboundMessage[]>`
      UPDATE "OutboundMessage" SET status = 'SENDING', attempts = attempts + 1, "nextAttemptAt" = now() + ${`${LEASE_MS} milliseconds`}::interval
      WHERE id IN (
        SELECT id FROM "OutboundMessage" WHERE status = 'QUEUED' AND "nextAttemptAt" <= now()
        ORDER BY "nextAttemptAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
    return this.deliverClaimed(claimed);
  }

  /** Sends one specific queued message now (a staff "send"), without waiting behind the queue. */
  async sendNow(id: string): Promise<void> {
    const claimed = await this.prisma.$queryRaw<OutboundMessage[]>`
      UPDATE "OutboundMessage" SET status = 'SENDING', attempts = attempts + 1, "nextAttemptAt" = now() + ${`${LEASE_MS} milliseconds`}::interval
      WHERE id IN (SELECT id FROM "OutboundMessage" WHERE id = ${id} AND status = 'QUEUED' FOR UPDATE SKIP LOCKED)
      RETURNING *`;
    await this.deliverClaimed(claimed);
  }

  private async deliverClaimed(claimed: OutboundMessage[]): Promise<number> {
    if (!claimed.length) return 0;
    const channels = await this.loadChannels();
    const [plan, prefs] = await Promise.all([this.settings.get('numberPlan'), this.settings.get('messaging')]);
    for (const msg of claimed) {
      try {
        await this.deliver(msg, channels, plan, prefs);
      } catch (e) {
        this.log.error(`Message ${msg.id} crashed: ${(e as Error).message}`);
        await this.prisma.outboundMessage.update({ where: { id: msg.id }, data: { status: 'QUEUED', error: (e as Error).message.slice(0, 500), nextAttemptAt: new Date(Date.now() + backoffMs(msg.attempts)) } });
      }
    }
    return claimed.length;
  }

  candidates(msg: Pick<OutboundMessage, 'to' | 'requested'>, plan: Record<'MTN' | 'ORANGE', string[]>, fallback: boolean): MessageChannel[] {
    const sms = (): MessageChannel[] => {
      const op = operatorOfMsisdn(msg.to, plan);
      if (op === 'MTN') return fallback ? ['SMS_MTN', 'SMS_ORANGE'] : ['SMS_MTN'];
      if (op === 'ORANGE') return fallback ? ['SMS_ORANGE', 'SMS_MTN'] : ['SMS_ORANGE'];
      return ['SMS_MTN', 'SMS_ORANGE'];
    };
    switch (msg.requested) {
      case 'SMS':
        return sms();
      case 'WHATSAPP_THEN_SMS':
        return ['WHATSAPP', ...sms()];
      default:
        return CHANNELS.includes(msg.requested as MessageChannel) ? [msg.requested as MessageChannel] : sms();
    }
  }

  private async deliver(
    msg: OutboundMessage,
    channels: Map<MessageChannel, MessagingChannel>,
    plan: Record<'MTN' | 'ORANGE', string[]>,
    prefs: { fallbackToOtherOperator: boolean; maxAttempts: number },
  ) {
    const route = this.candidates(msg, plan, prefs.fallbackToOtherOperator).filter((c) => channels.get(c)?.enabled);
    if (!route.length) {
      await this.prisma.outboundMessage.update({ where: { id: msg.id }, data: { status: 'SKIPPED', error: 'No gateway is switched on for this number' } });
      return;
    }
    const errors: string[] = [];
    let retryable = false;
    for (const ch of route) {
      const cfg = channels.get(ch)!;
      if (!cfg.live) {
        await this.prisma.outboundMessage.update({ where: { id: msg.id }, data: { status: 'SENT', channel: ch, testMode: true, sentAt: new Date(), error: null } });
        return;
      }
      const result = await this.callDriver(cfg, msg.to, msg.body, msg.locale);
      if (result.ok) {
        await this.prisma.outboundMessage.update({ where: { id: msg.id }, data: { status: 'SENT', channel: ch, testMode: false, sentAt: new Date(), providerMessageId: result.providerMessageId ?? null, error: errors.length ? errors.join(' | ').slice(0, 1000) : null } });
        return;
      }
      errors.push(`${ch}: ${result.error}`);
      retryable ||= result.retryable !== false;
    }
    const giveUp = !retryable || msg.attempts >= prefs.maxAttempts;
    await this.prisma.outboundMessage.update({
      where: { id: msg.id },
      data: giveUp
        ? { status: 'FAILED', error: errors.join(' | ').slice(0, 1000) }
        : { status: 'QUEUED', error: errors.join(' | ').slice(0, 1000), nextAttemptAt: new Date(Date.now() + backoffMs(msg.attempts)) },
    });
  }

  private async callDriver(cfg: MessagingChannel, to: string, text: string, locale: string): Promise<SendResult> {
    const driver = DRIVERS[cfg.driver];
    if (!driver) return { ok: false, retryable: false, error: `Unknown driver ${cfg.driver}` };
    try {
      return await driver.send(to, text, { settings: cfg.settings as Record<string, unknown>, secrets: this.secrets(cfg), locale, cacheKey: `${cfg.channel}:${cfg.updatedAt.getTime()}` });
    } catch (e) {
      return { ok: false, retryable: true, error: (e as Error).message.slice(0, 300) };
    }
  }

  // ---------------------------------------------------------------- channel configuration

  private secrets(cfg: MessagingChannel): Record<string, string> {
    if (!cfg.secretsEncrypted) return {};
    return JSON.parse(decrypt(cfg.secretsEncrypted, this.env.APP_ENCRYPTION_KEY)) as Record<string, string>;
  }

  private async loadChannels(): Promise<Map<MessageChannel, MessagingChannel>> {
    const rows = await this.prisma.messagingChannel.findMany();
    return new Map(rows.map((r) => [r.channel, r]));
  }

  /** Admin view. Secrets are reported only as "set / not set". */
  async channels() {
    const rows = await this.loadChannels();
    return CHANNELS.map((channel) => {
      const r = rows.get(channel);
      const driverKind = r?.driver ?? DEFAULT_DRIVER[channel];
      const secrets = r ? this.secrets(r) : {};
      return {
        channel,
        enabled: r?.enabled ?? false,
        live: r?.live ?? false,
        driver: driverKind,
        drivers: CHANNEL_DRIVERS[channel].map((k) => ({ kind: k, label: DRIVERS[k]!.label, secretFields: DRIVERS[k]!.secretFields })),
        settings: r?.settings ?? {},
        secretsSet: Object.fromEntries(DRIVERS[driverKind]!.secretFields.map((f) => [f, Boolean(secrets[f])])),
        lastTestAt: r?.lastTestAt ?? null,
        lastTestOk: r?.lastTestOk ?? null,
        lastTestError: r?.lastTestError ?? null,
        updatedAt: r?.updatedAt ?? null,
      };
    });
  }

  async configure(
    channel: MessageChannel,
    input: { enabled?: boolean; live?: boolean; driver?: string; settings?: Record<string, unknown>; secrets?: Record<string, string>; reason: string },
    actorId: string,
    ip?: string,
  ) {
    if (!CHANNELS.includes(channel)) throw NotFound('Channel');
    const existing = await this.prisma.messagingChannel.findUnique({ where: { channel } });
    const driverKind = input.driver ?? existing?.driver ?? DEFAULT_DRIVER[channel];
    if (!(CHANNEL_DRIVERS[channel] as readonly string[]).includes(driverKind)) throw new DomainError('INVALID_DRIVER', `${driverKind} can't be used for ${channel}`);
    const driver = DRIVERS[driverKind]!;
    const changedDriver = existing && existing.driver !== driverKind;
    const parsed = driver.settingsSchema.safeParse({ ...(changedDriver ? {} : ((existing?.settings as object) ?? {})), ...(input.settings ?? {}) });
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', 'Invalid gateway settings', HttpStatus.BAD_REQUEST, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    // Secrets merge: an empty field keeps the stored value; switching driver starts clean.
    const secrets = { ...(existing && !changedDriver ? this.secrets(existing) : {}) };
    for (const [k, v] of Object.entries(input.secrets ?? {})) {
      if (!driver.secretFields.includes(k)) throw new DomainError('UNKNOWN_SECRET', `${driverKind} has no secret field ${k}`);
      if (v.trim()) secrets[k] = v.trim();
    }
    const live = input.live ?? existing?.live ?? false;
    if (live) {
      const missing = driver.secretFields.filter((f) => !secrets[f]);
      if (missing.length) throw new DomainError('SECRETS_MISSING', `Enter ${missing.join(', ')} before switching to live`);
    }
    const data = {
      enabled: input.enabled ?? existing?.enabled ?? false,
      live,
      driver: driverKind,
      settings: parsed.data as Prisma.InputJsonValue,
      secretsEncrypted: Object.keys(secrets).length ? encrypt(JSON.stringify(secrets), this.env.APP_ENCRYPTION_KEY) : null,
      updatedById: actorId,
    };
    const after = await this.prisma.messagingChannel.upsert({ where: { channel }, create: { channel, ...data }, update: data });
    await this.audit.record({
      actorType: 'STAFF', actorId, action: 'messaging.channel.updated', entityType: 'MessagingChannel', entityId: channel, ip,
      before: existing ? { enabled: existing.enabled, live: existing.live, driver: existing.driver, settings: existing.settings } : null,
      // Secret values never reach the audit log: only which fields changed.
      after: { enabled: after.enabled, live: after.live, driver: after.driver, settings: after.settings, secretsChanged: Object.keys(input.secrets ?? {}).filter((k) => input.secrets![k]!.trim()), reason: input.reason },
    });
    return (await this.channels()).find((c) => c.channel === channel)!;
  }

  /** Sends one message through exactly this gateway now, and records the result on the channel. */
  async test(channel: MessageChannel, to: string, actorId: string, ip?: string) {
    const cfg = await this.prisma.messagingChannel.findUnique({ where: { channel } });
    if (!cfg) throw new DomainError('NOT_CONFIGURED', 'Save the gateway settings first');
    const body = `AMICO test message / message de test (${channel}) ${new Date().toISOString().slice(11, 16)} UTC`;
    let result: SendResult;
    if (!cfg.live) result = { ok: true, providerMessageId: null };
    else result = await this.callDriver(cfg, to, body, 'en');
    await this.prisma.$transaction(async (tx) => {
      await tx.outboundMessage.create({
        data: {
          to, body, purpose: 'TEST', requested: channel, channel, staffId: actorId, attempts: 1, testMode: !cfg.live,
          status: result.ok ? 'SENT' : 'FAILED', sentAt: result.ok ? new Date() : null, error: result.error ?? null, providerMessageId: result.providerMessageId ?? null,
        },
      });
      await tx.messagingChannel.update({ where: { channel }, data: { lastTestAt: new Date(), lastTestOk: result.ok, lastTestError: result.error?.slice(0, 500) ?? null } });
      await this.audit.record({ actorType: 'STAFF', actorId, action: 'messaging.channel.test', entityType: 'MessagingChannel', entityId: channel, after: { ok: result.ok, live: cfg.live, error: result.error ?? null }, ip }, tx);
    });
    return { ok: result.ok, live: cfg.live, error: result.error ?? null, note: cfg.live ? null : 'Test mode: nothing was sent. Switch the gateway to live to send real messages.' };
  }

  // ---------------------------------------------------------------- staff sends

  async sendDirect(input: { to: string; body: string; requested: Requested }, actorId: string, ip?: string) {
    const msg = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { phone: input.to }, select: { id: true, locale: true } });
      const m = await this.queue(tx, { to: input.to, body: input.body, purpose: 'DIRECT', requested: input.requested, staffId: actorId, customerId: customer?.id ?? null, locale: customer?.locale ?? 'en' });
      await this.audit.record({ actorType: 'STAFF', actorId, action: 'messaging.sent', entityType: 'OutboundMessage', entityId: m.id, after: { to: input.to, requested: input.requested, length: input.body.length }, ip }, tx);
      return m;
    });
    await this.sendNow(msg.id);
    return this.prisma.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } });
  }

  /** Who a broadcast reaches. Announcements respect the customer's SMS opt-out; explicit numbers are the sender's responsibility. */
  async audience(a: Audience): Promise<Array<{ to: string; locale: string; customerId: string | null; whatsapp: boolean }>> {
    if (a.kind === 'NUMBERS') {
      const customers = await this.prisma.customer.findMany({ where: { phone: { in: a.numbers } }, select: { id: true, phone: true, locale: true, whatsappOptIn: true } });
      const byPhone = new Map(customers.map((c) => [c.phone, c]));
      return [...new Set(a.numbers)].map((n) => ({ to: n, locale: byPhone.get(n)?.locale ?? 'en', customerId: byPhone.get(n)?.id ?? null, whatsapp: byPhone.get(n)?.whatsappOptIn ?? false }));
    }
    const since = a.kind === 'ACTIVE_30D' ? new Date(Date.now() - 30 * 86_400_000) : null;
    const where: Prisma.CustomerWhereInput = {
      active: true,
      smsOptIn: true,
      ...(since ? { transactions: { some: { createdAt: { gte: since } } } } : {}),
      ...(a.kind === 'OPEN_TRANSACTIONS' ? { transactions: { some: { state: { notIn: ['COMPLETED', 'REJECTED', 'REFUNDED'] } } } } : {}),
      ...(a.kind === 'SERVICE_USERS' ? { transactions: { some: { createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) }, service: { code: { in: a.serviceCodes } } } } } : {}),
    };
    const rows = await this.prisma.customer.findMany({ where, select: { id: true, phone: true, locale: true, whatsappOptIn: true }, take: MAX_BROADCAST + 1 });
    return rows.map((c) => ({ to: c.phone, locale: c.locale, customerId: c.id, whatsapp: c.whatsappOptIn }));
  }

  async broadcast(input: { audience: Audience; channel: 'AUTO' | 'SMS' | 'WHATSAPP'; bodyEn: string; bodyFr: string; purpose?: 'BROADCAST' | 'MAINTENANCE' }, actorId: string | null, ip?: string) {
    const people = await this.audience(input.audience);
    if (people.length > MAX_BROADCAST) throw new DomainError('AUDIENCE_TOO_LARGE', `At most ${MAX_BROADCAST} recipients per broadcast`);
    const b = await this.prisma.$transaction(async (tx) => {
      const b = await tx.broadcast.create({
        data: { audience: input.audience as unknown as Prisma.InputJsonValue, requested: input.channel, bodyEn: input.bodyEn, bodyFr: input.bodyFr, recipients: people.length, createdById: actorId ?? 'SYSTEM' },
      });
      await tx.outboundMessage.createMany({
        data: people.map((p) => ({
          to: p.to,
          body: p.locale === 'fr' ? input.bodyFr : input.bodyEn,
          locale: p.locale,
          purpose: input.purpose ?? 'BROADCAST',
          requested: input.channel === 'WHATSAPP' ? 'WHATSAPP' : input.channel === 'AUTO' && p.whatsapp ? 'WHATSAPP_THEN_SMS' : 'SMS',
          customerId: p.customerId,
          staffId: actorId,
          broadcastId: b.id,
        })),
      });
      await this.audit.record({ actorType: actorId ? 'STAFF' : 'SYSTEM', actorId, action: 'messaging.broadcast', entityType: 'Broadcast', entityId: b.id, after: { audience: input.audience, channel: input.channel, recipients: people.length, bodyEn: input.bodyEn, bodyFr: input.bodyFr }, ip }, tx);
      return b;
    });
    return b;
  }

  async messageLog(q: { status?: string; channel?: string; purpose?: string; to?: string; page: number; pageSize: number }) {
    const where: Prisma.OutboundMessageWhereInput = {
      ...(q.status ? { status: q.status as OutboundMessage['status'] } : {}),
      ...(q.channel ? { channel: q.channel as MessageChannel } : {}),
      ...(q.purpose ? { purpose: q.purpose } : {}),
      ...(q.to ? { to: { contains: q.to.replace(/\D/g, '') } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.outboundMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.outboundMessage.count({ where }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items };
  }

  /** Today's counts per channel and status (dashboard + monitoring). */
  async stats(since = startOfDay()) {
    const rows = await this.prisma.outboundMessage.groupBy({ by: ['channel', 'status', 'testMode'], where: { createdAt: { gte: since } }, _count: { _all: true } });
    const out: Record<string, { sent: number; test: number; failed: number; queued: number; skipped: number }> = {};
    for (const r of rows) {
      const k = r.channel ?? 'UNROUTED';
      out[k] ??= { sent: 0, test: 0, failed: 0, queued: 0, skipped: 0 };
      const n = r._count._all;
      if (r.status === 'SENT') out[k][r.testMode ? 'test' : 'sent'] += n;
      else if (r.status === 'FAILED') out[k].failed += n;
      else if (r.status === 'SKIPPED') out[k].skipped += n;
      else out[k].queued += n;
    }
    return out;
  }
}

export const MAX_BROADCAST = 20_000;

export const AudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }),
  z.object({ kind: z.literal('ACTIVE_30D') }),
  z.object({ kind: z.literal('OPEN_TRANSACTIONS') }),
  /** Customers who used these services in the last 90 days (maintenance notices). */
  z.object({ kind: z.literal('SERVICE_USERS'), serviceCodes: z.array(z.string().min(3)).min(1).max(50) }),
  z.object({ kind: z.literal('NUMBERS'), numbers: z.array(z.string().regex(/^2376\d{8}$/)).min(1).max(1_000) }),
]);
export type Audience = z.infer<typeof AudienceSchema>;

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
