import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Fcfa, PositiveFcfa, PricingRuleDraftSchema, ProviderFeeRuleDraftSchema, type PricingRuleDraft, type ProviderFeeRuleDraft } from '@amico/contracts';
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

@Module({
  controllers: [PricingAdminController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
