import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.service';
import { TransactionStateService } from '../transactions/state.service';
import { ProcessingService } from '../processing/processing.service';
import { Conflict, DomainError, Forbidden, NotFound } from '../common/errors';

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
      if (!(REFUNDABLE_FROM as readonly string[]).includes(txn.state)) throw Conflict('NOT_REFUNDABLE', `Cannot refund a ${txn.state} transaction`);
      // Only refund what we actually hold: a SOURCE_RECEIVED journal must exist and no payout may have completed.
      const journals = await tx.ledgerJournal.findMany({ where: { transactionId }, select: { kind: true } });
      if (!journals.some((j) => j.kind === 'SOURCE_RECEIVED')) throw new DomainError('NOTHING_RECEIVED', 'No verified source funds are recorded for this transaction');
      if (journals.some((j) => j.kind === 'PAYOUT_COMPLETED')) throw new DomainError('ALREADY_PAID_OUT', 'This transaction was paid out; use an adjustment instead');
      const open = await tx.refund.findFirst({ where: { transactionId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } } });
      if (open) throw Conflict('REFUND_ALREADY_OPEN', 'A refund is already open for this transaction');
      // A payout whose outcome is not final blocks the refund: reconcile first.
      const livePayout = await tx.providerOperation.findFirst({ where: { transactionId, payoutSlot: { not: null }, status: { in: ['REQUESTED', 'PENDING', 'UNKNOWN', 'SUCCEEDED'] } } });
      if (livePayout) throw Conflict('PAYOUT_OUTCOME_UNCERTAIN', 'A payout for this transaction is not confirmed failed. Reconcile with the provider first.');

      const amount = input.amount ?? txn.customerPays;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > txn.customerPays) throw new DomainError('INVALID_REFUND_AMOUNT', `Refund must be between 1 and ${txn.customerPays} FCFA`);
      await this.state.transition(tx, { transactionId, to: 'REFUND_PENDING', actor: { type: 'STAFF', id: staffId }, reason: `Refund requested: ${input.reason}`, locked: txn });
      const refund = await tx.refund.create({ data: { transactionId, amount, reason: input.reason, requestedById: staffId } });
      await this.audit.record({ actorType: 'STAFF', actorId: staffId, action: 'refund.request', entityType: 'Refund', entityId: refund.id, after: refund }, tx);
      return refund;
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
      await this.processing.completeRefund(tx, txn, r.transaction.service, r.amount, { type: 'STAFF', id: staffId });
      await this.audit.record({ actorType: 'STAFF', actorId: staffId, action: 'refund.confirm_manual', entityType: 'Refund', entityId: refundId, after: { evidenceNote } }, tx);
      return tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    });
  }
}
