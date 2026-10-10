import { Body, Controller, Get, Inject, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { maskMsisdn, Msisdn } from '@amico/contracts';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { decrypt, encrypt } from '../common/crypto';
import { NotFound } from '../common/errors';

/** Fields that ever reach a general staff view. The encrypted number never leaves this module. */
const PUBLIC_FIELDS = {
  id: true, code: true, label: true, operator: true, type: true, msisdnMasked: true, processingMethod: true,
  providerCode: true, active: true, notes: true, lastVerifiedAt: true, lastVerifiedStatus: true, createdAt: true, updatedAt: true,
  receivingServices: { select: { code: true, status: true } },
} as const;

const UpdateSimSchema = z
  .object({
    label: z.string().trim().min(3).max(80),
    msisdn: Msisdn,
    active: z.boolean(),
    notes: z.string().max(2000),
    lastVerifiedStatus: z.string().max(200),
    reason: z.string().trim().min(5).max(500),
  })
  .partial()
  .required({ reason: true })
  .strict(); // rejects any attempt to send a "pin" or other secret field

const RevealSchema = z.object({ reason: z.string().trim().min(5).max(500) });

@ApiTags('admin / sim accounts')
@Controller('admin/sim-accounts')
export class SimAccountsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Four-SIM overview, masked numbers only. */
  @Get()
  @StaffAuth('SIM_READ_MASKED')
  list() {
    return this.prisma.simAccount.findMany({ select: PUBLIC_FIELDS, orderBy: { code: 'asc' } });
  }

  /** Full number for roles that need it. Every reveal is audited with a reason. */
  @Post(':id/reveal')
  @StaffAuth('SIM_READ_FULL')
  async reveal(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(RevealSchema)) body: z.infer<typeof RevealSchema>, @CurrentStaff() staff: StaffPrincipal) {
    const sim = await this.prisma.simAccount.findUnique({ where: { id } });
    if (!sim) throw NotFound('SIM account');
    await this.audit.record({ actorType: 'STAFF', actorId: staff.id, action: 'sim.reveal_number', entityType: 'SimAccount', entityId: id, after: { reason: body.reason } });
    return { id, msisdn: decrypt(sim.msisdnEncrypted, this.env.APP_ENCRYPTION_KEY) };
  }

  @Get(':id/history')
  @StaffAuth('AUDIT_READ')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.auditLog.findMany({ where: { entityType: 'SimAccount', entityId: id }, orderBy: { createdAt: 'desc' } });
  }

  @Patch(':id')
  @StaffAuth('SIM_WRITE')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateSimSchema)) body: z.infer<typeof UpdateSimSchema>, @CurrentStaff() staff: StaffPrincipal) {
    const before = await this.prisma.simAccount.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!before) throw NotFound('SIM account');
    const { reason, msisdn, ...rest } = body;
    const after = await this.prisma.simAccount.update({
      where: { id },
      data: {
        ...rest,
        ...(msisdn ? { msisdnEncrypted: encrypt(msisdn, this.env.APP_ENCRYPTION_KEY), msisdnMasked: maskMsisdn(msisdn) } : {}),
        ...(body.lastVerifiedStatus ? { lastVerifiedAt: new Date() } : {}),
      },
      select: PUBLIC_FIELDS,
    });
    // Audit stores masked values only.
    await this.audit.record({ actorType: 'STAFF', actorId: staff.id, action: 'sim.update', entityType: 'SimAccount', entityId: id, before, after: { ...after, reason } });
    return after;
  }
}

@Module({ controllers: [SimAccountsController] })
export class SimsModule {}
