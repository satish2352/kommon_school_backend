-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'ADMIN', 'MARKETING');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ENROLLED', 'GRADUATED', 'SUSPENDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "EnrollmentRole" AS ENUM ('STUDENT', 'FRESH_GRADUATE', 'WORKING_PROFESSIONAL', 'CAREER_SWITCHER');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('SCHOOL', 'JR_COLLEGE', 'UNDERGRADUATE', 'GRADUATE', 'POST_GRADUATE', 'DOCTORATE', 'OTHER');

-- CreateEnum
CREATE TYPE "PlacementReadiness" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'READY_FOR_INTERVIEW');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('SOCIAL_MEDIA', 'COLLEGE', 'FRIEND', 'GOOGLE', 'OTHER');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'CREATED', 'IN_PROGRESS', 'PENDING', 'SUCCESS', 'FAILED', 'PARTIAL', 'REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentFailureType" AS ENUM ('USER_CANCELLED', 'PAYMENT_FAILED', 'GATEWAY_ERROR', 'NETWORK_ERROR');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('PAYMENT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP', 'CALLBACK', 'PAYMENT_PENDING', 'CONVERTED', 'NOT_INTERESTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('CALL', 'WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "InteractionOutcome" AS ENUM ('CONNECTED', 'NOT_CONNECTED', 'BUSY', 'WRONG_NUMBER', 'VOICEMAIL', 'CALLBACK_REQUESTED', 'INTERESTED', 'NOT_INTERESTED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "UserResponse" AS ENUM ('VERY_INTERESTED', 'INTERESTED', 'NEUTRAL', 'NOT_INTERESTED', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "logoUrl" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "phone" TEXT,
    "avatarUrl" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studentCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "grade" TEXT,
    "section" TEXT,
    "enrollmentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StudentStatus" NOT NULL DEFAULT 'ENROLLED',
    "guardianName" TEXT,
    "guardianPhone" TEXT,
    "guardianEmail" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "EnrollmentRole" NOT NULL,
    "education" "EducationLevel",
    "readiness" "PlacementReadiness",
    "source" "LeadSource",
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "tenantId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "razorpay_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "keySecret" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'test',
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "razorpay_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "failureType" "PaymentFailureType",
    "failureReason" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "baseAmount" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "finalAmount" INTEGER NOT NULL,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "remainingAmount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "clientConfirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "statusHistory" JSONB NOT NULL DEFAULT '[]',
    "attemptMetadata" JSONB NOT NULL DEFAULT '{}',
    "receipt" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_audit_logs" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "actor" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "description" TEXT,
    "reference" TEXT,
    "balanceBefore" INTEGER NOT NULL DEFAULT 0,
    "balanceAfter" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_api_logs" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "enrollmentId" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "requestBody" JSONB,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "error" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'NEW',
    "priority" "FollowUpPriority" NOT NULL DEFAULT 'MEDIUM',
    "callAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextFollowUpAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "paymentIntent" JSONB NOT NULL DEFAULT '{}',
    "notes" JSONB NOT NULL DEFAULT '[]',
    "interactions" JSONB NOT NULL DEFAULT '[]',
    "history" JSONB NOT NULL DEFAULT '[]',
    "tenantId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

-- CreateIndex
CREATE INDEX "tenants_slug_idx" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_domain_idx" ON "tenants"("domain");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_deletedAt_idx" ON "tenants"("deletedAt");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenantId_role_idx" ON "users"("tenantId", "role");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_tenantId_key" ON "users"("email", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenantId_idx" ON "refresh_tokens"("tenantId");

-- CreateIndex
CREATE INDEX "refresh_tokens_tokenHash_idx" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens"("family");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "students_userId_key" ON "students"("userId");

-- CreateIndex
CREATE INDEX "students_tenantId_idx" ON "students"("tenantId");

-- CreateIndex
CREATE INDEX "students_tenantId_status_idx" ON "students"("tenantId", "status");

-- CreateIndex
CREATE INDEX "students_tenantId_grade_idx" ON "students"("tenantId", "grade");

-- CreateIndex
CREATE INDEX "students_userId_idx" ON "students"("userId");

-- CreateIndex
CREATE INDEX "students_deletedAt_idx" ON "students"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenantId_studentCode_key" ON "students"("tenantId", "studentCode");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_enrollmentId_key" ON "enrollments"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_idempotencyKey_key" ON "enrollments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "enrollments_email_idx" ON "enrollments"("email");

-- CreateIndex
CREATE INDEX "enrollments_phone_idx" ON "enrollments"("phone");

-- CreateIndex
CREATE INDEX "enrollments_enrollmentId_idx" ON "enrollments"("enrollmentId");

-- CreateIndex
CREATE INDEX "enrollments_status_idx" ON "enrollments"("status");

-- CreateIndex
CREATE INDEX "enrollments_createdAt_idx" ON "enrollments"("createdAt");

-- CreateIndex
CREATE INDEX "razorpay_configs_isActive_idx" ON "razorpay_configs"("isActive");

-- CreateIndex
CREATE INDEX "razorpay_configs_tenantId_idx" ON "razorpay_configs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpayOrderId_key" ON "payments"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_razorpayPaymentId_key" ON "payments"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_enrollmentId_idx" ON "payments"("enrollmentId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_razorpayOrderId_idx" ON "payments"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "payments_razorpayPaymentId_idx" ON "payments"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "payments_expiresAt_idx" ON "payments"("expiresAt");

-- CreateIndex
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");

-- CreateIndex
CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");

-- CreateIndex
CREATE INDEX "payment_audit_logs_paymentId_idx" ON "payment_audit_logs"("paymentId");

-- CreateIndex
CREATE INDEX "payment_audit_logs_createdAt_idx" ON "payment_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_paymentId_idx" ON "ledger_entries"("paymentId");

-- CreateIndex
CREATE INDEX "ledger_entries_enrollmentId_idx" ON "ledger_entries"("enrollmentId");

-- CreateIndex
CREATE INDEX "ledger_entries_type_idx" ON "ledger_entries"("type");

-- CreateIndex
CREATE INDEX "ledger_entries_source_idx" ON "ledger_entries"("source");

-- CreateIndex
CREATE INDEX "ledger_entries_createdAt_idx" ON "ledger_entries"("createdAt");

-- CreateIndex
CREATE INDEX "webhook_events_processed_idx" ON "webhook_events"("processed");

-- CreateIndex
CREATE INDEX "webhook_events_paymentId_idx" ON "webhook_events"("paymentId");

-- CreateIndex
CREATE INDEX "webhook_events_eventType_idx" ON "webhook_events"("eventType");

-- CreateIndex
CREATE INDEX "webhook_events_createdAt_idx" ON "webhook_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_eventId_key" ON "webhook_events"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_key_idx" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE INDEX "external_api_logs_syncStatus_idx" ON "external_api_logs"("syncStatus");

-- CreateIndex
CREATE INDEX "external_api_logs_paymentId_idx" ON "external_api_logs"("paymentId");

-- CreateIndex
CREATE INDEX "external_api_logs_enrollmentId_idx" ON "external_api_logs"("enrollmentId");

-- CreateIndex
CREATE INDEX "external_api_logs_nextRetryAt_idx" ON "external_api_logs"("nextRetryAt");

-- CreateIndex
CREATE INDEX "external_api_logs_createdAt_idx" ON "external_api_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_enrollmentId_key" ON "follow_ups"("enrollmentId");

-- CreateIndex
CREATE INDEX "follow_ups_status_idx" ON "follow_ups"("status");

-- CreateIndex
CREATE INDEX "follow_ups_priority_idx" ON "follow_ups"("priority");

-- CreateIndex
CREATE INDEX "follow_ups_assignedToId_idx" ON "follow_ups"("assignedToId");

-- CreateIndex
CREATE INDEX "follow_ups_nextFollowUpAt_idx" ON "follow_ups"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "follow_ups_lastActivityAt_idx" ON "follow_ups"("lastActivityAt");

-- CreateIndex
CREATE INDEX "follow_ups_dueAt_idx" ON "follow_ups"("dueAt");

-- CreateIndex
CREATE INDEX "follow_ups_tenantId_idx" ON "follow_ups"("tenantId");

-- CreateIndex
CREATE INDEX "follow_ups_createdAt_idx" ON "follow_ups"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_api_logs" ADD CONSTRAINT "external_api_logs_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

