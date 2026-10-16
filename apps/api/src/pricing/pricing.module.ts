import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Fcfa, PositiveFcfa, PricingRuleDraftSchema, ProviderFeeRuleDraftSchema, routesInGroup, type PricingRuleDraft, type ProviderFeeRuleDraft } from '@amico/contracts';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentStaff, StaffAuth, type StaffPrincipal } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from './pricing.service';

const ReasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const SimulateSchema = z.object({
  serviceCode: z.string().min(3),
  amount: PositiveFcfa,
  ruleId: z.string().uuid().optional(),
  providerFeeAmount: Fcfa.optional(),
  providerDeductsAtSettlement: z.boolean().optional(),
});

/** One buy-back rate and one set of limits for every "sell credit" route (MTN and Orange). */
const SellCreditSchema = z
  .object({
    /** Percentage of the airtime value paid to the customer, e.g. 85 or 82.5. */
    ratePercent: z.number().min(1).max(100).multipleOf(0.01),
    minAmount: PositiveFcfa.default(1_000),
    maxAmount: PositiveFcfa.default(500_000),
    effectiveFrom: z.coerce.date().optional(),
    changeReason: z.string().trim().min(5).max(500),
  })
  .refine((b) => b.minAmount <= b.maxAmount, { message: 'Minimum must be ≤ maximum', path: ['minAmount'] });
const ApproveManySchema = z.object({ ruleIds: z.array(z.string().uuid()).min(1).max(10) });

@ApiTags('admin / pricing')
@Controller('admin')
export class PricingAdminController {
  constructor(
    private readonly pricing: PricingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('pricing-rules')
  @StaffAuth('PRICING_DRAFT')
  list(@Query('serviceCode') serviceCode?: string) {
    return this.prisma.pricingRule.findMany({
      where: serviceCode ? { service: { code: serviceCode } } : {},
      orderBy: [{ serviceId: 'asc' }, { version: 'desc' }],
      include: { service: { select: { code: true, name: true } } },
    });
  }

  @Post('pricing-rules')
  @StaffAuth('PRICING_DRAFT')
  draft(@Body(new ZodPipe(PricingRuleDraftSchema)) body: PricingRuleDraft, @CurrentStaff() staff: StaffPrincipal) {
    return this.pricing.draftRule(body, staff.id);
  }

  @Post('pricing-rules/:id/approve')
  @StaffAuth('PRICING_APPROVE')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: StaffPrincipal) {
    return this.pricing.approveRule(id, staff.id);
  }

  @Post('pricing-rules/:id/reject')
  @StaffAuth('PRICING_APPROVE')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>, @CurrentStaff() staff: StaffPrincipal) {
    return this.pricing.rejectRule(id, staff.id, body.reason);
  }

  @Post('pricing-rules/:id/retire')
  @StaffAuth('PRICING_APPROVE')
  retire(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>, @CurrentStaff() staff: StaffPrincipal) {
    return this.pricing.retireRule(id, staff.id, body.reason);
  }

  /** Current buy-back rate per network route, plus drafts waiting for approval. */
  @Get('pricing/sell-credit')
  @StaffAuth('PRICING_DRAFT')
  async sellCredit() {
    const codes = routesInGroup('SELL_CREDIT');
    const services = await this.prisma.service.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, name: true, status: true } });
    return Promise.all(
      services.map(async (svc) => {
        const active = await this.pricing.activeRule(svc.id);
        const pending = await this.prisma.pricingRule.findMany({ where: { serviceId: svc.id, status: 'PENDING_APPROVAL' }, orderBy: { version: 'desc' } });
        const view = (r: { id: string; version: number; conversionRatePpm: number; minAmount: number; maxAmount: number; createdById: string; effectiveFrom: Date }) => ({
          id: r.id, version: r.version, ratePercent: r.conversionRatePpm / 10_000, minAmount: r.minAmount, maxAmount: r.maxAmount, createdById: r.createdById, effectiveFrom: r.effectiveFrom,
        });
        return { serviceCode: svc.code, name: svc.name, status: svc.status, active: active ? view(active) : null, pending: pending.map(view) };
      }),
    );
  }

  /** Drafts the same rate and limits for all four sell-credit routes. Each still needs a second person's approval. */
  @Post('pricing/sell-credit')
  @StaffAuth('PRICING_DRAFT')
  async draftSellCredit(@Body(new ZodPipe(SellCreditSchema)) body: z.infer<typeof SellCreditSchema>, @CurrentStaff() staff: StaffPrincipal) {
    const rate = Math.round(body.ratePercent * 10_000);
    const out = [];
    for (const serviceCode of routesInGroup('SELL_CREDIT')) {
      out.push(
        await this.pricing.draftRule(
          {
            serviceCode, feeType: 'FIXED', percentageBps: 0, fixedFee: 0, minFee: 0, maxFee: null,
            minAmount: body.minAmount, maxAmount: body.maxAmount, deductionMethod: 'DEDUCT_FROM_DESTINATION', conversionRatePpm: rate,
            feeRounding: 'UP', deliveryRounding: 'DOWN', effectiveFrom: body.effectiveFrom ?? new Date(), effectiveTo: null,
            changeReason: `Sell-credit rate ${body.ratePercent}% for MTN and Orange${rate === 1_000_000 ? ' (1:1 verified)' : ''}: ${body.changeReason}`,
          },
          staff.id,
        ),
      );
    }
    return out;
  }

  @Post('pricing-rules/approve-many')
  @StaffAuth('PRICING_APPROVE')
  async approveMany(@Body(new ZodPipe(ApproveManySchema)) body: z.infer<typeof ApproveManySchema>, @CurrentStaff() staff: StaffPrincipal) {
    const out = [];
    for (const id of body.ruleIds) out.push(await this.pricing.approveRule(id, staff.id));
    return out;
  }

  @Post('pricing/simulate')
  @StaffAuth('PRICING_DRAFT')
  simulate(@Body(new ZodPipe(SimulateSchema)) body: z.infer<typeof SimulateSchema>) {
    return this.pricing.simulate(body);
  }

  @Get('provider-fee-rules')
  @StaffAuth('PROVIDER_FEE_WRITE')
  listProviderFees() {
    return this.prisma.providerFeeRule.findMany({ orderBy: [{ operator: 'asc' }, { capability: 'asc' }, { version: 'desc' }], include: { provider: { select: { code: true } } } });
  }

  @Post('provider-fee-rules')
  @StaffAuth('PROVIDER_FEE_WRITE')
  draftProviderFee(@Body(new ZodPipe(ProviderFeeRuleDraftSchema)) body: ProviderFeeRuleDraft, @CurrentStaff() staff: StaffPrincipal) {
    return this.pricing.draftProviderFee(body, staff.id);
  }

  @Post('provider-fee-rules/:id/approve')
  @StaffAuth('PRICING_APPROVE')
  approveProviderFee(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: StaffPrincipal) {
    return this.pricing.approveProviderFee(id, staff.id);
  }
}

/** Public: the buy-back rate customers see on the "sell credit" page, per enabled network route. */
@ApiTags('status')
@Controller('public')
export class PublicPricingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  @Get('sell-credit')
  async sellCredit() {
    const services = await this.prisma.service.findMany({
      where: { code: { in: routesInGroup('SELL_CREDIT') }, status: 'ENABLED' },
      select: { id: true, code: true, sourceAsset: true, destinationAsset: true },
      orderBy: { code: 'asc' },
    });
    const out = [];
    for (const svc of services) {
      const rule = await this.pricing.activeRule(svc.id);
      if (!rule) continue;
      out.push({ serviceCode: svc.code, sourceAsset: svc.sourceAsset, destinationAsset: svc.destinationAsset, ratePercent: rule.conversionRatePpm / 10_000, minAmount: rule.minAmount, maxAmount: rule.maxAmount });
    }
    return out;
  }
}

@Module({
  controllers: [PricingAdminController, PublicPricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
