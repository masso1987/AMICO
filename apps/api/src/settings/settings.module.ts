import { Body, Controller, Get, Global, Injectable, Module, Param, Patch, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { DEFAULT_OPERATOR_PREFIXES, type Permission } from '@amico/contracts';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { DomainError, Forbidden, NotFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';

const Prefix = z.string().regex(/^6\d{0,3}$/, 'A prefix is 1–4 digits starting with 6');

/**
 * Every setting: its schema (with defaults, so a missing row means "default"),
 * and the permission needed to change it.
 */
export const SETTINGS = {
  /** Customer cancellation (Switchn-style): free before payment; after payment the refund keeps this fee. */
  cancellation: {
    permission: 'SETTINGS_MANAGE',
    schema: z.object({
      feeBps: z.number().int().min(0).max(5_000).default(300),
      allowAfterPayment: z.boolean().default(true),
    }),
  },
  /** Failed deliveries: a 100% refund is requested automatically (a person still approves it). */
  refunds: {
    permission: 'SETTINGS_MANAGE',
    schema: z.object({ autoRequestOnFailure: z.boolean().default(true) }),
  },
  /** Which network a number belongs to. Used to route SMS and to label numbers. */
  numberPlan: {
    permission: 'MESSAGING_CONFIGURE',
    schema: z.object({
      MTN: z.array(Prefix).min(1).default(DEFAULT_OPERATOR_PREFIXES.MTN),
      ORANGE: z.array(Prefix).min(1).default(DEFAULT_OPERATOR_PREFIXES.ORANGE),
    }),
  },
  /** How customer messages are delivered. */
  messaging: {
    permission: 'MESSAGING_CONFIGURE',
    schema: z.object({
      /** Send transaction updates by SMS (WhatsApp first when the customer opted in and it is enabled). */
      transactionMessages: z.boolean().default(true),
      /** If the customer's own network gateway fails, try the other operator's. */
      fallbackToOtherOperator: z.boolean().default(true),
      /** Retries before a message is marked failed. */
      maxAttempts: z.number().int().min(1).max(5).default(3),
    }),
  },
  /** When the platform raises an alert to administrators. */
  alerts: {
    permission: 'SETTINGS_MANAGE',
    schema: z.object({
      enabled: z.boolean().default(true),
      verificationWaitMinutes: z.number().int().min(1).max(1_440).default(15),
      verificationQueueSize: z.number().int().min(1).max(1_000).default(10),
      failureRatePercent: z.number().int().min(1).max(100).default(30),
      slowProviderMs: z.number().int().min(500).max(120_000).default(8_000),
      underReviewCount: z.number().int().min(1).max(1_000).default(1),
      failedMessagesPerHour: z.number().int().min(1).max(10_000).default(20),
      /** Don't repeat the same alert by SMS/WhatsApp more often than this. */
      repeatAfterMinutes: z.number().int().min(5).max(1_440).default(60),
    }),
  },
} as const satisfies Record<string, { permission: Permission; schema: z.ZodTypeAny }>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const parsed = SETTINGS[key].schema.safeParse(row?.value ?? {});
    // A stored value that no longer validates (older version) falls back to defaults rather than breaking checkout.
    return (parsed.success ? parsed.data : SETTINGS[key].schema.parse({})) as SettingValue<K>;
  }

  async all() {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(SETTINGS) as SettingKey[]) out[key] = { value: await this.get(key), permission: SETTINGS[key].permission };
    return out;
  }

  async set<K extends SettingKey>(key: K, patch: unknown, actor: StaffPrincipal, reason: string, ip?: string): Promise<SettingValue<K>> {
    const def = SETTINGS[key];
    if (!actor.permissions.has(def.permission)) throw Forbidden('FORBIDDEN', `Missing permission: ${def.permission}`);
    const before = await this.get(key);
    const parsed = def.schema.safeParse({ ...(before as object), ...(patch as object) });
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', 'Invalid setting', 400, parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    const value = parsed.data as Prisma.InputJsonValue;
    await this.prisma.appSetting.upsert({ where: { key }, create: { key, value, updatedById: actor.id }, update: { value, updatedById: actor.id } });
    await this.audit.record({ actorType: 'STAFF', actorId: actor.id, action: 'setting.updated', entityType: 'AppSetting', entityId: key, before, after: { ...(parsed.data as object), reason }, ip });
    return parsed.data as SettingValue<K>;
  }
}

const PatchSchema = z.object({ value: z.record(z.unknown()), reason: z.string().trim().min(5).max(500) });

@ApiTags('admin / settings')
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @StaffAuth()
  all() {
    return this.settings.all();
  }

  @Patch(':key')
  @StaffAuth()
  update(@Param('key') key: string, @Body(new ZodPipe(PatchSchema)) body: z.infer<typeof PatchSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    if (!(key in SETTINGS)) throw NotFound('Setting');
    return this.settings.set(key as SettingKey, body.value, me, body.reason, req.ip);
  }
}

@ApiTags('status')
@Controller('public')
export class PublicConfigController {
  constructor(private readonly settings: SettingsService) {}

  /** What customer apps need to explain the rules (cancellation fee). */
  @Get('config')
  async config() {
    const c = await this.settings.get('cancellation');
    return { cancellation: { feeBps: c.feeBps, allowAfterPayment: c.allowAfterPayment }, refundOnFailurePercent: 100, languages: ['en', 'fr'], defaultLanguage: 'en' };
  }
}

@Global()
@Module({ controllers: [SettingsController, PublicConfigController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
