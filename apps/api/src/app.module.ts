import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.service';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { ProvidersModule } from './providers/providers.module';
import { PricingModule } from './pricing/pricing.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { SimsModule } from './sims/sims.module';
import { LedgerModule } from './ledger/ledger.service';
import { JobsModule } from './jobs/jobs.service';
import { TransactionStateService } from './transactions/state.service';
import { QuotesService } from './transactions/quotes.service';
import { TransactionsService } from './transactions/transactions.service';
import { EvidenceController, NotificationsController, QuotesController, TransactionsController } from './transactions/customer.controllers';
import { ProcessingService } from './processing/processing.service';
import { VerificationService } from './verification/verification.service';
import { RefundsService } from './refunds/refunds.service';
import {
  AuditAdminController,
  RefundsAdminController,
  TransactionsAdminController,
  VerificationAdminController,
} from './admin/admin.controllers';
import { ReportsController } from './admin/reports.controller';
import { CallbacksController } from './callbacks/callbacks.controller';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    LedgerModule,
    JobsModule,
    AuthModule,
    ProvidersModule,
    PricingModule,
    CatalogueModule,
    SimsModule,
    // Rate limits apply everywhere except the automated test run (supertest shares one IP).
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }], skipIf: () => process.env.NODE_ENV === 'test' }),
  ],
  controllers: [
    QuotesController,
    TransactionsController,
    EvidenceController,
    NotificationsController,
    VerificationAdminController,
    TransactionsAdminController,
    RefundsAdminController,
    AuditAdminController,
    ReportsController,
    CallbacksController,
    HealthController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    TransactionStateService,
    QuotesService,
    TransactionsService,
    ProcessingService,
    VerificationService,
    RefundsService,
  ],
})
export class AppModule {}
