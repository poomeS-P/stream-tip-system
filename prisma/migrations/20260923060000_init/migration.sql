-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('PENDING', 'PLAYING', 'COMPLETED', 'SKIPPED', 'MUTED', 'BLOCKED');

-- CreateTable
CREATE TABLE "Tip" (
    "id" TEXT NOT NULL,
    "donorName" VARCHAR(50) NOT NULL,
    "rawDonorName" VARCHAR(50) NOT NULL,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'THB',
    "message" VARCHAR(255),
    "cleanMessage" VARCHAR(255),
    "hasFilteredWord" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "tipId" TEXT NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "providerTxId" TEXT,
    "amountCharged" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "checkoutUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertQueue" (
    "id" TEXT NOT NULL,
    "tipId" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "soundUrl" VARCHAR(255),
    "durationSeconds" INTEGER NOT NULL DEFAULT 8,
    "ttsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "displayedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEventLog" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "streamerName" TEXT NOT NULL DEFAULT 'Streamer',
    "minTipAmount" DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    "maxMessageLength" INTEGER NOT NULL DEFAULT 150,
    "minAmountForTTS" DECIMAL(10,2) NOT NULL DEFAULT 20.00,
    "alertDurationSec" INTEGER NOT NULL DEFAULT 8,
    "emergencyAlertMuted" BOOLEAN NOT NULL DEFAULT false,
    "emergencyTTSMuted" BOOLEAN NOT NULL DEFAULT false,
    "bannedWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockEntireMessage" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tip_createdAt_idx" ON "Tip"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_tipId_key" ON "PaymentTransaction"("tipId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_providerTxId_key" ON "PaymentTransaction"("providerTxId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_providerTxId_idx" ON "PaymentTransaction"("providerTxId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_idx" ON "PaymentTransaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AlertQueue_tipId_key" ON "AlertQueue"("tipId");

-- CreateIndex
CREATE INDEX "AlertQueue_status_priority_createdAt_idx" ON "AlertQueue"("status", "priority", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEventLog_eventId_key" ON "WebhookEventLog"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEventLog_eventId_idx" ON "WebhookEventLog"("eventId");

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_tipId_fkey" FOREIGN KEY ("tipId") REFERENCES "Tip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertQueue" ADD CONSTRAINT "AlertQueue_tipId_fkey" FOREIGN KEY ("tipId") REFERENCES "Tip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

