import { Body, Controller, Get, HttpStatus, Injectable, Logger, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ProductGroup, ROUTE_DEFINITIONS, routesInGroup } from '@amico/contracts';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { Conflict, DomainError, NotFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MessagingService } from '../messaging/messaging.service';
import type { MaintenanceWindow } from '../generated/prisma/client';

const TZ = 'Africa/Douala';
const ALL_CODES = new Set(ROUTE_DEFINITIONS.map((r) => r.code));
const GROUPS = Object.values(ProductGroup) as [ProductGroup, ...ProductGroup[]];

const CreateSchema = z
  .object({
    /** ALL = the whole platform; otherwise the listed product groups and/or service codes. */
    scope: z.enum(['ALL', 'SERVICES']),
    productGroups: z.array(z.enum(GROUPS)).max(GROUPS.length).default([]),
    serviceCodes: z.array(z.string()).max(ALL_CODES.size).default([]),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    messageEn: z.string().trim().min(10).max(300),
    messageFr: z.string().trim().min(10).max(300),
    notifyCustomers: z.boolean().default(true),
    notifyLeadMinutes: z.number().int().min(0).max(7 * 24 * 60).default(60),
    reason: z.string().trim().min(5).max(500),
  })
  .refine((b) => b.scope === 'ALL' || b.productGroups.length + b.serviceCodes.length > 0, { message: 'Pick at least one service', path: ['serviceCodes'] })
  .refine((b) => b.serviceCodes.every((c) => ALL_CODES.has(c)), { message: 'Unknown service code', path: ['serviceCodes'] })
  .refine((b) => !b.endsAt || !b.startsAt || b.endsAt > b.startsAt, { message: 'The end must be after the start', path: ['endsAt'] });
const EndSchema = z.object({ reason: z.string().trim().min(5).max(500) });

export function formatWindow(w: Pick<MaintenanceWindow, 'startsAt' | 'endsAt'>, locale: 'en' | 'fr'): string {
  const f = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const start = f.format(w.startsAt);
  if (!w.endsAt) return locale === 'fr' ? `à partir du ${start}` : `from ${start}`;
  return locale === 'fr' ? `du ${start} au ${f.format(w.endsAt)}` : `from ${start} to ${f.format(w.endsAt)}`;
}

@Injectable()
export class MaintenanceService {
  private readonly log = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
  ) {}

  private live(now = new Date()) {
    return this.prisma.maintenanceWindow.findMany({
      where: { endedAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** The window that pauses this service now, if any. Empty serviceCodes = everything. */
  async blocking(serviceCode: string, now = new Date()): Promise<MaintenanceWindow | null> {
    return (await this.live(now)).find((w) => w.serviceCodes.length === 0 || w.serviceCodes.includes(serviceCode)) ?? null;
  }

  async assertOpen(serviceCode: string) {
    const w = await this.blocking(serviceCode);
    if (w) {
      throw new DomainError('MAINTENANCE', w.messageEn, HttpStatus.SERVICE_UNAVAILABLE, { messageEn: w.messageEn, messageFr: w.messageFr, endsAt: w.endsAt, global: w.serviceCodes.length === 0 });
    }
  }

  /** What the customer apps show: the banner, paused services and upcoming windows. */
  async status(now = new Date()) {
    const [live, upcoming] = await Promise.all([
      this.live(now),
      this.prisma.maintenanceWindow.findMany({ where: { endedAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) } }, orderBy: { startsAt: 'asc' }, take: 5 }),
    ]);
    const view = (w: MaintenanceWindow) => ({ id: w.id, global: w.serviceCodes.length === 0, serviceCodes: w.serviceCodes, messageEn: w.messageEn, messageFr: w.messageFr, startsAt: w.startsAt, endsAt: w.endsAt });
    const global = live.find((w) => w.serviceCodes.length === 0);
    return {
      global: global ? view(global) : null,
      paused: live.filter((w) => w.serviceCodes.length > 0).map(view),
      pausedServiceCodes: global ? [...ALL_CODES] : [...new Set(live.flatMap((w) => w.serviceCodes))],
      upcoming: upcoming.map(view),
    };
  }

  list() {
    return this.prisma.maintenanceWindow.findMany({ orderBy: { startsAt: 'desc' }, take: 100 });
  }

  async create(input: z.infer<typeof CreateSchema>, actorId: string, ip?: string) {
    const codes = input.scope === 'ALL' ? [] : [...new Set([...input.productGroups.flatMap(routesInGroup), ...input.serviceCodes])].sort();
    const startsAt = input.startsAt ?? new Date();
    const w = await this.prisma.maintenanceWindow.create({
      data: {
        serviceCodes: codes, startsAt, endsAt: input.endsAt ?? null, messageEn: input.messageEn, messageFr: input.messageFr,
        notifyCustomers: input.notifyCustomers, notifyLeadMinutes: input.notifyLeadMinutes, createdById: actorId,
      },
    });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'maintenance.created', entityType: 'MaintenanceWindow', entityId: w.id, after: { ...w, reason: input.reason }, ip });
    await this.tick();
    return w;
  }

  async end(id: string, reason: string, actorId: string, ip?: string) {
    const w = await this.prisma.maintenanceWindow.findUnique({ where: { id } });
    if (!w) throw NotFound('Maintenance window');
    if (w.endedAt) throw Conflict('ALREADY_ENDED', 'This maintenance has already ended');
    const after = await this.prisma.maintenanceWindow.update({ where: { id }, data: { endedAt: new Date(), endedById: actorId } });
    await this.audit.record({ actorType: 'STAFF', actorId, action: w.startsAt > new Date() ? 'maintenance.cancelled' : 'maintenance.ended', entityType: 'MaintenanceWindow', entityId: id, before: w, after: { ...after, reason }, ip });
    return after;
  }

  /**
   * Runs every minute in the worker: tells customers about maintenance before it starts.
   * Each window notifies once (customersNotifiedAt is set in the same transaction as the broadcast).
   */
  async tick(now = new Date()) {
    const due = await this.prisma.maintenanceWindow.findMany({
      where: { notifyCustomers: true, customersNotifiedAt: null, endedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    });
    for (const w of due) {
      if (w.startsAt.getTime() - w.notifyLeadMinutes * 60_000 > now.getTime()) continue;
      const claimed = await this.prisma.maintenanceWindow.updateMany({ where: { id: w.id, customersNotifiedAt: null }, data: { customersNotifiedAt: now } });
      if (claimed.count !== 1) continue;
      const audience = w.serviceCodes.length === 0 ? ({ kind: 'ALL' } as const) : ({ kind: 'SERVICE_USERS', serviceCodes: w.serviceCodes } as const);
      try {
        await this.messaging.broadcast(
          {
            audience,
            channel: 'AUTO',
            purpose: 'MAINTENANCE',
            bodyEn: `AMICO: ${w.messageEn} (${formatWindow(w, 'en')})`.slice(0, 640),
            bodyFr: `AMICO : ${w.messageFr} (${formatWindow(w, 'fr')})`.slice(0, 640),
          },
          null,
        );
      } catch (e) {
        this.log.error(`Maintenance notice ${w.id} failed: ${(e as Error).message}`);
        await this.prisma.maintenanceWindow.update({ where: { id: w.id }, data: { customersNotifiedAt: null } });
      }
    }
  }
}

@ApiTags('status')
@Controller('status')
export class StatusController {
  constructor(private readonly maintenance: MaintenanceService) {}

  /** Public: maintenance banner and paused services, for every customer app. */
  @Get()
  status() {
    return this.maintenance.status();
  }
}

@ApiTags('admin / maintenance')
@Controller('admin/maintenance')
export class MaintenanceAdminController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @StaffAuth('MONITORING_READ')
  async list() {
    return { status: await this.maintenance.status(), windows: await this.maintenance.list() };
  }

  @Post()
  @StaffAuth('MAINTENANCE_MANAGE')
  create(@Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.maintenance.create(body, me.id, req.ip);
  }

  @Post(':id/end')
  @StaffAuth('MAINTENANCE_MANAGE')
  end(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(EndSchema)) body: z.infer<typeof EndSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.maintenance.end(id, body.reason, me.id, req.ip);
  }
}

@Module({ controllers: [StatusController, MaintenanceAdminController], providers: [MaintenanceService], exports: [MaintenanceService] })
export class MaintenanceModule {}
