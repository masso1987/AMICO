import { Body, Controller, Get, Injectable, Logger, Module, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { Conflict, NotFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.service';
import { SettingsService } from '../settings/settings.module';
import { MessagingService } from '../messaging/messaging.service';
import { permissionsFor } from '../auth/auth.guard';
import type { AlertSeverity, HealthStatus, Prisma } from '../generated/prisma/client';

export interface Check {
  component: string;
  label: string;
  status: HealthStatus;
  latencyMs?: number | null;
  summary: string;
  detail?: Record<string, unknown>;
}

const STARTED = Date.now();
const HOUR = 3_600_000;

/**
 * Samples every part of the platform once a minute, keeps 14 days of history, and
 * raises alerts to administrators (dashboard + SMS / WhatsApp) when something degrades.
 */
@Injectable()
export class MonitoringService {
  private readonly log = new Logger(MonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
  ) {}

  async checks(now = new Date()): Promise<Check[]> {
    const t = await this.settings.get('alerts');
    const out: Check[] = [];

    const mem = process.memoryUsage();
    out.push({ component: 'API', label: 'API server', status: 'UP', summary: `Up ${Math.round((Date.now() - STARTED) / 60_000)} min`, detail: { rssMb: Math.round(mem.rss / 1e6), heapMb: Math.round(mem.heapUsed / 1e6), node: process.version } });

    const dbStart = Date.now();
    const dbOk = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const dbMs = Date.now() - dbStart;
    out.push({ component: 'DATABASE', label: 'Database', status: !dbOk ? 'DOWN' : dbMs > 500 ? 'DEGRADED' : 'UP', latencyMs: dbMs, summary: dbOk ? `${dbMs} ms` : 'Not reachable' });
    if (!dbOk) return out;

    const qStart = Date.now();
    const qOk = await this.jobs.ping().catch(() => false);
    const counts = qOk ? await this.jobs.counts().catch(() => null) : null;
    out.push({
      component: 'QUEUE', label: 'Job queue', latencyMs: Date.now() - qStart,
      status: !qOk ? 'DOWN' : counts && counts.waiting > 200 ? 'DEGRADED' : 'UP',
      summary: !qOk ? 'Redis not reachable' : counts ? `${counts.waiting} waiting · ${counts.active} running · ${counts.delayed} scheduled` : 'Inline mode',
      detail: counts ?? undefined,
    });

    const since = new Date(now.getTime() - 15 * 60_000);
    for (const operator of ['MTN', 'ORANGE'] as const) {
      const ops = await this.prisma.providerOperation.findMany({ where: { operator, createdAt: { gte: since } }, select: { status: true, durationMs: true } });
      const failed = ops.filter((o) => o.status === 'FAILED').length;
      const unknown = ops.filter((o) => o.status === 'UNKNOWN').length;
      const timed = ops.filter((o) => o.durationMs != null);
      const avg = timed.length ? Math.round(timed.reduce((s, o) => s + o.durationMs!, 0) / timed.length) : null;
      const pct = ops.length ? Math.round(((failed + unknown) / ops.length) * 100) : 0;
      const status: HealthStatus = ops.length >= 5 && pct >= 80 ? 'DOWN' : (ops.length >= 3 && pct >= t.failureRatePercent) || (avg !== null && avg > t.slowProviderMs) ? 'DEGRADED' : 'UP';
      out.push({
        component: `PROVIDER:${operator}`, label: operator === 'MTN' ? 'MTN Mobile Money' : 'Orange Money', status, latencyMs: avg,
        summary: ops.length ? `${ops.length} calls in 15 min · ${pct}% failed or unclear${avg !== null ? ` · ${avg} ms average` : ''}` : 'No traffic in the last 15 min',
        detail: { calls: ops.length, failed, unknown },
      });
    }

    const channels = await this.prisma.messagingChannel.findMany({ where: { enabled: true } });
    for (const c of channels) {
      const rows = await this.prisma.outboundMessage.groupBy({ by: ['status'], where: { channel: c.channel, createdAt: { gte: new Date(now.getTime() - HOUR) } }, _count: { _all: true } });
      const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
      const sent = n('SENT');
      const failed = n('FAILED');
      out.push({
        component: `MESSAGING:${c.channel}`, label: { SMS_MTN: 'SMS via MTN', SMS_ORANGE: 'SMS via Orange', WHATSAPP: 'WhatsApp' }[c.channel],
        status: failed >= t.failedMessagesPerHour && sent === 0 ? 'DOWN' : failed >= t.failedMessagesPerHour ? 'DEGRADED' : 'UP',
        summary: `${c.live ? 'Live' : 'Test mode'} · ${sent} sent, ${failed} failed in the last hour`,
        detail: { live: c.live, sent, failed },
      });
    }
    const stuck = await this.prisma.outboundMessage.count({ where: { status: 'QUEUED', createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } } });
    out.push({ component: 'OUTBOX', label: 'Message queue', status: stuck > 50 ? 'DEGRADED' : 'UP', summary: stuck ? `${stuck} messages waiting over 10 min` : 'Nothing waiting', detail: { stuck } });

    const pending = await this.prisma.manualVerification.findMany({ where: { status: { in: ['PENDING', 'AWAITING_SECOND_APPROVAL'] } }, select: { submittedAt: true } });
    const oldest = pending.reduce<Date | null>((m, p) => (p.submittedAt && (!m || p.submittedAt < m) ? p.submittedAt : m), null);
    const waitMin = oldest ? Math.round((now.getTime() - oldest.getTime()) / 60_000) : 0;
    out.push({
      component: 'VERIFICATIONS', label: 'Airtime checks',
      status: pending.length && (waitMin >= t.verificationWaitMinutes || pending.length >= t.verificationQueueSize) ? 'DEGRADED' : 'UP',
      summary: pending.length ? `${pending.length} waiting · oldest ${waitMin} min` : 'Queue empty',
      detail: { waiting: pending.length, oldestMinutes: waitMin },
    });

    const review = await this.prisma.transaction.count({ where: { state: 'UNDER_REVIEW' } });
    out.push({ component: 'REVIEW', label: 'Held for review', status: review >= t.underReviewCount ? 'DEGRADED' : 'UP', summary: review ? `${review} transaction${review > 1 ? 's' : ''} need a decision` : 'None', detail: { count: review } });
    return out;
  }

  /** One sampling round: store, then open / touch / resolve alerts. */
  async sample(now = new Date()) {
    const checks = await this.checks(now);
    await this.prisma.healthSample.createMany({
      data: checks.map((c) => ({ component: c.component, status: c.status, latencyMs: c.latencyMs ?? null, detail: { summary: c.summary, ...(c.detail ?? {}) } as Prisma.InputJsonValue, at: now })),
    });
    const t = await this.settings.get('alerts');
    if (t.enabled) {
      for (const c of checks) {
        const key = `component:${c.component}`;
        if (c.status === 'UP') await this.resolve(key, now);
        else await this.raise(key, c.status === 'DOWN' ? 'CRITICAL' : 'WARNING', `${c.label}: ${c.status === 'DOWN' ? 'down' : 'needs attention'}`, c.summary, now);
      }
    }
    await this.prisma.healthSample.deleteMany({ where: { at: { lt: new Date(now.getTime() - 14 * 86_400_000) } } });
    return checks;
  }

  async raise(key: string, severity: AlertSeverity, title: string, detail: string, now = new Date()) {
    const open = await this.prisma.alert.findFirst({ where: { key, resolvedAt: null } });
    const alert = open
      ? await this.prisma.alert.update({ where: { id: open.id }, data: { lastSeenAt: now, detail, severity, title } })
      : await this.prisma.alert.create({ data: { key, severity, title, detail, firstSeenAt: now, lastSeenAt: now } });
    const { repeatAfterMinutes } = await this.settings.get('alerts');
    const due = !alert.acknowledgedAt && (!alert.notifiedAt || now.getTime() - alert.notifiedAt.getTime() >= repeatAfterMinutes * 60_000);
    if (due) {
      const claimed = await this.prisma.alert.updateMany({ where: { id: alert.id, notifiedAt: alert.notifiedAt }, data: { notifiedAt: now } });
      if (claimed.count === 1) await this.notifyStaff(`AMICO ${severity === 'CRITICAL' ? 'CRITICAL' : 'ALERT'}: ${title}. ${detail}`.slice(0, 300));
    }
    return alert;
  }

  private async resolve(key: string, now: Date) {
    const open = await this.prisma.alert.findFirst({ where: { key, resolvedAt: null } });
    if (!open) return;
    await this.prisma.alert.update({ where: { id: open.id }, data: { resolvedAt: now } });
    if (open.notifiedAt) await this.notifyStaff(`AMICO resolved: ${open.title}`.slice(0, 300));
  }

  /** Everyone who can see monitoring and chose SMS / WhatsApp alerts on their account. */
  private async notifyStaff(text: string) {
    const staff = await this.prisma.staffUser.findMany({ where: { active: true, phone: { not: null }, NOT: { alertChannels: { isEmpty: true } } } });
    for (const s of staff) {
      if (!(await permissionsFor(this.prisma, s.roles)).has('MONITORING_READ')) continue;
      await this.messaging.queue(this.prisma, {
        to: s.phone!, body: text, locale: s.locale, purpose: 'ALERT', staffId: s.id,
        requested: s.alertChannels.includes('WHATSAPP') ? (s.alertChannels.includes('SMS') ? 'WHATSAPP_THEN_SMS' : 'WHATSAPP') : 'SMS',
      });
    }
  }

  /** The monitoring page: live checks, 24 hourly cells per component, open alerts. */
  async overview(now = new Date()) {
    const checks = await this.checks(now);
    const since = new Date(now.getTime() - 24 * HOUR);
    const samples = await this.prisma.healthSample.findMany({ where: { at: { gte: since } }, select: { component: true, status: true, at: true } });
    const rank: Record<HealthStatus, number> = { UP: 0, DEGRADED: 1, DOWN: 2 };
    const history: Record<string, Array<HealthStatus | null>> = {};
    for (const c of checks) history[c.component] = Array.from({ length: 24 }, () => null);
    for (const s of samples) {
      const slot = 23 - Math.floor((now.getTime() - s.at.getTime()) / HOUR);
      if (slot < 0 || slot > 23) continue;
      const row = (history[s.component] ??= Array.from({ length: 24 }, () => null));
      const cur = row[slot];
      if (cur === null || cur === undefined || rank[s.status] > rank[cur]) row[slot] = s.status;
    }
    const uptime: Record<string, number | null> = {};
    for (const [k, row] of Object.entries(history)) {
      const known = row.filter((x): x is HealthStatus => x !== null);
      uptime[k] = known.length ? Math.round((known.filter((x) => x === 'UP').length / known.length) * 1000) / 10 : null;
    }
    const alerts = await this.prisma.alert.findMany({ where: { OR: [{ resolvedAt: null }, { resolvedAt: { gte: since } }] }, orderBy: { lastSeenAt: 'desc' }, take: 50 });
    return { at: now, checks: checks.map((c) => ({ ...c, history: history[c.component], uptime24h: uptime[c.component] })), alerts };
  }

  async alerts(open: boolean) {
    return this.prisma.alert.findMany({ where: open ? { resolvedAt: null } : {}, orderBy: { lastSeenAt: 'desc' }, take: 100 });
  }

  async acknowledge(id: string, actorId: string, ip?: string) {
    const a = await this.prisma.alert.findUnique({ where: { id } });
    if (!a) throw NotFound('Alert');
    if (a.acknowledgedAt) throw Conflict('ALREADY_ACKNOWLEDGED', 'Someone already took this alert');
    const after = await this.prisma.alert.update({ where: { id }, data: { acknowledgedAt: new Date(), acknowledgedById: actorId } });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'alert.acknowledged', entityType: 'Alert', entityId: id, after: { key: a.key, title: a.title }, ip });
    return after;
  }
}

const AlertsQuery = z.object({ open: z.enum(['1', '0']).default('1') });

@ApiTags('admin / monitoring')
@Controller('admin')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('monitoring')
  @StaffAuth('MONITORING_READ')
  overview() {
    return this.monitoring.overview();
  }

  @Post('monitoring/sample')
  @StaffAuth('MONITORING_READ')
  sample() {
    return this.monitoring.sample();
  }

  @Get('alerts')
  @StaffAuth('MONITORING_READ')
  alerts(@Query(new ZodPipe(AlertsQuery)) q: z.infer<typeof AlertsQuery>) {
    return this.monitoring.alerts(q.open === '1');
  }

  @Post('alerts/:id/acknowledge')
  @StaffAuth('MONITORING_READ')
  ack(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() me: StaffPrincipal, @Req() req: Request, @Body() _b: unknown) {
    return this.monitoring.acknowledge(id, me.id, req.ip);
  }
}

@Module({ controllers: [MonitoringController], providers: [MonitoringService], exports: [MonitoringService] })
export class MonitoringModule {}
