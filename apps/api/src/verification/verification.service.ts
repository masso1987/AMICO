import { Injectable } from '@nestjs/common';
import type { VerificationDecisionInput } from '@amico/contracts';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationService } from '../messaging/notifications.service';
import { CancellationService } from '../refunds/cancellation.service';
import { TransactionStateService } from '../transactions/state.service';
import { sourceReceived } from '../ledger/postings';
import { Conflict, DomainError, Forbidden, NotFound } from '../common/errors';
import type { ManualVerification, Transaction } from '../generated/prisma/client';

const OPEN_FOR_DECISION = ['PENDING', 'ON_HOLD', 'ESCALATED'] as const;

/**
 * Staff verification of airtime received on a normal SIM.
 * - Staff record the amount they actually see on the SIM and what they checked.
 * - Any difference from the expected amount puts the transaction on hold.
 * - High-risk transactions need a second, different approver.
 * - Every action carries the record version; a stale or duplicate click gets 409.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
    private readonly state: TransactionStateService,
    private readonly cancellation: CancellationService,
  ) {}

  queue(status: string[]) {
    return this.prisma.manualVerification.findMany({
      where: { status: { in: status as never } },
      orderBy: { submittedAt: 'asc' },
      include: {
        transaction: {
          select: {
            id: true, reference: true, state: true, createdAt: true, customerPays: true, riskLevel: true, isSimulated: true, senderMsisdn: true,
            service: { select: { code: true, name: true, sourceAsset: true } },
          },
        },
      },
    });
  }

  async detail(id: string) {
    const mv = await this.prisma.manualVerification.findUnique({ where: { id }, include: { transaction: { include: { service: true, history: { orderBy: { createdAt: 'asc' } } } } } });
    if (!mv) throw NotFound('Verification');
    const sim = await this.prisma.simAccount.findUniqueOrThrow({ where: { id: mv.receivingSimId }, select: { code: true, label: true, operator: true, msisdnMasked: true } });
    const audit = await this.prisma.auditLog.findMany({ where: { entityType: 'ManualVerification', entityId: id }, orderBy: { createdAt: 'asc' } });
    return { ...mv, receivingSim: sim, audit };
  }

  async decide(id: string, expectedVersion: number, input: VerificationDecisionInput, staffId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const mv = await this.claim(tx, id, expectedVersion);
      if (!(OPEN_FOR_DECISION as readonly string[]).includes(mv.status)) throw Conflict('VERIFICATION_CLOSED', `Verification is ${mv.status}`);
      const txn = await this.state.lock(tx, mv.transactionId);
      const actor = { type: 'STAFF' as const, id: staffId };

      if (input.decision === 'NOT_RECEIVED') {
        await tx.manualVerification.update({ where: { id }, data: { status: 'REJECTED', reason: input.reason, firstReviewerId: staffId, firstReviewedAt: new Date() } });
        await this.state.transition(tx, { transactionId: txn.id, to: 'REJECTED', actor, reason: `Airtime not received: ${input.reason}`, locked: txn });
        await this.notifications.notify(tx, { customerId: txn.customerId, transactionId: txn.id, kind: 'NOT_RECEIVED', params: { ref: txn.reference } });
        await this.log(tx, staffId, 'verification.not_received', mv, { reason: input.reason });
        return 'REJECTED' as const;
      }

      if (input.decision === 'ESCALATE') {
        await tx.manualVerification.update({ where: { id }, data: { status: 'ESCALATED', reason: input.reason } });
        if (txn.state !== 'UNDER_REVIEW') await this.state.transition(tx, { transactionId: txn.id, to: 'UNDER_REVIEW', actor, reason: `Escalated: ${input.reason}`, locked: txn });
        await this.log(tx, staffId, 'verification.escalate', mv, { reason: input.reason });
        return 'ESCALATED' as const;
      }

      // CONFIRM_RECEIVED
      const base = { receivedAmount: input.receivedAmount, evidenceNote: input.evidenceNote, firstReviewerId: staffId, firstReviewedAt: new Date() };
      if (input.receivedAmount !== mv.expectedAmount) {
        await tx.manualVerification.update({ where: { id }, data: { ...base, status: 'ON_HOLD', reason: `Received ${input.receivedAmount} FCFA, expected ${mv.expectedAmount} FCFA` } });
        if (txn.state !== 'UNDER_REVIEW') {
          await this.state.transition(tx, { transactionId: txn.id, to: 'UNDER_REVIEW', actor, locked: txn, reason: `Amount mismatch: received ${input.receivedAmount}, expected ${mv.expectedAmount}. Held for investigation; no payout.` });
        }
        await this.log(tx, staffId, 'verification.amount_mismatch', mv, base);
        return 'ON_HOLD' as const;
      }

      if (mv.requiresDualApproval) {
        await tx.manualVerification.update({ where: { id }, data: { ...base, status: 'AWAITING_SECOND_APPROVAL' } });
        await this.log(tx, staffId, 'verification.first_approval', mv, base);
        return 'AWAITING_SECOND_APPROVAL' as const;
      }

      await tx.manualVerification.update({ where: { id }, data: { ...base, status: 'CONFIRMED' } });
      const paidOut = await this.markSourceVerified(tx, txn, staffId, input.evidenceNote);
      await this.log(tx, staffId, 'verification.confirm', mv, base);
      return paidOut ? ('CONFIRMED' as const) : ('CANCELLED' as const);
    });

    if (outcome === 'CONFIRMED') await this.enqueuePayout(id);
    return this.detail(id);
  }

  /** Second approver independently records what they see; it must match. */
  async secondApproval(id: string, expectedVersion: number, input: { receivedAmount: number; evidenceNote: string }, staffId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const mv = await this.claim(tx, id, expectedVersion);
      if (mv.status !== 'AWAITING_SECOND_APPROVAL') throw Conflict('NOT_AWAITING_SECOND_APPROVAL', `Verification is ${mv.status}`);
      if (mv.firstReviewerId === staffId) throw Forbidden('DUAL_APPROVAL_SAME_PERSON', 'The second approval must come from a different staff member');
      const txn = await this.state.lock(tx, mv.transactionId);

      if (input.receivedAmount !== mv.expectedAmount || input.receivedAmount !== mv.receivedAmount) {
        await tx.manualVerification.update({ where: { id }, data: { status: 'ON_HOLD', reason: `Second approver saw ${input.receivedAmount} FCFA (first: ${mv.receivedAmount}, expected: ${mv.expectedAmount})` } });
        await this.state.transition(tx, { transactionId: txn.id, to: 'UNDER_REVIEW', actor: { type: 'STAFF', id: staffId }, locked: txn, reason: 'Approvers disagree on the amount received. Held for investigation.' });
        await this.log(tx, staffId, 'verification.second_approval_mismatch', mv, input);
        return 'ON_HOLD' as const;
      }
      await tx.manualVerification.update({ where: { id }, data: { status: 'CONFIRMED', secondApproverId: staffId, secondApprovedAt: new Date() } });
      const paidOut = await this.markSourceVerified(tx, txn, staffId, input.evidenceNote);
      await this.log(tx, staffId, 'verification.second_approval', mv, input);
      return paidOut ? ('CONFIRMED' as const) : ('CANCELLED' as const);
    });
    if (outcome === 'CONFIRMED') await this.enqueuePayout(id);
    return this.detail(id);
  }

  /** Optimistic claim: only the holder of the current version may act. */
  private async claim(tx: Tx, id: string, expectedVersion: number): Promise<ManualVerification> {
    const res = await tx.manualVerification.updateMany({ where: { id, version: expectedVersion }, data: { version: { increment: 1 } } });
    if (res.count !== 1) {
      const exists = await tx.manualVerification.findUnique({ where: { id }, select: { version: true } });
      if (!exists) throw NotFound('Verification');
      throw Conflict('STALE_OR_DUPLICATE_ACTION', 'This verification was already acted on. Reload and review the current state.');
    }
    return tx.manualVerification.findUniqueOrThrow({ where: { id } });
  }

  /** Returns false when the customer had cancelled: a refund (minus fee) was opened instead of a payout. */
  private async markSourceVerified(tx: Tx, txn: Transaction, staffId: string, evidenceNote: string): Promise<boolean> {
    if (!['AWAITING_MANUAL_VERIFICATION', 'UNDER_REVIEW'].includes(txn.state)) throw new DomainError('STATE_CHANGED', `Transaction is ${txn.state}`);
    const service = await tx.service.findUniqueOrThrow({ where: { id: txn.serviceId } });
    const verified = await this.state.transition(tx, { transactionId: txn.id, to: 'SOURCE_VERIFIED', actor: { type: 'STAFF', id: staffId }, locked: txn, reason: 'Airtime receipt verified on receiving SIM', metadata: { evidenceNote } });
    await this.ledger.post(tx, {
      book: txn.isSimulated ? 'SIMULATED' : 'REAL', kind: 'SOURCE_RECEIVED', transactionId: txn.id, createdById: staffId,
      memo: `Manual airtime receipt verified`, lines: sourceReceived({ sourceAsset: service.sourceAsset, customerPays: txn.customerPays }),
    });
    if (await this.cancellation.refundIfCancelled(tx, verified)) return false;
    await this.notifications.notify(tx, { customerId: txn.customerId, transactionId: txn.id, kind: 'SOURCE_CONFIRMED', params: { ref: txn.reference, amount: txn.customerPays, sim: txn.isSimulated } });
    return true;
  }

  private async enqueuePayout(verificationId: string) {
    const mv = await this.prisma.manualVerification.findUniqueOrThrow({ where: { id: verificationId }, select: { transactionId: true } });
    await this.jobs.enqueue('payout', { transactionId: mv.transactionId }, { jobId: `payout:${mv.transactionId}` });
  }

  private log(tx: Tx, staffId: string, action: string, before: ManualVerification, after: unknown) {
    return this.audit.record({ actorType: 'STAFF', actorId: staffId, action, entityType: 'ManualVerification', entityId: before.id, before, after }, tx);
  }
}
