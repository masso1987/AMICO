import { HttpStatus, Injectable } from '@nestjs/common';
import { ASSET_META, type CapabilityRequirement, type PricingRuleDraft, type ProviderFeeRuleDraft } from '@amico/contracts';
import type { FeeSchedule, PlatformPricingRule, ProviderFeeInput } from '@amico/pricing';
import { simulateFees } from '@amico/pricing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CapabilityService } from '../providers/providers.module';
import { Conflict, DomainError, Forbidden, NotFound } from '../common/errors';
import type { PricingRule, ProviderFeeRule, Service } from '../generated/prisma/client';

/** Delivery-side capability for a service: what the destination operator must do. */
export function deliveryRequirement(service: Pick<Service, 'destinationAsset'>): CapabilityRequirement {
  const meta = ASSET_META[service.destinationAsset];
  const capability = meta.kind === 'MOBILE_MONEY' ? 'DISBURSE' : meta.kind === 'AIRTIME' ? 'AIRTIME_TOPUP' : 'DATA_BUNDLE';
  return { operator: meta.operator, capability };
}

export function toEngineRule(r: PricingRule): PlatformPricingRule {
  return {
    id: r.id,
    version: r.version,
    fee: { feeType: r.feeType, percentageBps: r.percentageBps, fixedFee: r.fixedFee, minFee: r.minFee, maxFee: r.maxFee, rounding: r.feeRounding },
    minAmount: r.minAmount,
    maxAmount: r.maxAmount,
    deductionMethod: r.deductionMethod,
    conversionRatePpm: r.conversionRatePpm,
    deliveryRounding: r.deliveryRounding,
  };
}

function toFeeSchedule(r: ProviderFeeRule): FeeSchedule {
  return { feeType: r.feeType, percentageBps: r.percentageBps, fixedFee: r.fixedFee, minFee: r.minFee, maxFee: r.maxFee, rounding: 'UP' };
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capabilities: CapabilityService,
  ) {}

  /** The rule in force now: ACTIVE, inside its effective window, highest version wins. */
  activeRule(serviceId: string, now = new Date()) {
    return this.prisma.pricingRule.findFirst({
      where: {
        serviceId,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Provider fee for the delivery leg. Order of trust: the provider's own fee inquiry,
   * then an approved fee rule (VERIFIED or ESTIMATE), else UNKNOWN (quote refused).
   * Collection-side provider fees are treated as a business cost until B7 is settled.
   */
  async providerFee(service: Service, amount: number): Promise<{ input: ProviderFeeInput; ruleId: string | null; ruleVersion: number | null }> {
    const req = deliveryRequirement(service);
    const usable = await this.capabilities.resolveUsable(req);
    if (!usable) return { input: { status: 'UNKNOWN' }, ruleId: null, ruleVersion: null };

    const rule = await this.activeProviderFeeRule(usable.providerId, req);
    const quoted = await usable.adapter.inquireFee({ ...req, amount });
    if (quoted !== null) {
      return {
        input: { status: 'PROVIDER_QUOTED', amount: quoted, deductedAtSettlement: rule?.deductedAtSettlement ?? false, reference: `${usable.adapter.code}:fee-inquiry` },
        ruleId: null,
        ruleVersion: null,
      };
    }
    if (!rule) return { input: { status: 'UNKNOWN' }, ruleId: null, ruleVersion: null };
    return {
      input: { status: rule.source, ruleId: rule.id, ruleVersion: rule.version, fee: toFeeSchedule(rule), deductedAtSettlement: rule.deductedAtSettlement },
      ruleId: rule.id,
      ruleVersion: rule.version,
    };
  }

  activeProviderFeeRule(providerId: string, req: CapabilityRequirement) {
    return this.prisma.providerFeeRule.findFirst({
      where: { providerId, operator: req.operator, capability: req.capability, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
  }

  // ------------------------------------------------------------ platform rules (maker-checker)

  async draftRule(draft: PricingRuleDraft, makerId: string) {
    const service = await this.prisma.service.findUnique({ where: { code: draft.serviceCode } });
    if (!service) throw NotFound('Service');
    if (service.sourceAsset.endsWith('_AIRTIME') && draft.conversionRatePpm === 1_000_000) {
      // Airtime is not cash. A 1:1 rate is allowed but must be a conscious, recorded choice.
      if (!/1:1|one.to.one|verified/i.test(draft.changeReason)) {
        throw new DomainError('CONVERSION_RATE_UNCONFIRMED', 'Airtime routes need a verified conversion rate. If 1:1 is intended, say so in changeReason.');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.pricingRule.findFirst({ where: { serviceId: service.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const { serviceCode: _s, ...fields } = draft;
      const rule = await tx.pricingRule.create({
        data: {
          ...fields,
          serviceId: service.id,
          version: (last?.version ?? 0) + 1,
          status: 'PENDING_APPROVAL',
          createdById: makerId,
        },
      });
      await this.audit.record({ actorType: 'STAFF', actorId: makerId, action: 'pricing_rule.draft', entityType: 'PricingRule', entityId: rule.id, after: rule }, tx);
      return rule;
    });
  }

  async approveRule(ruleId: string, checkerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.pricingRule.findUnique({ where: { id: ruleId } });
      if (!rule) throw NotFound('Pricing rule');
      if (rule.status !== 'PENDING_APPROVAL') throw Conflict('RULE_NOT_PENDING', `Rule is ${rule.status}`);
      if (rule.createdById === checkerId) throw Forbidden('MAKER_CHECKER', 'A pricing rule must be approved by someone other than its author');
      const updated = await tx.pricingRule.updateMany({
        where: { id: ruleId, status: 'PENDING_APPROVAL' },
        data: { status: 'ACTIVE', approvedById: checkerId, approvedAt: new Date() },
      });
      if (updated.count !== 1) throw Conflict('RULE_NOT_PENDING', 'Rule was changed by someone else');
      const after = await tx.pricingRule.findUniqueOrThrow({ where: { id: ruleId } });
      await this.audit.record({ actorType: 'STAFF', actorId: checkerId, action: 'pricing_rule.approve', entityType: 'PricingRule', entityId: ruleId, before: rule, after }, tx);
      return after;
    });
  }

  async rejectRule(ruleId: string, checkerId: string, reason: string) {
    const rule = await this.prisma.pricingRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw NotFound('Pricing rule');
    if (rule.status !== 'PENDING_APPROVAL') throw Conflict('RULE_NOT_PENDING', `Rule is ${rule.status}`);
    const after = await this.prisma.pricingRule.update({ where: { id: ruleId }, data: { status: 'REJECTED', rejectedReason: reason } });
    await this.audit.record({ actorType: 'STAFF', actorId: checkerId, action: 'pricing_rule.reject', entityType: 'PricingRule', entityId: ruleId, before: rule, after });
    return after;
  }

  async retireRule(ruleId: string, actorId: string, reason: string) {
    const rule = await this.prisma.pricingRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw NotFound('Pricing rule');
    if (rule.status !== 'ACTIVE') throw Conflict('RULE_NOT_ACTIVE', `Rule is ${rule.status}`);
    const after = await this.prisma.pricingRule.update({ where: { id: ruleId }, data: { status: 'RETIRED', effectiveTo: new Date() } });
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'pricing_rule.retire', entityType: 'PricingRule', entityId: ruleId, before: rule, after: { ...after, reason } });
    return after;
  }

  // ------------------------------------------------------------ provider fee rules

  async draftProviderFee(draft: ProviderFeeRuleDraft, makerId: string) {
    const provider = await this.prisma.provider.findUnique({ where: { code: draft.providerCode } });
    if (!provider) throw NotFound('Provider');
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.providerFeeRule.findFirst({
        where: { providerId: provider.id, operator: draft.operator, capability: draft.capability },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const { providerCode: _p, ...fields } = draft;
      const rule = await tx.providerFeeRule.create({
        data: { ...fields, providerId: provider.id, version: (last?.version ?? 0) + 1, status: 'PENDING_APPROVAL', createdById: makerId },
      });
      await this.audit.record({ actorType: 'STAFF', actorId: makerId, action: 'provider_fee_rule.draft', entityType: 'ProviderFeeRule', entityId: rule.id, after: rule }, tx);
      return rule;
    });
  }

  async approveProviderFee(ruleId: string, checkerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.providerFeeRule.findUnique({ where: { id: ruleId } });
      if (!rule) throw NotFound('Provider fee rule');
      if (rule.status !== 'PENDING_APPROVAL') throw Conflict('RULE_NOT_PENDING', `Rule is ${rule.status}`);
      if (rule.createdById === checkerId) throw Forbidden('MAKER_CHECKER', 'A provider fee rule must be approved by someone other than its author');
      // Supersede the previous active version for this provider/operator/capability.
      await tx.providerFeeRule.updateMany({
        where: { providerId: rule.providerId, operator: rule.operator, capability: rule.capability, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
      });
      const after = await tx.providerFeeRule.update({ where: { id: ruleId }, data: { status: 'ACTIVE', approvedById: checkerId, approvedAt: new Date() } });
      await this.audit.record({ actorType: 'STAFF', actorId: checkerId, action: 'provider_fee_rule.approve', entityType: 'ProviderFeeRule', entityId: ruleId, before: rule, after }, tx);
      return after;
    });
  }

  // ------------------------------------------------------------ simulator

  /**
   * Same engine as customer quotes. `ruleId` lets staff preview a PENDING rule before approving it;
   * `providerFeeAmount` lets them try a provider charge by hand.
   */
  async simulate(args: { serviceCode: string; amount: number; ruleId?: string; providerFeeAmount?: number; providerDeductsAtSettlement?: boolean }) {
    const service = await this.prisma.service.findUnique({ where: { code: args.serviceCode } });
    if (!service) throw NotFound('Service');
    const rule = args.ruleId ? await this.prisma.pricingRule.findUnique({ where: { id: args.ruleId } }) : await this.activeRule(service.id);
    if (!rule || rule.serviceId !== service.id) throw new DomainError('NO_PRICING_RULE', 'No pricing rule to simulate for this service', HttpStatus.NOT_FOUND);
    const providerFee: ProviderFeeInput =
      args.providerFeeAmount !== undefined
        ? { status: 'PROVIDER_QUOTED', amount: args.providerFeeAmount, deductedAtSettlement: args.providerDeductsAtSettlement ?? false, reference: 'simulator: entered by staff' }
        : (await this.providerFee(service, args.amount)).input;
    const result = simulateFees({ amount: args.amount, rule: toEngineRule(rule), providerFee, allowEstimatedProviderFee: true });
    return { ruleStatus: rule.status, ruleVersion: rule.version, ...result };
  }
}
