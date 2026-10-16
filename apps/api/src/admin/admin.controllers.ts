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

const AuditFilters = z.object({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(80).optional(),
  actorId: z.string().max(80).optional(),
  actorType: z.enum(['CUSTOMER', 'STAFF', 'SYSTEM', 'PROVIDER']).optional(),
  /** Matches the start of the action, e.g. "refund." or "staff.login". */
  action: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const AuditQuery = PaginationSchema.merge(AuditFilters);

function auditWhere(q: z.infer<typeof AuditFilters>): Prisma.AuditLogWhereInput {
  return {
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.actorType ? { actorType: q.actorType } : {}),
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
  };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v);
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

@ApiTags('admin / audit')
@Controller('admin/audit-logs')
export class AuditAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @StaffAuth('AUDIT_READ')
  async list(@Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    const where = auditWhere(q);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    const staffIds = [...new Set(items.filter((i) => i.actorType === 'STAFF' && i.actorId).map((i) => i.actorId!))];
    const staff = await this.prisma.staffUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true, email: true } });
    return { page: q.page, pageSize: q.pageSize, total, items, actors: Object.fromEntries(staff.map((s) => [s.id, { name: s.fullName, email: s.email }])) };
  }

  /** CSV of the filtered log (max 50 000 rows). The export itself is audited. */
  @Get('export')
  @StaffAuth('AUDIT_READ')
  async export(@Query(new ZodPipe(AuditFilters)) q: z.infer<typeof AuditFilters>, @CurrentStaff() me: StaffPrincipal, @Res() res: Response) {
    const rows = await this.prisma.auditLog.findMany({ where: auditWhere(q), orderBy: { createdAt: 'desc' }, take: 50_000 });
    const staff = await this.prisma.staffUser.findMany({ select: { id: true, email: true } });
    const email = new Map(staff.map((s) => [s.id, s.email]));
    await this.audit.record({ actorType: 'STAFF', actorId: me.id, action: 'audit.exported', entityType: 'AuditLog', after: { filters: q, rows: rows.length } });
    const head = ['createdAt', 'actorType', 'actor', 'action', 'entityType', 'entityId', 'ip', 'before', 'after'];
    const lines = [head.join(','), ...rows.map((r) => [r.createdAt, r.actorType, r.actorType === 'STAFF' ? (email.get(r.actorId ?? '') ?? r.actorId) : r.actorId, r.action, r.entityType, r.entityId, r.ip, r.before, r.after].map(csvCell).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="amico-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\ufeff' + lines.join('\r\n'));
  }
}
