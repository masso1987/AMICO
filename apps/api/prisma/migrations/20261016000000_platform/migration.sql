-- Platform release: bundles, offers, settings, maintenance, messaging (SMS/WhatsApp),
-- alerts, monitoring, editable access roles, customer cancellation.

-- CreateEnum
CREATE TYPE "BundleCategory" AS ENUM ('DATA', 'VOICE', 'SMS', 'COMBO');

-- CreateEnum
CREATE TYPE "BundleValidity" AS ENUM ('DAY', 'WEEK', 'MONTH', 'OTHER');

-- CreateEnum
CREATE TYPE "BundleSource" AS ENUM ('PROVIDER', 'STAFF');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS_MTN', 'SMS_ORANGE', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('UP', 'DEGRADED', 'DOWN');

-- Roles become editable records: keep every existing assignment as its text key.
ALTER TABLE "StaffUser" ALTER COLUMN "roles" TYPE TEXT[] USING "roles"::TEXT[];
DROP TYPE "StaffRole";

-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "alertChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "dashboardLayout" JSONB,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "smsOptIn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "bundleId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "bundleId" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProviderOperation" ADD COLUMN     "durationMs" INTEGER;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "feeRetained" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "AccessRole" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT[],
    "system" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("key")
);

-- Built-in roles with their current grants, so access is unchanged by this migration.
-- (The seed keeps them in step with @amico/contracts ROLE_PERMISSIONS for new installs.)
INSERT INTO "AccessRole" ("key", "name", "description", "permissions", "system", "updatedAt") VALUES
  ('ADMIN', 'Administrator', 'Services, SIMs, providers, staff, platform', ARRAY['SIM_READ_MASKED','SIM_READ_FULL','SIM_WRITE','CATALOGUE_WRITE','PRICING_DRAFT','PRICING_APPROVE','PROVIDER_FEE_WRITE','PROVIDER_CAPABILITY_WRITE','TRANSACTION_READ','AUDIT_READ','REPORT_READ','STAFF_MANAGE','ACCESS_MANAGE','BUNDLE_MANAGE','OFFER_MANAGE','MAINTENANCE_MANAGE','MESSAGING_SEND','MESSAGING_CONFIGURE','MONITORING_READ','SETTINGS_MANAGE'], true, CURRENT_TIMESTAMP),
  ('FINANCE', 'Finance', 'Fees, refunds, reports', ARRAY['SIM_READ_MASKED','PRICING_DRAFT','PRICING_APPROVE','PROVIDER_FEE_WRITE','TRANSACTION_READ','REFUND_REQUEST','REFUND_APPROVE','REPORT_READ','AUDIT_READ','MONITORING_READ','SETTINGS_MANAGE'], true, CURRENT_TIMESTAMP),
  ('OPERATIONS', 'Operations', 'Airtime checks, second approvals, refund requests', ARRAY['SIM_READ_MASKED','SIM_READ_FULL','VERIFY_MANUAL','VERIFY_SECOND_APPROVAL','TRANSACTION_READ','REFUND_REQUEST','MONITORING_READ','MESSAGING_SEND'], true, CURRENT_TIMESTAMP),
  ('SUPPORT', 'Support', 'Reads transactions', ARRAY['SIM_READ_MASKED','TRANSACTION_READ','MONITORING_READ'], true, CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL,
    "operator" "Operator" NOT NULL,
    "providerCode" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameFr" TEXT,
    "description" TEXT,
    "category" "BundleCategory" NOT NULL,
    "validity" "BundleValidity" NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "dataMb" INTEGER,
    "voiceMinutes" INTEGER,
    "smsCount" INTEGER,
    "source" "BundleSource" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "staffEdited" BOOLEAN NOT NULL DEFAULT false,
    "withdrawnAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleFr" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL DEFAULT '',
    "bodyFr" TEXT NOT NULL DEFAULT '',
    "operator" "Operator",
    "badgeEn" TEXT,
    "badgeFr" TEXT,
    "ctaKind" TEXT NOT NULL DEFAULT 'NONE',
    "ctaTarget" TEXT,
    "imageKey" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MaintenanceWindow" (
    "id" TEXT NOT NULL,
    "serviceCodes" TEXT[],
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "messageEn" TEXT NOT NULL,
    "messageFr" TEXT NOT NULL,
    "notifyCustomers" BOOLEAN NOT NULL DEFAULT true,
    "notifyLeadMinutes" INTEGER NOT NULL DEFAULT 60,
    "customersNotifiedAt" TIMESTAMP(3),
    "startedNotifiedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessagingChannel" (
    "channel" "MessageChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "live" BOOLEAN NOT NULL DEFAULT false,
    "driver" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "secretsEncrypted" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestError" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingChannel_pkey" PRIMARY KEY ("channel")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "requested" TEXT NOT NULL,
    "channel" "MessageChannel",
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "purpose" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerMessageId" TEXT,
    "error" TEXT,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "customerId" TEXT,
    "staffId" TEXT,
    "broadcastId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "requested" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyFr" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthSample" (
    "id" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "status" "HealthStatus" NOT NULL,
    "latencyMs" INTEGER,
    "detail" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bundle_providerCode_productId_key" ON "Bundle"("providerCode", "productId");

-- CreateIndex
CREATE INDEX "Bundle_operator_active_idx" ON "Bundle"("operator", "active");

-- CreateIndex
CREATE INDEX "Offer_active_startsAt_idx" ON "Offer"("active", "startsAt");

-- CreateIndex
CREATE INDEX "MaintenanceWindow_startsAt_idx" ON "MaintenanceWindow"("startsAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_nextAttemptAt_idx" ON "OutboundMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_broadcastId_idx" ON "OutboundMessage"("broadcastId");

-- CreateIndex
CREATE INDEX "OutboundMessage_createdAt_idx" ON "OutboundMessage"("createdAt");

-- CreateIndex
CREATE INDEX "Alert_key_resolvedAt_idx" ON "Alert"("key", "resolvedAt");

-- CreateIndex
CREATE INDEX "Alert_firstSeenAt_idx" ON "Alert"("firstSeenAt");

-- CreateIndex
CREATE INDEX "HealthSample_component_at_idx" ON "HealthSample"("component", "at");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ledger account for cancellation fees, in both books (the seed adds it on fresh installs too).
INSERT INTO "LedgerAccount" ("id", "code", "name", "type", "book") VALUES
  (gen_random_uuid()::text, 'CANCELLATION_FEE_REVENUE', 'Cancellation fees kept', 'REVENUE', 'REAL'),
  (gen_random_uuid()::text, 'CANCELLATION_FEE_REVENUE', 'Cancellation fees kept', 'REVENUE', 'SIMULATED')
ON CONFLICT ("code", "book") DO NOTHING;
