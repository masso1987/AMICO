import { Inject, Injectable } from '@nestjs/common';
import { ASSET_META, type QuoteRequest } from '@amico/contracts';
import { calculateQuote, quoteWindow } from '@amico/pricing';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogueService } from '../catalogue/catalogue.module';
import { PricingService, toEngineRule } from '../pricing/pricing.service';
import { DomainError } from '../common/errors';
import { BundlesService } from '../bundles/bundles.module';
import { MaintenanceService } from '../maintenance/maintenance.module';
import type { Bundle, Prisma, Quote, Service } from '../generated/prisma/client';

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
    private readonly bundles: BundlesService,
    private readonly maintenance: MaintenanceService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Generates and stores a quote. Never moves, reserves or promises money. */
  async create(customerId: string, req: QuoteRequest) {
    await this.maintenance.assertOpen(req.serviceCode);
    const service = await this.catalogue.getUsableService(req.serviceCode);
    const isBundleRoute = ASSET_META[service.destinationAsset].kind === 'DATA_BUNDLE';
    if (isBundleRoute !== (req.bundleId !== undefined)) {
      throw new DomainError(isBundleRoute ? 'BUNDLE_REQUIRED' : 'NOT_A_BUNDLE_SERVICE', isBundleRoute ? 'Choose a bundle' : 'This service takes an amount, not a bundle');
    }
    const bundle = req.bundleId ? await this.bundles.getActive(req.bundleId) : null;
    if (bundle && bundle.operator !== ASSET_META[service.destinationAsset].operator) {
      throw new DomainError('BUNDLE_NETWORK_MISMATCH', 'This bundle belongs to another network');
    }
    const amount = bundle ? bundle.price : req.amount!;
    const rule = (await this.pricing.activeRule(service.id))!;
    const providerFee = await this.pricing.providerFee(service, amount);
    const result = calculateQuote({
      amount,
      rule: toEngineRule(rule),
      providerFee: providerFee.input,
      allowEstimatedProviderFee: service.allowEstimatedProviderFee,
    });
    if (!result.ok) throw new DomainError(result.code, result.message);

    const b = result.breakdown;
    // A bundle is bought whole: the fee may be added on top, never taken out of the bundle.
    if (bundle && b.expectedDelivered !== bundle.price) {
      throw new DomainError('BUNDLE_PRICING_INVALID', 'The fee rule for this service must add fees to the payment (1:1, ADD_TO_PAYMENT)');
    }
    const { createdAt, expiresAt } = quoteWindow(new Date(), service.quoteTtlSeconds);
    const quote = await this.prisma.quote.create({
      data: {
        customerId, serviceId: service.id, amount, bundleId: bundle?.id ?? null, customerPays: b.customerPays, platformFee: b.platformFee,
        providerFee: b.providerFee.amount, expectedDelivered: b.expectedDelivered, senderMsisdn: req.senderMsisdn,
        recipientMsisdn: req.recipientMsisdn, breakdown: b as unknown as Prisma.InputJsonValue, pricingRuleId: rule.id,
        pricingRuleVersion: rule.version, providerFeeRuleId: providerFee.ruleId, providerFeeRuleVersion: providerFee.ruleVersion,
        isEstimate: b.isEstimate, isSimulated: this.env.SIMULATION_MODE, createdAt, expiresAt,
      },
    });
    return presentQuote(quote, service, bundle);
  }
}

/** Customer-facing quote. Clearly labelled as a quote, with the full breakdown. */
export function presentQuote(q: Quote, service: Service, bundle?: Bundle | null) {
  const b = q.breakdown as Record<string, unknown> & { providerFee: { status: string; collectedBy: string }; calculationMethod: string; assumptions: string[]; conversionRatePpm: number };
  return {
    kind: q.isEstimate ? 'ESTIMATED_QUOTE' : 'QUOTE',
    label: q.isEstimate ? 'Estimated quote — final amount may differ' : 'Quote — not a completed transaction',
    simulated: q.isSimulated,
    id: q.id,
    service: { code: service.code, name: service.name, processingMethod: service.processingMethod },
    source: { asset: service.sourceAsset, label: ASSET_META[service.sourceAsset].label, msisdn: q.senderMsisdn, amount: q.customerPays },
    destination: { asset: service.destinationAsset, label: ASSET_META[service.destinationAsset].label, recipient: q.recipientMsisdn },
    bundle: bundle ? { id: bundle.id, name: bundle.name, nameFr: bundle.nameFr ?? bundle.name, validityDays: bundle.validityDays, operator: bundle.operator } : null,
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
