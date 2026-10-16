import { Injectable } from '@nestjs/common';
import type { Tx } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { MessagingService } from './messaging.service';
import { render, type Locale } from './templates';

export interface NotifyParams {
  ref: string;
  amount?: number;
  to?: string;
  delivered?: number;
  fee?: number;
  sim?: boolean;
}

/**
 * Customer notifications. Inside the caller's database transaction it writes the in-app
 * notification (in the customer's language) and, when transaction messages are on, an
 * SMS / WhatsApp message to the outbox. The outbox is sent after commit by the worker,
 * so a rolled-back change never produces a message.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly messaging: MessagingService,
    private readonly settings: SettingsService,
  ) {}

  async notify(tx: Tx, n: { customerId: string; transactionId?: string; kind: string; params: NotifyParams; sms?: boolean }) {
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: n.customerId }, select: { phone: true, locale: true, whatsappOptIn: true } });
    const locale: Locale = customer.locale === 'fr' ? 'fr' : 'en';
    const text = render(n.kind, locale, n.params);
    const row = await tx.notification.create({
      data: { customerId: n.customerId, transactionId: n.transactionId ?? null, kind: n.kind, title: text.title, body: text.body },
    });
    if (n.sms !== false && (await this.settings.get('messaging')).transactionMessages) {
      await this.messaging.queue(tx, {
        to: customer.phone,
        body: text.sms,
        locale,
        purpose: 'TRANSACTION',
        requested: customer.whatsappOptIn ? 'WHATSAPP_THEN_SMS' : 'SMS',
        customerId: n.customerId,
      });
    }
    return row;
  }
}
