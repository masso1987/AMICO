import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.service';
import { TransactionStateService } from '../transactions/state.service';
import { ProcessingService } from '../processing/processing.service';
import { Conflict, DomainError, Forbidden, NotFound } from '../common/errors';
import { openRefund } from './open-refund';

const REFUNDABLE_FROM = ['FAILED', 'UNDER_REVIEW'] as const;

/**
 * Refunds: requested by one staff member, approved by another (maker-checker).
 * Money sources are refunded through the provider; airtime sources are returned
 * by staff by hand and confirmed with evidence.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly state: TransactionStateService,
    private readonly processing: ProcessingService,
  ) {}

  async request(transactionId: string, input: { amount?: number; reason: string }, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const txn = await this.state.lock(tx, transactionId);
      return openRefund(tx, { state: this.state, audit: this.audit }, {
        txn, kind: 'STANDARD', amount: input.amount ?? txn.customerPays, reason: input.reason, requestedById: staffId, allowedFrom: REFUNDABLE_FROM,
      });
    });
  }

  async approve(refundId: string, staffId: string) {
    const refund = await this.prisma.$transaction(async (tx) => {
      const r = await tx.refund.findUnique({ where: { id: refundId }, include: { transaction: { include: { service: true } } } });
      if (!r) throw NotFound('Refund');
      if (r.requestedById === staffId) throw Forbidden('MAKER_CHECKER', 'A refund must be approved by someone other than the requester');
      const res = await tx.refund.updateMany({ where: { id: refundId, status: 'REQUESTED' }, data: { status: 'APPROVED', approvedById: staffId, approvedAt: new Date() } });
      if (res.count !== 1) throw Conflict('REFUND_NOT_REQUESTED', `Refund is ${r.status}`);
      await this.audit.record({ actorType: 'STAFF', actorId: staffId, action: 'refund.approve', entityType: 'Refund', entityId: refundId, before: r }, tx);
      return r;
    });
    if (refund.transaction.service.processingMethod === 'API') {
      await this.jobs.enqueue('refund', { refundId }, { jobId: `refund:${refundId}` });
    }
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  /** Airtime-source refunds: staff return the airtime by hand and record what they did. */
  async confirmManual(refundId: string, evidenceNote: string, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.refund.findUnique({ where: { id: refundId }, include: { transaction: { include: { service: true } } } });
      if (!r) throw NotFound('Refund');
      if (r.transaction.service.processingMethod !== 'MANUAL_SOURCE') throw new DomainError('NOT_MANUAL_REFUND', 'This refund is processed through the provider');
      if (r.status !== 'APPROVED') throw Conflict('REFUND_NOT_APPROVED', `Refund is ${r.status}`);
      const txn = await this.state.lock(tx, r.transactionId);
      await tx.refund.update({ where: { id: refundId }, data: { status: 'COMPLETED', evidenceNote } });
      await this.processing.completeRefund(tx, txn, r.transaction.service, r, { type: 'STAFF', id: staffId });
      await this.audit.record({ actorType: 'STAFF', actorId: staffId, action: 'refund.confirm_manual', entityType: 'Refund', entityId: refundId, after: { evidenceNote } }, tx);
      return tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    });
  }
}
