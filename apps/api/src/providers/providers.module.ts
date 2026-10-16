import { Body, Controller, Get, Global, Inject, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { MockProviderAdapter, ProviderRegistry, type CapabilityKey, type ProviderAdapter } from '@amico/providers';
import type { CapabilityRequirement, Operator, ProviderCapability } from '@amico/contracts';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { NotFound } from '../common/errors';

export const PROVIDER_REGISTRY = Symbol('PROVIDER_REGISTRY');

const ALL_KEYS: CapabilityKey[] = (['MTN', 'ORANGE'] as Operator[]).flatMap((operator) =>
  (['COLLECT', 'DISBURSE', 'AIRTIME_TOPUP', 'DATA_BUNDLE', 'STATUS_QUERY'] as ProviderCapability[]).map((capability) => ({ operator, capability })),
);

/**
 * Builds the adapter registry for this environment. In SIMULATION_MODE only the mock
 * adapter loads; real adapters are added here once G0/G2 verification is complete.
 * The registry itself refuses simulated adapters in production.
 */
export function buildRegistry(env: Env, prisma?: PrismaService): ProviderRegistry {
  const registry = new ProviderRegistry(env.NODE_ENV);
  if (env.SIMULATION_MODE) {
    const recall = prisma
      ? async (idempotencyKey: string) => (await prisma.providerOperation.findUnique({ where: { idempotencyKey }, select: { amount: true } }))?.amount ?? null
      : undefined;
    registry.register(new MockProviderAdapter({ recall }), ALL_KEYS);
  }
  // Real adapters (MTN MoMo Open API, Orange Money, aggregator) register here, never alongside the mock.
  return registry;
}

@Injectable()
export class CapabilityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  /**
   * A capability is usable only if: an adapter is loaded for it, and the DB row for
   * that adapter's provider is enabled AND verified.
   */
  async resolveUsable(req: CapabilityRequirement): Promise<{ adapter: ProviderAdapter; providerId: string } | null> {
    if (!this.registry.has(req)) return null;
    const adapter = this.registry.resolve(req);
    const row = await this.prisma.providerCapability.findFirst({
      where: {
        provider: { code: adapter.code, active: true },
        operator: req.operator,
        capability: req.capability,
        enabled: true,
        verifiedAt: { not: null },
      },
      select: { providerId: true },
    });
    return row ? { adapter, providerId: row.providerId } : null;
  }

  async missingCapabilities(required: CapabilityRequirement[]): Promise<CapabilityRequirement[]> {
    const missing: CapabilityRequirement[] = [];
    for (const r of required) if (!(await this.resolveUsable(r))) missing.push(r);
    return missing;
  }

  async adapterFor(req: CapabilityRequirement): Promise<ProviderAdapter> {
    const usable = await this.resolveUsable(req);
    if (!usable) throw new Error(`Capability ${req.operator}:${req.capability} is not usable`);
    return usable.adapter;
  }
}

const VerifySchema = z.object({ notes: z.string().trim().min(10).max(1000) });

@ApiTags('admin / providers')
@Controller('admin/providers')
export class ProvidersAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PROVIDER_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  /** Provider and capability status. Never returns credentials (none are stored here). */
  @Get()
  @StaffAuth('SIM_READ_MASKED')
  async list() {
    const providers = await this.prisma.provider.findMany({ include: { capabilities: { orderBy: [{ operator: 'asc' }, { capability: 'asc' }] } } });
    return providers.map((p) => ({
      ...p,
      capabilities: p.capabilities.map((c) => ({ ...c, adapterLoaded: this.registry.has(c) && this.registry.resolve(c).code === p.code })),
    }));
  }

  @Post('capabilities/:id/verify')
  @StaffAuth('PROVIDER_CAPABILITY_WRITE')
  async verify(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VerifySchema)) body: z.infer<typeof VerifySchema>, @CurrentStaff() staff: StaffPrincipal) {
    const before = await this.prisma.providerCapability.findUnique({ where: { id } });
    if (!before) throw NotFound('Capability');
    const after = await this.prisma.providerCapability.update({
      where: { id },
      data: { enabled: true, verifiedAt: new Date(), verifiedById: staff.id, notes: body.notes },
    });
    await this.audit.record({ actorType: 'STAFF', actorId: staff.id, action: 'provider_capability.verify', entityType: 'ProviderCapability', entityId: id, before, after });
    return after;
  }

  @Post('capabilities/:id/disable')
  @StaffAuth('PROVIDER_CAPABILITY_WRITE')
  async disable(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(VerifySchema)) body: z.infer<typeof VerifySchema>, @CurrentStaff() staff: StaffPrincipal) {
    const before = await this.prisma.providerCapability.findUnique({ where: { id } });
    if (!before) throw NotFound('Capability');
    const after = await this.prisma.providerCapability.update({ where: { id }, data: { enabled: false, notes: body.notes } });
    await this.audit.record({ actorType: 'STAFF', actorId: staff.id, action: 'provider_capability.disable', entityType: 'ProviderCapability', entityId: id, before, after });
    return after;
  }
}

@Global()
@Module({
  controllers: [ProvidersAdminController],
  providers: [{ provide: PROVIDER_REGISTRY, inject: [ENV, PrismaService], useFactory: buildRegistry }, CapabilityService],
  exports: [PROVIDER_REGISTRY, CapabilityService],
})
export class ProvidersModule {}
