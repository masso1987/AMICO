import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { PaginationSchema, PositiveFcfa, VerificationDecisionSchema, type VerificationDecisionInput } from '@amico/contracts';
import { ENV, type Env } from '../config/env';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { NotFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { VerificationService } from '../verification/verification.service';
import { RefundsService } from '../refunds/refunds.service';
import type { Prisma } from '../generated/prisma/client';

const VersionQuery = z.object({ version: z.coerce.number().int().min(0) });
const SecondApprovalSchema = z.object({ receivedAmount: PositiveFcfa, evidenceNote: z.string().trim().min(10).max(1000) });
const QueueQuery = z.object({ status: z.string().default('PENDING,AWAITING_SECOND_APPROVAL,ON_HOLD,ESCALATED') });

@ApiTags('admin / manual verification')
@Controller('admin/verifications')
export class VerificationAdminController {
  constructor(
    private readonly verification: VerificationService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @StaffAuth('VERIFY_MANUAL')
  queue(@Query(new ZodPipe(QueueQuery)) q: z.infer<typeof QueueQuery>) {
    return this.verification.queue(q.status.split(','));
  }

  @Get(':id')
  @StaffAuth('VERIFY_MANUAL')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.verification.detail(id);
  }

  /** `?version=` must be the version the reviewer was looking at; duplicates and stale clicks get 409. */
  @Post(':id/decision')
  @StaffAuth('VERIFY_MANUAL')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(VersionQuery)) q: z.infer<typeof VersionQuery>,
    @Body(new ZodPipe(VerificationDecisionSchema)) body: VerificationDecisionInput,
    @CurrentStaff() staff: StaffPrincipal,
  ) {
    return this.verification.decide(id, q.version, body, staff.id);
  }

  @Post(':id/second-approval')
  @StaffAuth('VERIFY_SECOND_APPROVAL')
  second(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(VersionQuery)) q: z.infer<typeof VersionQuery>,
    @Body(new ZodPipe(SecondApprovalSchema)) body: z.infer<typeof SecondApprovalSchema>,
    @CurrentStaff() staff: StaffPrincipal,
  ) {
    return this.verification.secondApproval(id, q.version, body, staff.id);
  }

  /** Streams a customer evidence file to a reviewer. Every view is audited. */
  @Get('evidence/:fileId')
  @StaffAuth('VERIFY_MANUAL')
  async evidence(@Param('fileId', ParseUUIDPipe) fileId: string, @CurrentStaff() staff: StaffPrincipal, @Res() res: Response) {
    const f = await this.prisma.evidenceFile.findUnique({ where: { id: fileId } });
    if (!f) throw NotFound('Evidence file');
    await this.audit.record({ actorType: 'STAFF', actorId: staff.id, action: 'evidence.view', entityType: 'EvidenceFile', entityId: fileId });
    const root = resolve(this.env.UPLOAD_DIR);
    const path = resolve(join(root, f.storageKey));
    if (!path.startsWith(root)) throw NotFound('Evidence file');
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline');
    createReadStream(path).pipe(res);
  }
}

const TxQuery = PaginationSchema.extend({
  state: z.string().optional(),
  serviceCode: z.string().optional(),
  search: z.string().trim().max(40).optional(),
  simulated: z.enum(['true', 'false']).optional(),
});

@ApiTags('admin / transactions')
@Controller('admin/transactions')
export class TransactionsAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundsService,
  ) {}

  /** Processing and exception queues: filter by state, e.g. ?state=UNDER_REVIEW,FAILED,REFUND_PENDING */
  @Get()
  @StaffAuth('TRANSACTION_READ')
  async list(@Query(new ZodPipe(TxQuery)) q: z.infer<typeof TxQuery>) {
    const where: Prisma.TransactionWhereInput = {
      ...(q.state ? { state: { in: q.state.split(',') as never } } : {}),
      ...(q.serviceCode ? { service: { code: q.serviceCode } } : {}),
      ...(q.simulated ? { isSimulated: q.simulated === 'true' } : {}),
      ...(q.search ? { OR: [{ reference: { contains: q.search.toUpperCase() } }, { recipientMsisdn: { contains: q.search } }, { senderMsisdn: { contains: q.search } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { service: { select: { code: true } } } }),
      this.prisma.transaction.count({ where }),
    ]);
    return { page: q.page, pageSize: q.pageSize, total, items };
  }

  @Get(':id')
  @StaffAuth('TRANSACTION_READ')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const t = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        service: true, quote: true, manualVerification: true, refunds: true,
        history: { orderBy: { createdAt: 'asc' } },
        operations: { orderBy: { createdAt: 'asc' } },
        journals: { include: { entries: { include: { account: { select: { code: true } } } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!t) throw NotFound('Transaction');
    return t;
  }

  @Post(':id/refunds')
  @StaffAuth('REFUND_REQUEST')
  requestRefund(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ amount: PositiveFcfa.optional(), reason: z.string().trim().min(10).max(500) }))) body: { amount?: number; reason: string }, @CurrentStaff() staff: StaffPrincipal) {
    return this.refunds.request(id, body, staff.id);
  }
}

@ApiTags('admin / refunds')
@Controller('admin/refunds')
export class RefundsAdminController {
  constructor(
    private readonly refunds: RefundsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @StaffAuth('REFUND_REQUEST')
  list() {
    return this.prisma.refund.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { transaction: { select: { reference: true, state: true } } } });
  }

  @Post(':id/approve')
  @StaffAuth('REFUND_APPROVE')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: StaffPrincipal) {
    return this.refunds.approve(id, staff.id);
  }

  @Post(':id/confirm-manual')
  @StaffAuth('REFUND_REQUEST')
  confirmManual(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ evidenceNote: z.string().trim().min(10).max(1000) }))) body: { evidenceNote: string }, @CurrentStaff() staff: StaffPrincipal) {
    return this.refunds.confirmManual(id, body.evidenceNote, staff.id);
  }
}

const AuditQuery = PaginationSchema.extend({ entityType: z.string().optional(), entityId: z.string().optional(), actorId: z.string().optional() });

@ApiTags('admin / audit')
@Controller('admin/audit-logs')
export class AuditAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @StaffAuth('AUDIT_READ')
  async list(@Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    const where = { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.actorId ? { actorId: q.actorId } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { page: q.page, pageSize: q.pageSize, total, items };
  }
}
