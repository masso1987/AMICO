import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { CapabilityRequirement } from '@amico/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CapabilityService } from '../providers/providers.module';
import { PricingModule } from '../pricing/pricing.module';
import { PricingService } from '../pricing/pricing.service';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { DomainError, NotFound } from '../common/errors';
import type { Service, SimAccount } from '../generated/prisma/client';

export interface Availability {
  available: boolean;
  reasons: string[];
}

@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Everything that must be true before customers can see or use a service.
   * `ignoreStatus` is used when checking whether a DISABLED service may be enabled.
   */
  async availability(service: Service & { receivingSim: SimAccount | null }, { ignoreStatus = false } = {}): Promise<Availability> {
    const reasons: string[] = [];
    if (!ignoreStatus && service.status !== 'ENABLED') reasons.push('Service is disabled');
    const missing = await this.capabilities.missingCapabilities(service.requiredCapabilities as unknown as CapabilityRequirement[]);
    for (const m of missing) reasons.push(`Provider capability ${m.operator}:${m.capability} is not enabled and verified`);
    if (!(await this.pricing.activeRule(service.id))) reasons.push('No approved pricing rule in force');
    if (service.processingMethod === 'MANUAL_SOURCE') {
      if (!service.receivingSim) reasons.push('No receiving SIM assigned');
      else if (!service.receivingSim.active) reasons.push('Receiving SIM is inactive');
      else if (service.receivingSim.type !== 'NORMAL') reasons.push('Receiving SIM must be a normal SIM');
    }
    return { available: reasons.length === 0, reasons };
  }

  async getUsableService(code: string) {
    const service = await this.prisma.service.findUnique({ where: { code }, include: { receivingSim: true } });
    if (!service) throw NotFound('Service');
    const a = await this.availability(service);
    if (!a.available) throw new DomainError('SERVICE_UNAVAILABLE', 'This service is not available right now', undefined, a.reasons);
    return service;
  }

  async listAvailable() {
    const services = await this.prisma.service.findMany({ where: { status: 'ENABLED' }, include: { receivingSim: true }, orderBy: { code: 'asc' } });
    const out = [];
    for (const s of services) {
      if (!(await this.availability(s)).available) continue;
      const rule = await this.pricing.activeRule(s.id);
      out.push({
        code: s.code,
        name: s.name,
        sourceAsset: s.sourceAsset,
        destinationAsset: s.destinationAsset,
        processingMethod: s.processingMethod,
        minAmount: rule!.minAmount,
        maxAmount: rule!.maxAmount,
      });
    }
    return out;
  }
}

@ApiTags('catalogue')
@Controller('services')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  /** Only services that are enabled, capability-verified, priced and staffed appear here. */
  @Get()
  list() {
    return this.catalogue.listAvailable();
  }
}

const ToggleSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const SettingsSchema = z
  .object({
    quoteTtlSeconds: z.number().int().min(60).max(3600),
    allowEstimatedProviderFee: z.boolean(),
    dualApprovalThreshold: z.number().int().min(0),
    receivingSimId: z.string().uuid().nullable(),
    reason: z.string().trim().min(5).max(500),
  })
  .partial()
  .required({ reason: true });

@ApiTags('admin / catalogue')
@Controller('admin/services')
export class CatalogueAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogue: CatalogueService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @StaffAuth('TRANSACTION_READ')
  async list() {
    const services = await this.prisma.service.findMany({ include: { receivingSim: true }, orderBy: { code: 'asc' } });
    const out = [];
    for (const s of services) {
      const { receivingSim, ...rest } = s;
      out.push({
        ...rest,
        receivingSim: receivingSim ? { id: receivingSim.id, code: receivingSim.code, msisdnMasked: receivingSim.msisdnMasked, active: receivingSim.active } : null,
        readiness: await this.catalogue.availability(s, { ignoreStatus: true }),
      });
    }
    return out;
  }

  @Post(':id/enable')
  @StaffAuth('CATALOGUE_WRITE')
  async enable(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ToggleSchema)) body: z.infer<typeof ToggleSchema>, @CurrentStaff() staff: StaffPrincipal) {
    const s = await this.prisma.service.findUnique({ where: { id }, include: { receivingSim: true } });
    if (!s) throw NotFound('Service');
    const readiness = await this.catalogue.availability(s, { ignoreStatus: true });
    if (!readiness.available) throw new DomainError('SERVICE_NOT_READY', 'Service cannot be enabled yet', undefined, readiness.reasons);
    const after = await this.prisma.service.update({ where: { id }, data: { status: 'ENABLED' } });
    await this.audit.record({ actorType: 'STAFF', actorId: staff.id, action: 'service.enable', entityType: 'Service', entityId: id, before: { status: s.status }, after: { status: after.status, reason: body.reason } });
    return after;
  }

  @Post(':id/disable')
  @StaffAuth('CATALOGUE_WRITE')
  async disable(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ToggleSchema)) body: z.infer<typeof ToggleSchema>, @CurrentStaff() staff: StaffPrincipal) {
    const s = await this.prisma.service.findUnique({ where: { id } });
    if (!s) throw NotFound('Service');
    const after = await this.prisma.service.update({ where: { id }, data: { status: 'DISABLED' } });
    await this.audit.record({ actorType: 'STAFF', actorId: staff.id, action: 'service.disable', entityType: 'Service', entityId: id, before: { status: s.status }, after: { status: after.status, reason: body.reason } });
    return after;
  }

  @Patch(':id')
  @StaffAuth('CATALOGUE_WRITE')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SettingsSchema)) body: z.infer<typeof SettingsSchema>, @CurrentStaff() staff: StaffPrincipal) {
    const before = await this.prisma.service.findUnique({ where: { id } });
    if (!before) throw NotFound('Service');
    const { reason, ...data } = body;
    if (data.receivingSimId) {
      const sim = await this.prisma.simAccount.findUnique({ where: { id: data.receivingSimId } });
      if (!sim || sim.type !== 'NORMAL') throw new DomainError('INVALID_SIM', 'Receiving SIM must be an existing normal SIM');
    }
    const after = await this.prisma.service.update({ where: { id }, data });
    await this.audit.record({ actorType: 'STAFF', actorId: staff.id, action: 'service.update', entityType: 'Service', entityId: id, before, after: { ...after, reason } });
    return after;
  }
}

@Module({
  imports: [PricingModule],
  controllers: [CatalogueController, CatalogueAdminController],
  providers: [CatalogueService],
  exports: [CatalogueService],
})
export class CatalogueModule {}
