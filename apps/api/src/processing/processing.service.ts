import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ASSET_META, type ProviderCapability } from '@amico/contracts';
import type { OperationResult, ProviderAdapter } from '@amico/providers';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CapabilityService } from '../providers/providers.module';
import { JobsService, type JobData, type JobName } from '../jobs/jobs.service';
import { TransactionStateService } from '../transactions/state.service';
import { LedgerService, NotificationService } from '../ledger/ledger.service';
import { payoutCompleted, refundCompleted, sourceReceived } from '../ledger/postings';
import type { OperationKind, ProviderOperation, Service, Transaction } from '../generated/prisma/client';

const SYSTEM = { type: 'SYSTEM' as const };
const MAX_STATUS_CHECKS = 5;
const backoffMs = (n: number) => Math.min(60_000 * 2 ** n, 30 * 60_000);

function deliveryKind(service: Pick<Service, 'destinationAsset'>): { kind: OperationKind; capability: ProviderCapability } {
  const k = ASSET_META[service.destinationAsset].kind;
  if (k === 'MOBILE_MONEY') return { kind: 'DISBURSE', capability: 'DISBURSE' };
  if (k === 'AIRTIME') return { kind: 'AIRTIME_TOPUP', capability: 'AIRTIME_TOPUP' };
  return { kind: 'DATA_BUNDLE', capability: 'DATA_BUNDLE' };
}

/**
 * Drives provider operations: collection, payout, status confirmation and refunds.
 *
 * Rules enforced here:
 *  - a provider call is made only after its operation row is committed (so a crash
 *    mid-call leaves a REQUESTED row to reconcile, never a silent movement);
 *  - an UNKNOWN/PENDING outcome is never retried blindly — it is status-queried;
 *  - COMPLETED requires a status query confirming delivery;
 *  - simulated transactions may only use simulated adapters, and vice versa.
 */
@Injectable()
export class ProcessingService implements OnModuleInit {
  private readonly log = new Logger(ProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: CapabilityService,
    private readonly jobs: JobsService,
    private readonly state: TransactionStateService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit() {
    this.jobs.registerHandler((name, data) => this.handle(name, data));
  }

  async handle(name: JobName, data: JobData): Promise<void> {
    switch (name) {
      case 'collect':
        return this.collect(data.transactionId!);
      case 'payout':
        return this.payout(data.transactionId!);
      case 'status':
        return this.checkStatus(data.operationId!);
      case 'refund':
        return this.executeRefund(data.refundId!);
    }
  }

  // ---------------------------------------------------------------- collection (API source)

  async collect(transactionId: string): Promise<void> {
    const txn = await this.prisma.transaction.findUniqueOrThrow({ where: { id: transactionId }, include: { service: true } });
    if (txn.state !== 'AWAITING_SOURCE_PAYMENT') return; // already handled
    const source = ASSET_META[txn.service.sourceAsset];
    const adapter = await this.adapter(txn, { operator: source.operator, capability: 'COLLECT' });

    const op = await this.prisma.$transaction(async (tx) => {
      await this.state.transition(tx, { transactionId, to: 'PAYMENT_PROCESSING', actor: SYSTEM, reason: 'Collection requested', from: ['AWAITING_SOURCE_PAYMENT'] });
      return tx.providerOperation.create({
        data: {
          transactionId, kind: 'COLLECT', operator: source.operator, providerCode: adapter.code,
          idempotencyKey: `${transactionId}:collect`, amount: txn.customerPays, msisdn: txn.senderMsisdn, simulated: adapter.simulated,
        },
      });
    });
    const result = await this.call(() =>
      adapter.collect({ idempotencyKey: op.idempotencyKey, operator: source.operator, msisdn: txn.senderMsisdn, amount: txn.customerPays, narrative: `AMICO ${txn.reference}` }),
    );
    await this.recordInitial(op, result);
  }

  // ---------------------------------------------------------------- payout / delivery

  async payout(transactionId: string): Promise<void> {
    const txn = await this.prisma.transaction.findUniqueOrThrow({ where: { id: transactionId }, include: { service: true } });
    if (txn.state !== 'SOURCE_VERIFIED') return;
    const dest = ASSET_META[txn.service.destinationAsset];
    const { kind, capability } = deliveryKind(txn.service);
    const adapter = await this.adapter(txn, { operator: dest.operator, capability });

    let op: ProviderOperation;
    try {
      op = await this.prisma.$transaction(async (tx) => {
        await this.state.transition(tx, { transactionId, to: 'PAYOUT_PROCESSING', actor: SYSTEM, reason: 'Payout requested', from: ['SOURCE_VERIFIED'] });
        const attempt = (await tx.providerOperation.count({ where: { transactionId, kind } })) + 1;
        return tx.providerOperation.create({
          data: {
            transactionId, kind, operator: dest.operator, providerCode: adapter.code,
            idempotencyKey: `${transactionId}:payout:${attempt}`,
            payoutSlot: transactionId, // unique: a second live payout cannot be created
            amount: txn.payoutInstructionAmount, msisdn: txn.recipientMsisdn, simulated: adapter.simulated,
          },
        });
      });
    } catch (e) {
      this.log.warn(`Payout for ${transactionId} not started: ${(e as Error).message}`);
      return;
    }

    const req = { idempotencyKey: op.idempotencyKey, operator: dest.operator, msisdn: txn.recipientMsisdn, amount: txn.payoutInstructionAmount, narrative: `AMICO ${txn.reference}` };
    const result = await this.call(() =>
      kind === 'DISBURSE' ? adapter.disburse(req) : kind === 'AIRTIME_TOPUP' ? adapter.topUpAirtime(req) : adapter.buyDataBundle({ ...req, bundleCode: `AMOUNT_${req.amount}` }),
    );
    await this.recordInitial(op, result);
  }

  // ---------------------------------------------------------------- refunds

  async executeRefund(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { transaction: { include: { service: true } } } });
    if (refund.status !== 'APPROVED') return;
    const txn = refund.transaction;
    const source = ASSET_META[txn.service.sourceAsset];
    const adapter = await this.adapter(txn, { operator: source.operator, capability: 'DISBURSE' });
    const op = await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refundId }, data: { status: 'PROCESSING' } });
      return tx.providerOperation.create({
        data: {
          transactionId: txn.id, kind: 'REFUND', operator: source.operator, providerCode: adapter.code,
          idempotencyKey: `${refundId}:refund`, amount: refund.amount, msisdn: txn.senderMsisdn, simulated: adapter.simulated,
        },
      });
    });
    const result = await this.call(() =>
      adapter.disburse({ idempotencyKey: op.idempotencyKey, operator: source.operator, msisdn: txn.senderMsisdn, amount: refund.amount, narrative: `AMICO refund ${txn.reference}` }),
    );
    await this.recordInitial(op, result);
  }

  // ---------------------------------------------------------------- status confirmation

  /** The only place an operation is declared final. Never trusts a callback or a first response alone. */
  async checkStatus(operationId: string): Promise<void> {
    const op = await this.prisma.providerOperation.findUniqueOrThrow({ where: { id: operationId } });
    if (op.status === 'SUCCEEDED' || op.status === 'FAILED') {
      // Final at operation level; make sure the transaction caught up (idempotent).
      if (op.status === 'SUCCEEDED') await this.onConfirmedSuccess(op);
      return;
    }
    const txn = await this.prisma.transaction.findUniqueOrThrow({ where: { id: op.transactionId } });
    const adapter = await this.adapter(txn, { operator: op.operator, capability: 'STATUS_QUERY' }).catch(() => null);
    const result: OperationResult = adapter
      ? await this.call(() => adapter.queryStatus(op.idempotencyKey))
      : { status: 'UNKNOWN', providerReference: null, failureReason: 'Status query capability unavailable', simulated: op.simulated };

    if (result.status === 'SUCCEEDED') {
      const updated = await this.prisma.providerOperation.update({
        where: { id: op.id },
        data: { status: 'SUCCEEDED', providerReference: result.providerReference ?? op.providerReference, statusChecks: { increment: 1 } },
      });
      await this.onConfirmedSuccess(updated);
    } else if (result.status === 'FAILED') {
      await this.onConfirmedFailure(op, result.failureReason ?? 'Provider reported failure');
    } else {
      const checks = op.statusChecks + 1;
      await this.prisma.providerOperation.update({ where: { id: op.id }, data: { status: result.status, statusChecks: checks } });
      if (checks >= MAX_STATUS_CHECKS) {
        await this.escalateUncertain(op, checks);
      } else {
        await this.jobs.enqueue('status', { operationId: op.id }, { jobId: `status:${op.id}:${checks}`, delayMs: backoffMs(checks) });
      }
    }
  }

  private async onConfirmedSuccess(op: ProviderOperation) {
    const sourceJustVerified = await this.prisma.$transaction(async (tx) => {
      const txn = await this.state.lock(tx, op.transactionId);
      const service = await tx.service.findUniqueOrThrow({ where: { id: txn.serviceId } });
      const book = txn.isSimulated ? 'SIMULATED' : 'REAL';

      if (op.kind === 'COLLECT') {
        if (txn.state !== 'PAYMENT_PROCESSING' && txn.state !== 'UNDER_REVIEW') return false;
        await this.state.transition(tx, { transactionId: txn.id, to: 'SOURCE_VERIFIED', actor: { type: 'PROVIDER' }, reason: 'Collection confirmed by status query', locked: txn, metadata: { operationId: op.id, providerReference: op.providerReference } });
        await this.ledger.post(tx, { book, kind: 'SOURCE_RECEIVED', transactionId: txn.id, memo: `Collection ${op.providerReference}`, lines: sourceReceived({ sourceAsset: service.sourceAsset, customerPays: txn.customerPays }) });
        await this.notifications.notify(tx, { customerId: txn.customerId, transactionId: txn.id, kind: 'PAYMENT_CONFIRMED', title: 'Payment received', body: `We received ${txn.customerPays} FCFA for ${txn.reference}.` });
        return true;
      } else if (op.kind === 'REFUND') {
        const refund = await tx.refund.findFirst({ where: { transactionId: txn.id, status: 'PROCESSING' } });
        if (!refund || txn.state !== 'REFUND_PENDING') return false;
        await tx.refund.update({ where: { id: refund.id }, data: { status: 'COMPLETED' } });
        await this.completeRefund(tx, txn, service, refund.amount, { type: 'PROVIDER' });
        return false;
      } else {
        if (txn.state === 'COMPLETED') return false;
        let current = txn;
        if (current.state === 'PAYOUT_PROCESSING' || current.state === 'UNDER_REVIEW') {
          current = await this.state.transition(tx, { transactionId: txn.id, to: 'DELIVERY_PENDING', actor: { type: 'PROVIDER' }, reason: 'Provider accepted delivery', locked: current, metadata: { operationId: op.id } });
        }
        if (current.state !== 'DELIVERY_PENDING') return false;
        await this.state.transition(tx, { transactionId: txn.id, to: 'COMPLETED', actor: { type: 'PROVIDER' }, reason: 'Delivery verified by status query', locked: current, metadata: { operationId: op.id, providerReference: op.providerReference } });
        await this.ledger.post(tx, {
          book, kind: 'PAYOUT_COMPLETED', transactionId: txn.id, memo: `Delivery ${op.providerReference}`,
          lines: payoutCompleted({
            destinationAsset: service.destinationAsset, customerPays: txn.customerPays, payoutInstructionAmount: txn.payoutInstructionAmount,
            platformFee: txn.platformFee, providerFee: txn.providerFee, providerFeeCollectedBy: txn.providerFeeCollectedBy,
          }),
        });
        await this.notifications.notify(tx, {
          customerId: txn.customerId, transactionId: txn.id, kind: 'COMPLETED', title: txn.isSimulated ? 'SIMULATION — transfer completed' : 'Transfer completed',
          body: `${txn.expectedDelivered} FCFA delivered to ${txn.recipientMsisdn}. Reference ${txn.reference}.${txn.isSimulated ? ' This was a simulation: no real money moved.' : ''}`,
        });
        return false;
      }
    });
    if (sourceJustVerified) await this.jobs.enqueue('payout', { transactionId: op.transactionId }, { jobId: `payout:${op.transactionId}` });
  }

  private async onConfirmedFailure(op: ProviderOperation, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      // Releasing the payout slot is what allows a later, deliberate retry.
      await tx.providerOperation.update({ where: { id: op.id }, data: { status: 'FAILED', failureReason: reason, payoutSlot: null, statusChecks: { increment: 1 } } });
      const txn = await this.state.lock(tx, op.transactionId);
      if (op.kind === 'COLLECT') {
        if (txn.state === 'PAYMENT_PROCESSING' || txn.state === 'UNDER_REVIEW') {
          await this.state.transition(tx, { transactionId: txn.id, to: 'REJECTED', actor: { type: 'PROVIDER' }, reason: `Collection failed: ${reason}`, locked: txn });
          await this.notifications.notify(tx, { customerId: txn.customerId, transactionId: txn.id, kind: 'REJECTED', title: 'Payment not completed', body: `Your payment for ${txn.reference} did not go through. No money was taken.` });
        }
      } else if (op.kind === 'REFUND') {
        await tx.refund.updateMany({ where: { transactionId: txn.id, status: 'PROCESSING' }, data: { status: 'FAILED' } });
        if (txn.state === 'REFUND_PENDING') await this.state.transition(tx, { transactionId: txn.id, to: 'UNDER_REVIEW', actor: { type: 'PROVIDER' }, reason: `Refund failed: ${reason}`, locked: txn });
      } else if (['PAYOUT_PROCESSING', 'DELIVERY_PENDING', 'UNDER_REVIEW'].includes(txn.state)) {
        await this.state.transition(tx, { transactionId: txn.id, to: 'FAILED', actor: { type: 'PROVIDER' }, reason: `Delivery failed: ${reason}`, locked: txn });
        await this.notifications.notify(tx, { customerId: txn.customerId, transactionId: txn.id, kind: 'FAILED', title: 'Delivery failed', body: `Delivery for ${txn.reference} failed. Our team will refund or retry it.` });
      }
    });
  }

  private async escalateUncertain(op: ProviderOperation, checks: number) {
    await this.prisma.$transaction(async (tx) => {
      const txn = await this.state.lock(tx, op.transactionId);
      if (['PAYMENT_PROCESSING', 'PAYOUT_PROCESSING', 'DELIVERY_PENDING', 'REFUND_PENDING'].includes(txn.state)) {
        await this.state.transition(tx, {
          transactionId: txn.id, to: 'UNDER_REVIEW', actor: SYSTEM, locked: txn,
          reason: `Outcome still uncertain after ${checks} status checks. Reconcile with the provider before any retry.`,
          metadata: { operationId: op.id },
        });
      }
    });
  }

  async completeRefund(tx: Tx, txn: Transaction, service: Service, amount: number, actor: { type: 'PROVIDER' | 'STAFF'; id?: string }) {
    await this.state.transition(tx, { transactionId: txn.id, to: 'REFUNDED', actor, reason: 'Refund completed', locked: txn });
    await this.ledger.post(tx, { book: txn.isSimulated ? 'SIMULATED' : 'REAL', kind: 'REFUND_COMPLETED', transactionId: txn.id, memo: `Refund ${txn.reference}`, lines: refundCompleted({ sourceAsset: service.sourceAsset, amount }), createdById: actor.id ?? null });
    await this.notifications.notify(tx, { customerId: txn.customerId, transactionId: txn.id, kind: 'REFUNDED', title: 'Refund completed', body: `${amount} FCFA was refunded for ${txn.reference}.` });
  }

  // ---------------------------------------------------------------- helpers

  private async recordInitial(op: ProviderOperation, result: OperationResult) {
    if (result.status === 'FAILED') {
      await this.onConfirmedFailure(op, result.failureReason ?? 'Provider declined');
      return;
    }
    await this.prisma.providerOperation.update({
      where: { id: op.id },
      // Even a synchronous SUCCEEDED is held as PENDING until a status query confirms it.
      data: { status: result.status === 'SUCCEEDED' ? 'PENDING' : result.status, providerReference: result.providerReference },
    });
    await this.jobs.enqueue('status', { operationId: op.id }, { jobId: `status:${op.id}:0`, delayMs: result.status === 'SUCCEEDED' ? 0 : backoffMs(0) });
  }

  /** Any thrown error from a provider call is an UNKNOWN outcome, never a failure. */
  private async call(fn: () => Promise<OperationResult>): Promise<OperationResult> {
    try {
      return await fn();
    } catch (e) {
      return { status: 'UNKNOWN', providerReference: null, failureReason: (e as Error).message, simulated: false };
    }
  }

  private async adapter(txn: Pick<Transaction, 'isSimulated'>, req: { operator: 'MTN' | 'ORANGE'; capability: ProviderCapability }): Promise<ProviderAdapter> {
    const adapter = await this.capabilities.adapterFor(req);
    if (adapter.simulated !== txn.isSimulated) {
      throw new Error(`Refusing to mix simulated and real processing (${adapter.code}, txn simulated=${txn.isSimulated})`);
    }
    return adapter;
  }
}
