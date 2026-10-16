import { Body, Controller, Delete, Get, Inject, Injectable, Logger, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ProviderRegistry } from '@amico/providers';
import { ASSET_META, PositiveFcfa, routesInGroup, type Operator } from '@amico/contracts';
import { PROVIDER_REGISTRY } from '../providers/providers.module';
import { CatalogueModule, CatalogueService } from '../catalogue/catalogue.module';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { DomainError, NotFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Bundle } from '../generated/prisma/client';

const OperatorEnum = z.enum(['MTN', 'ORANGE']);
const Category = z.enum(['DATA', 'VOICE', 'SMS', 'COMBO']);
const Validity = z.enum(['DAY', 'WEEK', 'MONTH', 'OTHER']);
const Reason = z.string().trim().min(5).max(500);
const Optional = z.number().int().min(0).max(10_000_000).nullable().optional();

const BundleFields = z.object({
  name: z.string().trim().min(3).max(120),
  nameFr: z.string().trim().min(3).max(120).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  category: Category,
  validity: Validity,
  validityDays: z.number().int().min(1).max(366),
  price: PositiveFcfa.refine((p) => p <= 1_000_000, 'Price looks too high'),
  dataMb: Optional,
  voiceMinutes: Optional,
  smsCount: Optional,
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
});
const CreateSchema = BundleFields.extend({
  operator: OperatorEnum,
  /** The operator's own product / USSD code for this bundle, needed to buy it. */
  productId: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9_\-.*#]+$/),
  reason: Reason,
});
const UpdateSchema = BundleFields.partial().extend({ reason: Reason });
const DeleteSchema = z.object({ reason: Reason });
const SyncSchema = z.object({ operator: OperatorEnum.optional(), reason: Reason.default('Manual sync from the admin') });
const PublicQuery = z.object({ operator: OperatorEnum.optional(), category: Category.optional(), validity: Validity.optional() });
const AdminQuery = z.object({ operator: OperatorEnum.optional(), include: z.enum(['active', 'all']).default('all') });

export interface SyncSummary {
  operator: Operator;
  provider: string | null;
  added: number;
  updated: number;
  priceChanged: number;
  withdrawn: number;
  note?: string;
}

@Injectable()
export class BundlesService {
  private readonly log = new Logger(BundlesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalogue: CatalogueService,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  /** Which provider delivers bundles on this network in this environment. */
  private providerFor(operator: Operator) {
    const key = { operator, capability: 'DATA_BUNDLE' as const };
    return this.registry.has(key) ? this.registry.resolve(key) : null;
  }

  /** Pulls each operator's catalogue. Prices always follow the provider; staff wording is kept. */
  async sync(operator: Operator | undefined, actorId: string | null, reason: string): Promise<SyncSummary[]> {
    const out: SyncSummary[] = [];
    for (const op of operator ? [operator] : (['MTN', 'ORANGE'] as Operator[])) {
      const adapter = this.providerFor(op);
      if (!adapter) {
        out.push({ operator: op, provider: null, added: 0, updated: 0, priceChanged: 0, withdrawn: 0, note: 'No bundle provider is connected for this network yet' });
        continue;
      }
      const list = await adapter.listBundles(op);
      if (!list) {
        out.push({ operator: op, provider: adapter.code, added: 0, updated: 0, priceChanged: 0, withdrawn: 0, note: 'This provider does not publish a bundle list: add bundles by hand' });
        continue;
      }
      const summary: SyncSummary = { operator: op, provider: adapter.code, added: 0, updated: 0, priceChanged: 0, withdrawn: 0 };
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.bundle.findMany({ where: { providerCode: adapter.code, operator: op, source: 'PROVIDER' } });
        const byId = new Map(existing.map((b) => [b.productId, b]));
        for (const p of list) {
          if (!Number.isSafeInteger(p.price) || p.price <= 0) continue;
          const prev = byId.get(p.productId);
          const facts = { category: p.category, validity: p.validity, validityDays: p.validityDays, dataMb: p.dataMb ?? null, voiceMinutes: p.voiceMinutes ?? null, smsCount: p.smsCount ?? null };
          if (!prev) {
            await tx.bundle.create({ data: { operator: op, providerCode: adapter.code, productId: p.productId, name: p.name, description: p.description ?? null, price: p.price, source: 'PROVIDER', lastSyncedAt: now, ...facts } });
            summary.added++;
          } else {
            if (prev.price !== p.price) summary.priceChanged++;
            await tx.bundle.update({
              where: { id: prev.id },
              data: {
                price: p.price,
                lastSyncedAt: now,
                withdrawnAt: null,
                // A bundle the provider lists again comes back unless staff deleted it.
                ...(prev.withdrawnAt && !prev.deletedAt ? { active: true } : {}),
                ...(prev.staffEdited ? {} : { name: p.name, description: p.description ?? null, ...facts }),
              },
            });
            summary.updated++;
          }
        }
        const listed = new Set(list.map((p) => p.productId));
        const gone = existing.filter((b) => !listed.has(b.productId) && !b.withdrawnAt);
        if (gone.length) await tx.bundle.updateMany({ where: { id: { in: gone.map((b) => b.id) } }, data: { withdrawnAt: now, active: false } });
        summary.withdrawn = gone.length;
        await this.audit.record({ actorType: actorId ? 'STAFF' : 'SYSTEM', actorId, action: 'bundle.sync', entityType: 'Bundle', entityId: null, after: { ...summary, reason } }, tx);
      });
      out.push(summary);
    }
    return out;
  }

  async adminList(q: z.infer<typeof AdminQuery>) {
    return this.prisma.bundle.findMany({
      where: { deletedAt: null, ...(q.operator ? { operator: q.operator } : {}), ...(q.include === 'active' ? { active: true } : {}) },
      orderBy: [{ operator: 'asc' }, { featured: 'desc' }, { validityDays: 'asc' }, { price: 'asc' }],
      include: { _count: { select: { transactions: true } } },
    });
  }

  async create(input: z.infer<typeof CreateSchema>, actorId: string, ip?: string) {
    const provider = this.providerFor(input.operator);
    const providerCode = provider?.code ?? `${input.operator}_DIRECT`;
    const clash = await this.prisma.bundle.findUnique({ where: { providerCode_productId: { providerCode, productId: input.productId } } });
    if (clash && !clash.deletedAt) throw new DomainError('BUNDLE_EXISTS', 'A bundle with this product code already exists');
    const { reason, ...fields } = input;
    const data = { ...fields, nameFr: fields.nameFr ?? null, description: fields.description ?? null, dataMb: fields.dataMb ?? null, voiceMinutes: fields.voiceMinutes ?? null, smsCount: fields.smsCount ?? null, providerCode, source: 'STAFF' as const, deletedAt: null, withdrawnAt: null };
    const b = clash ? await this.prisma.bundle.update({ where: { id: clash.id }, data }) : await this.prisma.bundle.create({ data });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'bundle.created', entityType: 'Bundle', entityId: b.id, after: { ...b, reason }, ip });
    return b;
  }

  async update(id: string, input: z.infer<typeof UpdateSchema>, actorId: string, ip?: string) {
    const before = await this.prisma.bundle.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw NotFound('Bundle');
    const { reason, ...fields } = input;
    const wording = ['name', 'nameFr', 'description', 'category', 'validity', 'validityDays', 'dataMb', 'voiceMinutes', 'smsCount'].some((k) => k in fields);
    const after = await this.prisma.bundle.update({ where: { id }, data: { ...fields, ...(before.source === 'PROVIDER' && wording ? { staffEdited: true } : {}) } });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'bundle.updated', entityType: 'Bundle', entityId: id, before, after: { ...after, reason }, ip });
    return after;
  }

  /** Bundles that were ever quoted stay in the database (for history) but disappear everywhere. */
  async remove(id: string, reason: string, actorId: string, ip?: string) {
    const before = await this.prisma.bundle.findUnique({ where: { id }, include: { _count: { select: { quotes: true } } } });
    if (!before || before.deletedAt) throw NotFound('Bundle');
    const { _count, ...row } = before;
    if (_count.quotes > 0) await this.prisma.bundle.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    else await this.prisma.bundle.delete({ where: { id } });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'bundle.deleted', entityType: 'Bundle', entityId: id, before: row, after: { reason, kept: _count.quotes > 0 }, ip });
    return { ok: true };
  }

  /**
   * Customer catalogue: active bundles on networks where at least one payment route
   * is open, with the payment options (service codes) that can buy each one.
   */
  async publicList(q: z.infer<typeof PublicQuery>) {
    const open = await this.openBundleServices();
    const operators = [...new Set(open.map((s) => s.operator))];
    if (!operators.length) return { paymentOptions: [], bundles: [] };
    const bundles = await this.prisma.bundle.findMany({
      where: {
        active: true, deletedAt: null, withdrawnAt: null,
        operator: q.operator ? q.operator : { in: operators },
        ...(q.category ? { category: q.category } : {}),
        ...(q.validity ? { validity: q.validity } : {}),
      },
      orderBy: [{ featured: 'desc' }, { validityDays: 'asc' }, { price: 'asc' }],
    });
    return {
      paymentOptions: open,
      bundles: bundles.filter((b) => open.some((s) => s.operator === b.operator)).map(present),
    };
  }

  /** Usable bundle routes: which wallet can pay for which network's bundles. */
  async openBundleServices() {
    const services = await this.catalogue.listAvailable();
    const codes = new Set(routesInGroup('BUNDLES'));
    return services
      .filter((s) => codes.has(s.code))
      .map((s) => ({ serviceCode: s.code, operator: ASSET_META[s.destinationAsset as keyof typeof ASSET_META].operator, payWith: s.sourceAsset }));
  }

  async getActive(id: string): Promise<Bundle> {
    const b = await this.prisma.bundle.findUnique({ where: { id } });
    if (!b || !b.active || b.deletedAt || b.withdrawnAt) throw new DomainError('BUNDLE_UNAVAILABLE', 'This bundle is not available any more');
    return b;
  }
}

export function present(b: Bundle) {
  return {
    id: b.id,
    operator: b.operator,
    name: b.name,
    nameFr: b.nameFr ?? b.name,
    description: b.description,
    category: b.category,
    validity: b.validity,
    validityDays: b.validityDays,
    price: b.price,
    dataMb: b.dataMb,
    voiceMinutes: b.voiceMinutes,
    smsCount: b.smsCount,
    featured: b.featured,
  };
}

@ApiTags('catalogue')
@Controller('bundles')
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  /** Public: the bundle catalogue customers can buy right now. */
  @Get()
  list(@Query(new ZodPipe(PublicQuery)) q: z.infer<typeof PublicQuery>) {
    return this.bundles.publicList(q);
  }
}

@ApiTags('admin / bundles')
@Controller('admin/bundles')
export class BundlesAdminController {
  constructor(private readonly bundles: BundlesService) {}

  @Get()
  @StaffAuth('TRANSACTION_READ')
  list(@Query(new ZodPipe(AdminQuery)) q: z.infer<typeof AdminQuery>) {
    return this.bundles.adminList(q);
  }

  @Post()
  @StaffAuth('BUNDLE_MANAGE')
  create(@Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.bundles.create(body, me.id, req.ip);
  }

  @Post('sync')
  @StaffAuth('BUNDLE_MANAGE')
  sync(@Body(new ZodPipe(SyncSchema)) body: z.infer<typeof SyncSchema>, @CurrentStaff() me: StaffPrincipal) {
    return this.bundles.sync(body.operator, me.id, body.reason);
  }

  @Patch(':id')
  @StaffAuth('BUNDLE_MANAGE')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.bundles.update(id, body, me.id, req.ip);
  }

  @Delete(':id')
  @StaffAuth('BUNDLE_MANAGE')
  remove(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DeleteSchema)) body: z.infer<typeof DeleteSchema>, @CurrentStaff() me: StaffPrincipal, @Req() req: Request) {
    return this.bundles.remove(id, body.reason, me.id, req.ip);
  }
}

@Module({
  imports: [CatalogueModule],
  controllers: [BundlesController, BundlesAdminController],
  providers: [BundlesService],
  exports: [BundlesService],
})
export class BundlesModule {}

