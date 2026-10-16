import type { Tx } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { TransactionStateService } from '../transactions/state.service';
import { Conflict, DomainError } from '../common/errors';
import type { Refund, Transaction } from '../generated/prisma/client';

export type RefundKind = 'STANDARD' | 'FAILURE' | 'CANCELLATION';

/**
 * Opens a refund on a locked transaction, with every money check in one place:
 *  - only funds we verifiably hold (a SOURCE_RECEIVED journal, no completed payout);
 *  - never two open refunds;
 *  - never while a payout's outcome is uncertain;
 *  - amount + fee retained never exceeds what the customer paid.
 * Requester "SYSTEM" (automatic refunds) still needs one staff approval to pay out.
 */
export async function openRefund(
  tx: Tx,
  deps: { state: TransactionStateService; audit: AuditService },
  args: { txn: Transaction; kind: RefundKind; amount: number; feeRetained?: number; reason: string; requestedById: string; allowedFrom: readonly string[] },
): Promise<Refund> {
  const { txn } = args;
  const fee = args.feeRetained ?? 0;
  if (!args.allowedFrom.includes(txn.state)) throw Conflict('NOT_REFUNDABLE', `Cannot refund a ${txn.state} transaction`);
  const journals = await tx.ledgerJournal.findMany({ where: { transactionId: txn.id }, select: { kind: true } });
  if (!journals.some((j) => j.kind === 'SOURCE_RECEIVED')) throw new DomainError('NOTHING_RECEIVED', 'No verified source funds are recorded for this transaction');
  if (journals.some((j) => j.kind === 'PAYOUT_COMPLETED')) throw new DomainError('ALREADY_PAID_OUT', 'This transaction was paid out; use an adjustment instead');
  const open = await tx.refund.findFirst({ where: { transactionId: txn.id, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } } });
  if (open) throw Conflict('REFUND_ALREADY_OPEN', 'A refund is already open for this transaction');
  const livePayout = await tx.providerOperation.findFirst({ where: { transactionId: txn.id, payoutSlot: { not: null }, status: { in: ['REQUESTED', 'PENDING', 'UNKNOWN', 'SUCCEEDED'] } } });
  if (livePayout) throw Conflict('PAYOUT_OUTCOME_UNCERTAIN', 'A payout for this transaction is not confirmed failed. Reconcile with the provider first.');
  if (!Number.isSafeInteger(args.amount) || args.amount <= 0 || !Number.isSafeInteger(fee) || fee < 0 || args.amount + fee > txn.customerPays) {
    throw new DomainError('INVALID_REFUND_AMOUNT', `Refund must be between 1 and ${txn.customerPays - fee} FCFA`);
  }
  const actor = args.requestedById === 'SYSTEM' ? { type: 'SYSTEM' as const } : { type: 'STAFF' as const, id: args.requestedById };
  await deps.state.transition(tx, { transactionId: txn.id, to: 'REFUND_PENDING', actor, reason: `Refund requested: ${args.reason}`, locked: txn });
  const refund = await tx.refund.create({
    data: { transactionId: txn.id, amount: args.amount, feeRetained: fee, kind: args.kind, reason: args.reason, requestedById: args.requestedById },
  });
  await deps.audit.record(
    { actorType: actor.type, actorId: args.requestedById === 'SYSTEM' ? null : args.requestedById, action: 'refund.request', entityType: 'Refund', entityId: refund.id, after: refund },
    tx,
  );
  return refund;
}

/** Cancellation fee in whole FCFA, rounded up (in the platform's favour, as fees are). */
export function cancellationFee(amount: number, feeBps: number): number {
  return Math.min(amount, Math.ceil((amount * feeBps) / 10_000));
}
