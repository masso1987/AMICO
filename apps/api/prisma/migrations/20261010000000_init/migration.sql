-- CreateEnum
CREATE TYPE "Operator" AS ENUM ('MTN', 'ORANGE');

-- CreateEnum
CREATE TYPE "Asset" AS ENUM ('MTN_MOMO', 'ORANGE_MONEY', 'MTN_AIRTIME', 'ORANGE_AIRTIME', 'MTN_DATA', 'ORANGE_DATA');

-- CreateEnum
CREATE TYPE "SimAccountType" AS ENUM ('BUSINESS', 'NORMAL');

-- CreateEnum
CREATE TYPE "ProcessingMethod" AS ENUM ('API', 'MANUAL_SOURCE');

-- CreateEnum
CREATE TYPE "ProviderCapabilityKind" AS ENUM ('COLLECT', 'DISBURSE', 'AIRTIME_TOPUP', 'DATA_BUNDLE', 'STATUS_QUERY');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('DISABLED', 'ENABLED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'FINANCE', 'OPERATIONS', 'SUPPORT');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'RETIRED');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('FIXED', 'PERCENTAGE', 'PERCENTAGE_PLUS_FIXED');

-- CreateEnum
CREATE TYPE "DeductionMethod" AS ENUM ('DEDUCT_FROM_SOURCE', 'DEDUCT_FROM_DESTINATION', 'ADD_TO_PAYMENT');

-- CreateEnum
CREATE TYPE "RoundingDirection" AS ENUM ('UP', 'DOWN', 'HALF_UP');

-- CreateEnum
CREATE TYPE "ProviderFeeSource" AS ENUM ('VERIFIED', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "TransactionState" AS ENUM ('CREATED', 'QUOTE_PENDING_CONFIRMATION', 'AWAITING_SOURCE_PAYMENT', 'AWAITING_MANUAL_VERIFICATION', 'SOURCE_VERIFIED', 'PAYMENT_PROCESSING', 'PAYOUT_PROCESSING', 'DELIVERY_PENDING', 'COMPLETED', 'REJECTED', 'FAILED', 'REFUND_PENDING', 'REFUNDED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('CUSTOMER', 'STAFF', 'SYSTEM', 'PROVIDER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'HIGH');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('AWAITING_CUSTOMER_REFERENCE', 'PENDING', 'AWAITING_SECOND_APPROVAL', 'CONFIRMED', 'REJECTED', 'ON_HOLD', 'ESCALATED');

-- CreateEnum
CREATE TYPE "OperationKind" AS ENUM ('COLLECT', 'DISBURSE', 'AIRTIME_TOPUP', 'DATA_BUNDLE', 'REFUND');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('REQUESTED', 'PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerBook" AS ENUM ('REAL', 'SIMULATED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phoneVerifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" "StaffRole"[],
    "totpSecretEncrypted" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "operator" "Operator" NOT NULL,
    "type" "SimAccountType" NOT NULL,
    "msisdnEncrypted" TEXT NOT NULL,
    "msisdnMasked" TEXT NOT NULL,
    "processingMethod" "ProcessingMethod" NOT NULL,
    "providerCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerifiedStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCapability" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "operator" "Operator" NOT NULL,
    "capability" "ProviderCapabilityKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceAsset" "Asset" NOT NULL,
    "destinationAsset" "Asset" NOT NULL,
    "processingMethod" "ProcessingMethod" NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'DISABLED',
    "requiredCapabilities" JSONB NOT NULL,
    "receivingSimId" TEXT,
    "quoteTtlSeconds" INTEGER NOT NULL DEFAULT 600,
    "allowEstimatedProviderFee" BOOLEAN NOT NULL DEFAULT false,
    "dualApprovalThreshold" INTEGER NOT NULL DEFAULT 50000,
    "verificationNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "feeType" "FeeType" NOT NULL,
    "percentageBps" INTEGER NOT NULL DEFAULT 0,
    "fixedFee" INTEGER NOT NULL DEFAULT 0,
    "minFee" INTEGER NOT NULL DEFAULT 0,
    "maxFee" INTEGER,
    "minAmount" INTEGER NOT NULL,
    "maxAmount" INTEGER NOT NULL,
    "deductionMethod" "DeductionMethod" NOT NULL,
    "conversionRatePpm" INTEGER NOT NULL DEFAULT 1000000,
    "feeRounding" "RoundingDirection" NOT NULL DEFAULT 'UP',
    "deliveryRounding" "RoundingDirection" NOT NULL DEFAULT 'DOWN',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "changeReason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderFeeRule" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "operator" "Operator" NOT NULL,
    "capability" "ProviderCapabilityKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "feeType" "FeeType" NOT NULL,
    "percentageBps" INTEGER NOT NULL DEFAULT 0,
    "fixedFee" INTEGER NOT NULL DEFAULT 0,
    "minFee" INTEGER NOT NULL DEFAULT 0,
    "maxFee" INTEGER,
    "source" "ProviderFeeSource" NOT NULL,
    "evidenceReference" TEXT,
    "deductedAtSettlement" BOOLEAN NOT NULL,
    "changeReason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderFeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "customerPays" INTEGER NOT NULL,
    "platformFee" INTEGER NOT NULL,
    "providerFee" INTEGER NOT NULL,
    "expectedDelivered" INTEGER NOT NULL,
    "senderMsisdn" TEXT NOT NULL,
    "recipientMsisdn" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "pricingRuleId" TEXT NOT NULL,
    "pricingRuleVersion" INTEGER NOT NULL,
    "providerFeeRuleId" TEXT,
    "providerFeeRuleVersion" INTEGER,
    "isEstimate" BOOLEAN NOT NULL,
    "isSimulated" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "state" "TransactionState" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "acceptedTerms" JSONB NOT NULL,
    "amount" INTEGER NOT NULL,
    "customerPays" INTEGER NOT NULL,
    "platformFee" INTEGER NOT NULL,
    "providerFee" INTEGER NOT NULL,
    "providerFeeCollectedBy" TEXT NOT NULL,
    "payoutInstructionAmount" INTEGER NOT NULL,
    "expectedDelivered" INTEGER NOT NULL,
    "senderMsisdn" TEXT NOT NULL,
    "recipientMsisdn" TEXT NOT NULL,
    "receivingSimId" TEXT,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "isSimulated" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionStateHistory" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "fromState" "TransactionState",
    "toState" "TransactionState" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionStateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceFile" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualVerification" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'AWAITING_CUSTOMER_REFERENCE',
    "expectedAmount" INTEGER NOT NULL,
    "receivingSimId" TEXT NOT NULL,
    "customerReference" TEXT,
    "evidenceFileIds" TEXT[],
    "submittedAt" TIMESTAMP(3),
    "requiresDualApproval" BOOLEAN NOT NULL,
    "receivedAmount" INTEGER,
    "evidenceNote" TEXT,
    "reason" TEXT,
    "firstReviewerId" TEXT,
    "firstReviewedAt" TIMESTAMP(3),
    "secondApproverId" TEXT,
    "secondApprovedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderOperation" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "kind" "OperationKind" NOT NULL,
    "operator" "Operator" NOT NULL,
    "providerCode" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payoutSlot" TEXT,
    "amount" INTEGER NOT NULL,
    "msisdn" TEXT NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'REQUESTED',
    "providerReference" TEXT,
    "failureReason" TEXT,
    "statusChecks" INTEGER NOT NULL DEFAULT 0,
    "simulated" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCallback" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "providerReference" TEXT,
    "payloadSha256" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderCallback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "book" "LedgerBook" NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerJournal" (
    "id" TEXT NOT NULL,
    "book" "LedgerBook" NOT NULL,
    "kind" TEXT NOT NULL,
    "transactionId" TEXT,
    "reversalOfId" TEXT,
    "memo" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "evidenceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "transactionId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestSha256" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SimAccount_code_key" ON "SimAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_code_key" ON "Provider"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCapability_providerId_operator_capability_key" ON "ProviderCapability"("providerId", "operator", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "Service_code_key" ON "Service"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_serviceId_version_key" ON "PricingRule"("serviceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderFeeRule_providerId_operator_capability_version_key" ON "ProviderFeeRule"("providerId", "operator", "capability", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reference_key" ON "Transaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_quoteId_key" ON "Transaction"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_customerId_idempotencyKey_key" ON "Transaction"("customerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceFile_storageKey_key" ON "EvidenceFile"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ManualVerification_transactionId_key" ON "ManualVerification"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderOperation_idempotencyKey_key" ON "ProviderOperation"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderOperation_payoutSlot_key" ON "ProviderOperation"("payoutSlot");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderOperation_providerReference_key" ON "ProviderOperation"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCallback_dedupeKey_key" ON "ProviderCallback"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_book_key" ON "LedgerAccount"("code", "book");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerJournal_reversalOfId_key" ON "LedgerJournal"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_key_key" ON "IdempotencyRecord"("key");

-- CreateIndex
CREATE INDEX "PricingRule_serviceId_status_idx" ON "PricingRule"("serviceId", "status");

-- CreateIndex
CREATE INDEX "Transaction_state_idx" ON "Transaction"("state");

-- CreateIndex
CREATE INDEX "TransactionStateHistory_transactionId_createdAt_idx" ON "TransactionStateHistory"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "ManualVerification_status_idx" ON "ManualVerification"("status");

-- CreateIndex
CREATE INDEX "ProviderOperation_transactionId_idx" ON "ProviderOperation"("transactionId");

-- CreateIndex
CREATE INDEX "ProviderOperation_status_idx" ON "ProviderOperation"("status");

-- CreateIndex
CREATE INDEX "LedgerJournal_transactionId_idx" ON "LedgerJournal"("transactionId");

-- CreateIndex
CREATE INDEX "Notification_customerId_createdAt_idx" ON "Notification"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ProviderCapability" ADD CONSTRAINT "ProviderCapability_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_receivingSimId_fkey" FOREIGN KEY ("receivingSimId") REFERENCES "SimAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderFeeRule" ADD CONSTRAINT "ProviderFeeRule_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionStateHistory" ADD CONSTRAINT "TransactionStateHistory_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualVerification" ADD CONSTRAINT "ManualVerification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderOperation" ADD CONSTRAINT "ProviderOperation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerJournal" ADD CONSTRAINT "LedgerJournal_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "LedgerJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
