import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { StaffAuth } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const RevenueQuery = z.object({
  period: z.enum(['day', 'month']).default('day'),
  from: z.coerce.date().default(() => new Date(Date.now() - 30 * 86_400_000)),
  to: z.coerce.date().default(() => new Date()),
  simulated: z.enum(['true', 'false']).default('false'),
});

@ApiTags('admin / reports')
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Revenue from COMPLETED transactions, by day or month. Real and simulated never mix. */
  @Get('revenue')
  @StaffAuth('REPORT_READ')
  async revenue(@Query(new ZodPipe(RevenueQuery)) q: z.infer<typeof RevenueQuery>) {
    const unit = q.period === 'day' ? 'day' : 'month';
    const rows = await this.prisma.$queryRaw<
      { bucket: Date; transactions: bigint; volume: bigint; platform_fees: bigint; provider_fees: bigint; delivered: bigint }[]
    >`
      SELECT date_trunc(${unit}, t."updatedAt") AS bucket,
             COUNT(*)                    AS transactions,
             SUM(t."customerPays")       AS volume,
             SUM(t."platformFee")        AS platform_fees,
             SUM(t."providerFee")        AS provider_fees,
             SUM(t."expectedDelivered")  AS delivered
        FROM "Transaction" t
       WHERE t.state = 'COMPLETED'
         AND t."isSimulated" = ${q.simulated === 'true'}
         AND t."updatedAt" >= ${q.from} AND t."updatedAt" < ${q.to}
       GROUP BY 1 ORDER BY 1`;
    return {
      period: q.period,
      simulated: q.simulated === 'true',
      rows: rows.map((r) => ({
        bucket: r.bucket,
        transactions: Number(r.transactions),
        volume: Number(r.volume),
        platformFees: Number(r.platform_fees),
        providerFees: Number(r.provider_fees),
        delivered: Number(r.delivered),
      })),
    };
  }

  /**
   * Reconciliation checks. Every list should be empty on a healthy day; anything
   * listed needs a person to look at it.
   */
  @Get('reconciliation')
  @StaffAuth('REPORT_READ')
  async reconciliation() {
    const trialBalance = await this.prisma.$queryRaw<{ book: string; code: string; debits: bigint; credits: bigint }[]>`
      SELECT a.book::text, a.code, COALESCE(SUM(e.debit),0) AS debits, COALESCE(SUM(e.credit),0) AS credits
        FROM "LedgerAccount" a LEFT JOIN "LedgerEntry" e ON e."accountId" = a.id
       GROUP BY a.book, a.code ORDER BY a.book, a.code`;

    const completedWithoutPayoutJournal = await this.prisma.$queryRaw<{ id: string; reference: string }[]>`
      SELECT t.id, t.reference FROM "Transaction" t
       WHERE t.state = 'COMPLETED'
         AND NOT EXISTS (SELECT 1 FROM "LedgerJournal" j WHERE j."transactionId" = t.id AND j.kind = 'PAYOUT_COMPLETED')`;

    const fundsHeldOnClosedTransactions = await this.prisma.$queryRaw<{ id: string; reference: string; state: string }[]>`
      SELECT t.id, t.reference, t.state::text FROM "Transaction" t
       WHERE t.state IN ('REJECTED')
         AND EXISTS (SELECT 1 FROM "LedgerJournal" j WHERE j."transactionId" = t.id AND j.kind = 'SOURCE_RECEIVED')`;

    const uncertainOperations = await this.prisma.providerOperation.findMany({
      where: { status: { in: ['REQUESTED', 'PENDING', 'UNKNOWN'] }, updatedAt: { lt: new Date(Date.now() - 60 * 60_000) } },
      select: { id: true, kind: true, transactionId: true, status: true, statusChecks: true, updatedAt: true, simulated: true },
    });

    const succeededButNotCompleted = await this.prisma.$queryRaw<{ id: string; reference: string; state: string }[]>`
      SELECT DISTINCT t.id, t.reference, t.state::text FROM "Transaction" t
        JOIN "ProviderOperation" o ON o."transactionId" = t.id
       WHERE o.kind IN ('DISBURSE','AIRTIME_TOPUP','DATA_BUNDLE') AND o.status = 'SUCCEEDED' AND t.state <> 'COMPLETED'`;

    const books = ['REAL', 'SIMULATED'].map((book) => {
      const rows = trialBalance.filter((r) => r.book === book);
      const d = rows.reduce((s, r) => s + Number(r.debits), 0);
      const c = rows.reduce((s, r) => s + Number(r.credits), 0);
      return {
        book,
        balanced: d === c,
        totalDebits: d,
        totalCredits: c,
        accounts: rows.map((r) => ({ code: r.code, debits: Number(r.debits), credits: Number(r.credits), balance: Number(r.debits) - Number(r.credits) })),
      };
    });

    return {
      generatedAt: new Date(),
      books,
      exceptions: { completedWithoutPayoutJournal, fundsHeldOnClosedTransactions, uncertainOperations, succeededButNotCompleted },
      notes: 'Provider statement and normal-SIM balance matching is a P5 deliverable; this report covers internal consistency.',
    };
  }
}
