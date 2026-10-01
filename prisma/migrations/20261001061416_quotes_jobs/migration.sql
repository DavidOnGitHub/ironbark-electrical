-- CreateEnum
CREATE TYPE "PriceKind" AS ENUM ('LABOUR', 'CALL_OUT', 'STANDARD_JOB', 'MATERIAL');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('UNSCHEDULED', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'INVOICED', 'PAID');

-- CreateEnum
CREATE TYPE "JobNoteKind" AS ENUM ('NOTE', 'VARIATION');

-- CreateTable
CREATE TABLE "Sequence" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PriceItem" (
    "id" TEXT NOT NULL,
    "kind" "PriceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "costCents" INTEGER,
    "markupPct" INTEGER,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT,
    "requestId" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "depositRequired" BOOLEAN NOT NULL DEFAULT false,
    "depositPct" INTEGER NOT NULL DEFAULT 0,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "gstCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "priceItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'each',
    "unitPriceCents" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteId" TEXT,
    "quoteId" TEXT,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'UNSCHEDULED',
    "assignedUserId" TEXT,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "quotedSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobNote" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorLabel" TEXT NOT NULL,
    "kind" "JobNoteKind" NOT NULL DEFAULT 'NOTE',
    "text" TEXT NOT NULL,
    "extraCents" INTEGER,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceItem_kind_active_idx" ON "PriceItem"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "Quote_clientId_idx" ON "Quote"("clientId");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_position_idx" ON "QuoteLine"("quoteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Job_number_key" ON "Job"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Job_quoteId_key" ON "Job"("quoteId");

-- CreateIndex
CREATE INDEX "Job_assignedUserId_scheduledStart_idx" ON "Job"("assignedUserId", "scheduledStart");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "JobNote_jobId_createdAt_idx" ON "JobNote"("jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_priceItemId_fkey" FOREIGN KEY ("priceItemId") REFERENCES "PriceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobNote" ADD CONSTRAINT "JobNote_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
