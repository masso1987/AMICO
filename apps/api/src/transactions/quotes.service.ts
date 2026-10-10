import { Inject, Injectable } from '@nestjs/common';
import { ASSET_META, type QuoteRequest } from '@amico/contracts';
import { calculateQuote, quoteWindow } from '@amico/pricing';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogueService } from '../catalogue/catalogue.module';
import { PricingService, toEngineRule } from '../pricing/pricing.service';
import { DomainError } from '../common/errors';
import type { Prisma, Quote, Service } from '../generated/prisma/client';

const MANUAL_RESTRICTIONS = [
  'Send airtime only through your operator’s official credit-transfer service.',
  'A screenshot or reference you submit is not proof of receipt: staff confirm the airtime on our SIM before anything is paid out.',
  'If the amount we receive differs from the quote, the transaction is held for review and not paid automatically.',
];

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogue: CatalogueService,
    private readonly pricing: PricingService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Generates and stores a quote. Never moves, reserves or promises money. */
  async create(customerId: string, req: QuoteRequest) {
    const service = await this.catalogue.getUsableService(req.serviceCode);
    const rule = (await this.pricing.activeRule(service.id))!;
    const providerFee = await this.pricing.providerFee(service, req.amount);
    const result = calculateQuote({
      amount: req.amount,
      rule: toEngineRule(rule),
      providerFee: providerFee.input,
      allowEstimatedProviderFee: service.allowEstimatedProviderFee,
    });
    if (!result.ok) throw new DomainError(result.code, result.message);

    const b = result.breakdown;
    const { createdAt, expiresAt } = quoteWindow(new Date(), service.quoteTtlSeconds);
    const quote = await this.prisma.quote.create({
      data: {
        customerId, serviceId: service.id, amount: req.amount, customerPays: b.customerPays, platformFee: b.platformFee,
        providerFee: b.providerFee.amount, expectedDelivered: b.expectedDelivered, senderMsisdn: req.senderMsisdn,
        recipientMsisdn: req.recipientMsisdn, breakdown: b as unknown as Prisma.InputJsonValue, pricingRuleId: rule.id,
        pricingRuleVersion: rule.version, providerFeeRuleId: providerFee.ruleId, providerFeeRuleVersion: providerFee.ruleVersion,
        isEstimate: b.isEstimate, isSimulated: this.env.SIMULATION_MODE, createdAt, expiresAt,
      },
    });
    return presentQuote(quote, service);
  }
}

/** Customer-facing quote. Clearly labelled as a quote, with the full breakdown. */
export function presentQuote(q: Quote, service: Service) {
  const b = q.breakdown as Record<string, unknown> & { providerFee: { status: string; collectedBy: string }; calculationMethod: string; assumptions: string[]; conversionRatePpm: number };
  return {
    kind: q.isEstimate ? 'ESTIMATED_QUOTE' : 'QUOTE',
    label: q.isEstimate ? 'Estimated quote — final amount may differ' : 'Quote — not a completed transaction',
    simulated: q.isSimulated,
    id: q.id,
    service: { code: service.code, name: service.name, processingMethod: service.processingMethod },
    source: { asset: service.sourceAsset, label: ASSET_META[service.sourceAsset].label, msisdn: q.senderMsisdn, amount: q.customerPays },
    destination: { asset: service.destinationAsset, label: ASSET_META[service.destinationAsset].label, recipient: q.recipientMsisdn },
    amount: q.amount,
    conversionRate: b.conversionRatePpm === 1_000_000 ? null : b.conversionRatePpm / 1_000_000,
    platformFee: q.platformFee,
    providerFee: { amount: q.providerFee, status: b.providerFee.status, collectedBy: b.providerFee.collectedBy },
    totalPayable: q.customerPays,
    expectedReceived: q.expectedDelivered,
    currency: 'XAF',
    calculationMethod: b.calculationMethod,
    pricingRuleVersion: q.pricingRuleVersion,
    providerFeeRuleVersion: q.providerFeeRuleVersion,
    assumptions: b.assumptions,
    restrictions: service.processingMethod === 'MANUAL_SOURCE' ? MANUAL_RESTRICTIONS : [],
    createdAt: q.createdAt,
    expiresAt: q.expiresAt,
    notice: 'No money has moved and nothing is reserved. You must confirm this quote before it expires.',
  };
}
