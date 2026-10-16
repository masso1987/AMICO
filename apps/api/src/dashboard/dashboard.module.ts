import { Body, Controller, Get, Injectable, Module, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { productGroupOf, type Permission } from '@amico/contracts';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { MaintenanceModule, MaintenanceService } from '../maintenance/maintenance.module';
import { MonitoringModule, MonitoringService } from '../monitoring/monitoring.module';
import type { Prisma } from '../generated/prisma/client';

/** Every widget, the permission it needs, and its size on the grid (1 = third, 2 = two thirds, 3 = full width). */
export const WIDGETS = {
  KPIS_TODAY: { needs: 'TRANSACTION_READ', size: 3, en: 'Today at a glance', fr: 'Aujourd’hui en bref' },
  VERIFICATION_QUEUE: { needs: 'VERIFY_MANUAL', size: 1, en: 'Airtime checks waiting', fr: 'Vérifications en attente' },
  SYSTEM_HEALTH: { needs: 'MONITORING_READ', size: 1, en: 'System health', fr: 'État du système' },
  OPEN_ALERTS: { needs: 'MONITORING_READ', size: 1, en: 'Open alerts', fr: 'Alertes ouvertes' },
  VOLUME_7D: { needs: 'REPORT_READ', size: 2, en: 'Last 7 days', fr: '7 derniers jours' },
  BY_PRODUCT: { needs: 'REPORT_READ', size: 1, en: 'Today by service', fr: 'Aujourd’hui par service' },
  APPROVALS: { needs: null, size: 1, en: 'Waiting for your approval', fr: 'En attente de votre approbation' },
  MESSAGING_TODAY: { needs: 'MONITORING_READ', size: 1, en: 'Messages today', fr: 'Messages du jour' },
  MAINTENANCE: { needs: 'MONITORING_READ', size: 1, en: 'Maintenance', fr: 'Maintenance' },
  RECENT_TRANSACTIONS: { needs: 'TRANSACTION_READ', size: 2, en: 'Latest transactions', fr: 'Dernières transactions' },
  RECENT_ACTIVITY: { needs: 'AUDIT_READ', size: 1, en: 'Recent staff activity', fr: 'Activité récente du personnel' },
} as const satisfies Record<string, { needs: Permission | null; size: 1 | 2 | 3; en: string; fr: string }>;
export type WidgetId = keyof typeof WIDGETS;
const IDS = Object.keys(WIDGETS) as [WidgetId, ...WidgetId[]];

const DEFAULT_ORDER: WidgetId[] = ['KPIS_TODAY', 'VERIFICATION_QUEUE', 'SYSTEM_HEALTH', 'OPEN_ALERTS', 'VOLUME_7D', 'APPROVALS', 'BY_PRODUCT', 'MESSAGING_TODAY', 'MAINTENANCE', 'RECENT_TRANSACTIONS', 'RECENT_ACTIVITY'];
const LayoutSchema = z.object({ widgets: z.array(z.enum(IDS)).max(IDS.length).transform((w) => [...new Set(w)]) });

const TZ = 'Africa/Douala';
/** Start of "today" in Douala (UTC+1, no daylight saving). */
function startOfToday(now = new Date()) {
  const local = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset);
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly maintenance: MaintenanceService,
    private readonly monitoring: MonitoringService,
  ) {}

  allowed(me: StaffPrincipal): WidgetId[] {
    return IDS.filter((id) => {
      const need = WIDGETS[id].needs;
      return need === null || me.permissions.has(need);
    });
  }

  async layout(me: StaffPrincipal): Promise<WidgetId[]> {
    const row = await this.prisma.staffUser.findUniqueOrThrow({ where: { id: me.id }, select: { dashboardLayout: true } });
    const allowed = new Set(this.allowed(me));
    const saved = Array.isArray(row.dashboardLayout) ? (row.dashboardLayout as string[]) : null;
    return (saved ?? DEFAULT_ORDER).filter((w): w is WidgetId => allowed.has(w as WidgetId));
  }

  async saveLayout(me: StaffPrincipal, widgets: WidgetId[]) {
    const allowed = new Set(this.allowed(me));
    const clean = widgets.filter((w) => allowed.has(w));
    await this.prisma.staffUser.update({ where: { id: me.id }, data: { dashboardLayout: clean as unknown as Prisma.InputJsonValue } });
    return this.view(me);
  }

  async view(me: StaffPrincipal) {
    const layout = await this.layout(me);
    const data: Partial<Record<WidgetId, unknown>> = {};
    for (const w of layout) data[w] = await this.widget(w, me);
    return {
      layout,
      catalogue: this.allowed(me).map((id) => ({ id, size: WIDGETS[id].size, en: WIDGETS[id].en, fr: WIDGETS[id].fr })),
      data,
    };
  }

  private async widget(id: WidgetId, me: StaffPrincipal): Promise<unknown> {
    const today = startOfToday();
    switch (id) {
      case 'KPIS_TODAY': {
        const rows = await this.prisma.transaction.groupBy({ by: ['state'], where: { createdAt: { gte: today } }, _count: { _all: true }, _sum: { customerPays: true, platformFee: true } });
        const total = rows.reduce((s, r) => s + r._count._all, 0);
        const done = rows.find((r) => r.state === 'COMPLETED');
        const failed = rows.filter((r) => ['FAILED', 'REFUNDED', 'REFUND_PENDING'].includes(r.state)).reduce((s, r) => s + r._count._all, 0);
        const finished = (done?._count._all ?? 0) + failed;
        return {
          transactions: total,
          completed: done?._count._all ?? 0,
          volume: done?._sum.customerPays ?? 0,
          platformFees: done?._sum.platformFee ?? 0,
          successRate: finished ? Math.round(((done?._count._all ?? 0) / finished) * 1000) / 10 : null,
          inProgress: rows.filter((r) => !['COMPLETED', 'FAILED', 'REJECTED', 'REFUNDED', 'REFUND_PENDING'].includes(r.state)).reduce((s, r) => s + r._count._all, 0),
        };
      }
      case 'VERIFICATION_QUEUE': {
        const rows = await this.prisma.manualVerification.findMany({ where: { status: { in: ['PENDING', 'AWAITING_SECOND_APPROVAL', 'ON_HOLD', 'ESCALATED'] } }, select: { status: true, submittedAt: true } });
        const oldest = rows.filter((r) => r.status === 'PENDING').reduce<Date | null>((m, r) => (r.submittedAt && (!m || r.submittedAt < m) ? r.submittedAt : m), null);
        return { pending: rows.filter((r) => r.status === 'PENDING').length, secondApproval: rows.filter((r) => r.status === 'AWAITING_SECOND_APPROVAL').length, onHold: rows.filter((r) => ['ON_HOLD', 'ESCALATED'].includes(r.status)).length, oldestSubmittedAt: oldest };
      }
      case 'SYSTEM_HEALTH': {
        const latest = await this.prisma.$queryRaw<Array<{ component: string; status: string; at: Date; detail: unknown }>>`
          SELECT DISTINCT ON (component) component, status::text AS status, at, detail FROM "HealthSample"
          WHERE at > now() - interval '10 minutes' ORDER BY component, at DESC`;
        if (latest.length) return latest.map((r) => ({ component: r.component, status: r.status, summary: (r.detail as { summary?: string } | null)?.summary ?? '' }));
        return (await this.monitoring.checks()).map((c) => ({ component: c.component, status: c.status, summary: c.summary }));
      }
      case 'OPEN_ALERTS':
        return this.prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }], take: 6 });
      case 'VOLUME_7D': {
        const rows = await this.prisma.$queryRaw<Array<{ day: Date; completed: bigint; volume: bigint | null; fees: bigint | null }>>`
          SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}) AS day,
                 count(*) FILTER (WHERE state = 'COMPLETED') AS completed,
                 sum("customerPays") FILTER (WHERE state = 'COMPLETED') AS volume,
                 sum("platformFee") FILTER (WHERE state = 'COMPLETED') AS fees
          FROM "Transaction" WHERE "createdAt" >= ${new Date(today.getTime() - 6 * 86_400_000)}
          GROUP BY 1 ORDER BY 1`;
        const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r]));
        return Array.from({ length: 7 }, (_, i) => {
          const d = new Date(today.getTime() - (6 - i) * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
          const r = byDay.get(d);
          return { day: d, completed: Number(r?.completed ?? 0), volume: Number(r?.volume ?? 0), fees: Number(r?.fees ?? 0) };
        });
      }
      case 'BY_PRODUCT': {
        const rows = await this.prisma.transaction.groupBy({ by: ['serviceId'], where: { createdAt: { gte: today }, state: 'COMPLETED' }, _count: { _all: true }, _sum: { customerPays: true } });
        const services = await this.prisma.service.findMany({ where: { id: { in: rows.map((r) => r.serviceId) } }, select: { id: true, sourceAsset: true, destinationAsset: true } });
        const out: Record<string, { count: number; volume: number }> = {};
        for (const r of rows) {
          const s = services.find((x) => x.id === r.serviceId)!;
          const g = productGroupOf({ source: s.sourceAsset, destination: s.destinationAsset });
          out[g] ??= { count: 0, volume: 0 };
          out[g].count += r._count._all;
          out[g].volume += r._sum.customerPays ?? 0;
        }
        return out;
      }
      case 'APPROVALS': {
        const [rules, providerRules, refunds, second] = await Promise.all([
          me.permissions.has('PRICING_APPROVE') ? this.prisma.pricingRule.count({ where: { status: 'PENDING_APPROVAL', createdById: { not: me.id } } }) : 0,
          me.permissions.has('PROVIDER_FEE_WRITE') ? this.prisma.providerFeeRule.count({ where: { status: 'PENDING_APPROVAL', createdById: { not: me.id } } }) : 0,
          me.permissions.has('REFUND_APPROVE') ? this.prisma.refund.count({ where: { status: 'REQUESTED', requestedById: { not: me.id } } }) : 0,
          me.permissions.has('VERIFY_SECOND_APPROVAL') ? this.prisma.manualVerification.count({ where: { status: 'AWAITING_SECOND_APPROVAL', firstReviewerId: { not: me.id } } }) : 0,
        ]);
        return { pricingRules: rules, providerFeeRules: providerRules, refunds, secondApprovals: second };
      }
      case 'MESSAGING_TODAY':
        return this.messaging.stats(today);
      case 'MAINTENANCE':
        return this.maintenance.status();
      case 'RECENT_TRANSACTIONS':
        return this.prisma.transaction.findMany({
          orderBy: { createdAt: 'desc' }, take: 8,
          select: { id: true, reference: true, state: true, customerPays: true, createdAt: true, isSimulated: true, service: { select: { code: true, name: true } } },
        });
      case 'RECENT_ACTIVITY':
        return this.prisma.auditLog.findMany({ where: { actorType: 'STAFF' }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, action: true, actorId: true, entityType: true, createdAt: true } });
    }
  }
}

@ApiTags('admin / dashboard')
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @StaffAuth()
  view(@CurrentStaff() me: StaffPrincipal) {
    return this.dashboard.view(me);
  }

  @Put('layout')
  @StaffAuth()
  save(@CurrentStaff() me: StaffPrincipal, @Body(new ZodPipe(LayoutSchema)) body: z.infer<typeof LayoutSchema>) {
    return this.dashboard.saveLayout(me, body.widgets);
  }
}

@Module({ imports: [MaintenanceModule, MonitoringModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
