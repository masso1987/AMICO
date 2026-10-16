import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AmicoThrottlerGuard } from './common/throttler.guard';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.service';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { ProvidersModule } from './providers/providers.module';
import { PricingModule } from './pricing/pricing.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { SimsModule } from './sims/sims.module';
import { StaffModule } from './staff/staff.module';
import { AccessModule } from './access/access.module';
import { SettingsModule } from './settings/settings.module';
import { MessagingModule } from './messaging/messaging.module';
import { CancellationService } from './refunds/cancellation.service';
import { BundlesModule } from './bundles/bundles.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { OffersModule } from './offers/offers.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SchedulerModule } from './scheduler/scheduler.module';
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
    StaffModule,
    AccessModule,
    SettingsModule,
    MessagingModule,
    MaintenanceModule,
    BundlesModule,
    OffersModule,
    MonitoringModule,
    DashboardModule,
    SchedulerModule,
    // Rate limits apply everywhere except the automated test run (supertest shares one IP).
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => process.env.NODE_ENV === 'test' }),
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
    { provide: APP_GUARD, useClass: AmicoThrottlerGuard },
    TransactionStateService,
    QuotesService,
    TransactionsService,
    ProcessingService,
    VerificationService,
    RefundsService,
    CancellationService,
  ],
})
export class AppModule {}
