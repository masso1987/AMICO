import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ASSET_META, productGroupOf, type SubmitSourceReferenceInput } from '@amico/contracts';
import { checkQuoteAcceptable } from '@amico/pricing';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogueService } from '../catalogue/catalogue.module';
import { PricingService } from '../pricing/pricing.service';
import { JobsService } from '../jobs/jobs.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.module';
import { NotificationService } from '../messaging/notifications.service';
import { CancellationService } from '../refunds/cancellation.service';
import { MaintenanceService } from '../maintenance/maintenance.module';
import { cancellationFee } from '../refunds/open-refund';
import { TransactionStateService } from './state.service';
import { Conflict, DomainError, NotFound } from '../common/errors';
import { decrypt } from '../common/crypto';
import type { Prisma, Transaction } from '../generated/prisma/client';

const CUSTOMER = (id: string) => ({ type: 'CUSTOMER' as const, id });

function newReference(): string {
  // AMC-XXXX-XXXX, unambiguous alphabet.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `AMC-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogue: CatalogueService,
    private readonly pricing: PricingService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly state: TransactionStateService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly cancellation: CancellationService,
    private readonly maintenance: MaintenanceService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Accepts a quote and opens a transaction. Idempotent per (customer, Idempotency-Key):
   * a replay returns the same transaction; the same key with another quote is refused.
   */
  async createFromQuote(customerId: string, idempotencyKey: string, quoteId: string) {
    const existing = await this.prisma.transaction.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey } } });
    if (existing) {
      if (existing.quoteId !== quoteId) throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request', HttpStatus.UNPROCESSABLE_ENTITY);
      return this.present(existing.id, customerId);
    }

    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId }, include: { service: true, transaction: { select: { id: true } } } });
    if (!quote || quote.customerId !== customerId) throw NotFound('Quote');
    if (quote.transaction) throw Conflict('QUOTE_ALREADY_USED', 'This quote has already been accepted');

    // Service must still be usable, and the quoted terms must still be the terms in force.
    await this.maintenance.assertOpen(quote.service.code);
    const service = await this.catalogue.getUsableService(quote.service.code);
    if (quote.bundleId) {
      const bundle = await this.prisma.bundle.findUnique({ where: { id: quote.bundleId } });
      if (!bundle || !bundle.active || bundle.deletedAt || bundle.withdrawnAt) throw Conflict('BUNDLE_UNAVAILABLE', 'This bundle is no longer available. Choose another one.');
      if (bundle.price !== quote.amount) throw Conflict('BUNDLE_PRICE_CHANGED', 'The operator changed this bundle’s price. Get a new quote.');
    }
    const rule = await this.pricing.activeRule(service.id);
    const pf = await this.pricing.providerFee(service, quote.amount);
    const check = checkQuoteAcceptable({
      expiresAt: quote.expiresAt,
      now: new Date(),
      quotedRuleVersion: quote.pricingRuleVersion,
      // Versions are unique per service, so a different rule always means a different version.
      currentRuleVersion: rule?.version ?? null,
      quotedProviderFeeRuleVersion: quote.providerFeeRuleVersion,
      currentProviderFeeRuleVersion: pf.ruleVersion,
    });
    if (!check.acceptable) throw Conflict(check.code, check.message);
    if (quote.isSimulated !== this.env.SIMULATION_MODE) throw Conflict('QUOTE_MODE_MISMATCH', 'Quote was issued in a different processing mode');

    const b = quote.breakdown as { providerFee: { collectedBy: string }; payoutInstructionAmount: number };
    const riskLevel = quote.customerPays >= service.dualApprovalThreshold ? 'HIGH' : 'LOW';
    const manual = service.processingMethod === 'MANUAL_SOURCE';

    let txn: Transaction;
    try {
      txn = await this.prisma.$transaction(async (tx) => {
        const created = await tx.transaction.create({
          data: {
            reference: newReference(), customerId, serviceId: service.id, quoteId: quote.id, state: 'CREATED', idempotencyKey,
            acceptedTerms: { quote: quote.breakdown, pricingRuleId: quote.pricingRuleId, pricingRuleVersion: quote.pricingRuleVersion, providerFeeRuleId: quote.providerFeeRuleId, providerFeeRuleVersion: quote.providerFeeRuleVersion, acceptedAt: new Date().toISOString() } as Prisma.InputJsonValue,
            amount: quote.amount, customerPays: quote.customerPays, platformFee: quote.platformFee, providerFee: quote.providerFee,
            providerFeeCollectedBy: b.providerFee.collectedBy, payoutInstructionAmount: b.payoutInstructionAmount, expectedDelivered: quote.expectedDelivered,
            senderMsisdn: quote.senderMsisdn, recipientMsisdn: quote.recipientMsisdn, receivingSimId: manual ? service.receivingSimId : null,
            riskLevel, isSimulated: quote.isSimulated, bundleId: quote.bundleId,
          },
        });
        await tx.transactionStateHistory.create({ data: { transactionId: created.id, toState: 'CREATED', actorType: 'CUSTOMER', actorId: customerId, reason: 'Transaction opened from quote' } });
        let t = await this.state.transition(tx, { transactionId: created.id, to: 'QUOTE_PENDING_CONFIRMATION', actor: CUSTOMER(customerId), reason: 'Quote attached for confirmation' });
        t = await this.state.transition(tx, { transactionId: created.id, to: 'AWAITING_SOURCE_PAYMENT', actor: CUSTOMER(customerId), reason: 'Customer accepted the quoted terms', locked: t });
        if (manual) {
          await tx.manualVerification.create({
            data: { transactionId: created.id, expectedAmount: quote.customerPays, receivingSimId: service.receivingSimId!, requiresDualApproval: riskLevel === 'HIGH', evidenceFileIds: [] },
          });
        }
        await this.audit.record({ actorType: 'CUSTOMER', actorId: customerId, action: 'transaction.create', entityType: 'Transaction', entityId: created.id, after: { reference: created.reference, quoteId } }, tx);
        return t;
      });
    } catch (e) {
      // Concurrent replay of the same key or quote: return the winner.
      if ((e as { code?: string }).code === 'P2002') {
        const again = await this.prisma.transaction.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey } } });
        if (again) return this.present(again.id, customerId);
        throw Conflict('QUOTE_ALREADY_USED', 'This quote has already been accepted');
      }
      throw e;
    }

    if (!manual) await this.jobs.enqueue('collect', { transactionId: txn.id }, { jobId: `collect:${txn.id}` });
    return this.present(txn.id, customerId);
  }

  /** Step 6 of the manual flow. The reference is recorded; it proves nothing on its own. */
  async submitSourceReference(customerId: string, transactionId: string, input: SubmitSourceReferenceInput) {
    const files = input.evidenceFileIds.length
      ? await this.prisma.evidenceFile.findMany({ where: { id: { in: input.evidenceFileIds }, customerId } })
      : [];
    if (files.length !== input.evidenceFileIds.length) throw new DomainError('EVIDENCE_NOT_FOUND', 'One or more evidence files were not found');

    await this.prisma.$transaction(async (tx) => {
      const txn = await this.state.lock(tx, transactionId);
      if (txn.customerId !== customerId) throw NotFound('Transaction');
      const mv = await tx.manualVerification.findUnique({ where: { transactionId } });
      if (!mv) throw new DomainError('NOT_MANUAL', 'This transaction does not take a manual reference');
      if (txn.state === 'AWAITING_MANUAL_VERIFICATION' && mv.customerReference === input.customerReference) return; // idempotent replay
      if (txn.state !== 'AWAITING_SOURCE_PAYMENT') throw Conflict('STATE_CHANGED', `Transaction is ${txn.state}`);
      await tx.manualVerification.update({
        where: { id: mv.id },
        data: { customerReference: input.customerReference, evidenceFileIds: input.evidenceFileIds, submittedAt: new Date(), status: 'PENDING', version: { increment: 1 } },
      });
      await this.state.transition(tx, { transactionId, to: 'AWAITING_MANUAL_VERIFICATION', actor: CUSTOMER(customerId), reason: 'Customer submitted transfer reference', locked: txn });
    });
    return this.present(transactionId, customerId);
  }

  /**
   * Customer cancellation (Switchn rules):
   *  - nothing received yet: closed at once, free;
   *  - payment / airtime possibly received: we finish confirming it, then refund minus the cancellation fee;
   *  - payout already started: too late.
   */
  async cancel(customerId: string, transactionId: string, reason?: string) {
    const prefs = await this.settings.get('cancellation');
    let refunded = false;
    await this.prisma.$transaction(async (tx) => {
      const txn = await this.state.lock(tx, transactionId);
      if (txn.customerId !== customerId) throw NotFound('Transaction');
      if (txn.cancelRequestedAt) return; // idempotent
      const actor = CUSTOMER(customerId);
      const mark = () => tx.transaction.update({ where: { id: txn.id }, data: { cancelRequestedAt: new Date(), cancelReason: reason ?? null } });

      if (txn.state === 'AWAITING_SOURCE_PAYMENT') {
        await mark();
        await this.state.transition(tx, { transactionId: txn.id, to: 'REJECTED', actor, reason: `Cancelled by the customer before payment${reason ? `: ${reason}` : ''}`, locked: txn });
        await tx.manualVerification.updateMany({ where: { transactionId: txn.id }, data: { status: 'REJECTED', reason: 'Cancelled by the customer before sending airtime', version: { increment: 1 } } });
        await this.notifications.notify(tx, { customerId, transactionId: txn.id, kind: 'CANCELLED', params: { ref: txn.reference } });
      } else if (['AWAITING_MANUAL_VERIFICATION', 'PAYMENT_PROCESSING', 'SOURCE_VERIFIED'].includes(txn.state)) {
        if (!prefs.allowAfterPayment) throw Conflict('CANNOT_CANCEL', 'This transaction can no longer be cancelled');
        await mark();
        await this.state.addNote(tx, txn.id, actor, `Customer asked to cancel${reason ? `: ${reason}` : ''}. Refund minus ${prefs.feeBps / 100}% once the payment is confirmed.`);
        await this.audit.record({ actorType: 'CUSTOMER', actorId: customerId, action: 'transaction.cancel_requested', entityType: 'Transaction', entityId: txn.id, after: { state: txn.state, reason: reason ?? null } }, tx);
        if (txn.state === 'SOURCE_VERIFIED') {
          refunded = await this.cancellation.refundIfCancelled(tx, { ...txn, cancelRequestedAt: new Date(), cancelReason: reason ?? null });
        }
      } else {
        throw Conflict('TOO_LATE_TO_CANCEL', 'Delivery has already started, so this transaction can’t be cancelled');
      }
    });
    void refunded;
    return this.present(transactionId, customerId);
  }

  async listForCustomer(customerId: string, page: number, pageSize: number) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where: { customerId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { service: { select: { code: true, name: true, sourceAsset: true, destinationAsset: true } }, bundle: { select: { name: true, nameFr: true } } },
      }),
      this.prisma.transaction.count({ where: { customerId } }),
    ]);
    return {
      page, pageSize, total,
      items: items.map((t) => ({
        id: t.id, reference: t.reference, service: { code: t.service.code, name: t.service.name, sourceAsset: t.service.sourceAsset, destinationAsset: t.service.destinationAsset },
        group: productGroupOf({ source: t.service.sourceAsset, destination: t.service.destinationAsset }),
        bundle: t.bundle ? { name: t.bundle.name, nameFr: t.bundle.nameFr ?? t.bundle.name } : null,
        state: t.state, customerPays: t.customerPays, expectedDelivered: t.expectedDelivered, recipient: t.recipientMsisdn,
        cancelRequested: t.cancelRequestedAt !== null, simulated: t.isSimulated, createdAt: t.createdAt,
      })),
    };
  }

  async present(transactionId: string, customerId: string) {
    const t = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        service: true,
        bundle: true,
        history: { orderBy: { createdAt: 'asc' }, select: { toState: true, reason: true, createdAt: true } },
        manualVerification: { select: { status: true, customerReference: true, submittedAt: true } },
        refunds: { orderBy: { createdAt: 'desc' }, select: { id: true, amount: true, feeRetained: true, kind: true, status: true, createdAt: true } },
      },
    });
    if (!t || t.customerId !== customerId) throw NotFound('Transaction');

    let paymentInstructions: Record<string, unknown> | null = null;
    if (t.state === 'AWAITING_SOURCE_PAYMENT') {
      if (t.service.processingMethod === 'MANUAL_SOURCE' && t.receivingSimId) {
        // The number is shown only for an enabled, usable service (checked when the transaction opened).
        const sim = await this.prisma.simAccount.findUniqueOrThrow({ where: { id: t.receivingSimId } });
        paymentInstructions = {
          method: 'MANUAL_AIRTIME_TRANSFER',
          sendTo: decrypt(sim.msisdnEncrypted, this.env.APP_ENCRYPTION_KEY),
          operator: sim.operator,
          amount: t.customerPays,
          steps: [
            `Transfer exactly ${t.customerPays} FCFA of ${ASSET_META[t.service.sourceAsset].label} to ${sim.msisdnMasked.slice(0, 4)}… (full number above) using your operator’s official credit-transfer service.`,
            'Keep the confirmation SMS from your operator.',
            'Submit the transfer reference in the app. Staff verify receipt on our SIM before paying out.',
          ],
        };
      } else {
        paymentInstructions = { method: 'PROVIDER_PAYMENT_PROMPT', amount: t.customerPays, steps: ['Approve the payment prompt on your phone.'] };
      }
    }

    const done = t.state === 'COMPLETED';
    const prefs = await this.settings.get('cancellation');
    const beforePayment = t.state === 'AWAITING_SOURCE_PAYMENT';
    const afterPayment = ['AWAITING_MANUAL_VERIFICATION', 'PAYMENT_PROCESSING', 'SOURCE_VERIFIED'].includes(t.state) && prefs.allowAfterPayment;
    return {
      id: t.id,
      reference: t.reference,
      simulated: t.isSimulated,
      simulationNotice: t.isSimulated ? 'SIMULATION — no real money or airtime is moved for this transaction.' : null,
      state: t.state,
      service: { code: t.service.code, name: t.service.name, sourceAsset: t.service.sourceAsset, destinationAsset: t.service.destinationAsset },
      group: productGroupOf({ source: t.service.sourceAsset, destination: t.service.destinationAsset }),
      bundle: t.bundle ? { name: t.bundle.name, nameFr: t.bundle.nameFr ?? t.bundle.name, validityDays: t.bundle.validityDays } : null,
      cancellation: {
        requested: t.cancelRequestedAt !== null,
        requestedAt: t.cancelRequestedAt,
        possible: !t.cancelRequestedAt && (beforePayment || afterPayment),
        /** What a cancellation costs right now. */
        fee: beforePayment ? 0 : cancellationFee(t.customerPays, prefs.feeBps),
        feeBps: prefs.feeBps,
      },
      refunds: t.refunds,
      conversionRate: (() => {
        const ppm = (t.acceptedTerms as { quote?: { conversionRatePpm?: number } }).quote?.conversionRatePpm ?? 1_000_000;
        return ppm === 1_000_000 ? null : ppm / 1_000_000;
      })(),
      amount: t.amount,
      customerPays: t.customerPays,
      platformFee: t.platformFee,
      providerFee: t.providerFee,
      expectedDelivered: t.expectedDelivered,
      recipient: t.recipientMsisdn,
      paymentInstructions,
      manualVerification: t.manualVerification,
      timeline: t.history,
      receipt: done
        ? { reference: t.reference, delivered: t.expectedDelivered, to: t.recipientMsisdn, platformFee: t.platformFee, providerFee: t.providerFee, completedAt: t.updatedAt, simulated: t.isSimulated }
        : null,
      createdAt: t.createdAt,
    };
  }
}
