import { Injectable } from '@nestjs/common';
import type { Tx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.module';
import { NotificationService } from '../messaging/notifications.service';
import { TransactionStateService } from '../transactions/state.service';
import { cancellationFee, openRefund } from './open-refund';
import type { Transaction } from '../generated/prisma/client';

/**
 * Customer cancellations, Switchn-style:
 *  - before we receive anything: closed at once, nothing charged;
 *  - after we received the payment / airtime but before payout: refunded minus the
 *    cancellation fee (AppSetting "cancellation", 3% by default);
 *  - once payout has started: too late.
 */
@Injectable()
export class CancellationService {
  constructor(
    private readonly settings: SettingsService,
    private readonly state: TransactionStateService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** Called where a source is confirmed. Returns true if the transaction was cancelled and a refund opened (so: no payout). */
  async refundIfCancelled(tx: Tx, txn: Transaction): Promise<boolean> {
    if (!txn.cancelRequestedAt || txn.state !== 'SOURCE_VERIFIED') return false;
    const { feeBps } = await this.settings.get('cancellation');
    const fee = cancellationFee(txn.customerPays, feeBps);
    const amount = txn.customerPays - fee;
    if (amount <= 0) return false;
    await openRefund(tx, { state: this.state, audit: this.audit }, {
      txn, kind: 'CANCELLATION', amount, feeRetained: fee, requestedById: 'SYSTEM', allowedFrom: ['SOURCE_VERIFIED'],
      reason: `Cancelled by the customer after payment; cancellation fee ${fee} FCFA (${feeBps / 100}%) kept${txn.cancelReason ? `. Customer: ${txn.cancelReason}` : ''}`,
    });
    await this.notifications.notify(tx, { customerId: txn.customerId, transactionId: txn.id, kind: 'CANCEL_REFUND', params: { ref: txn.reference, amount, fee } });
    return true;
  }
}
