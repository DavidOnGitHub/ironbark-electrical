-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'FIXING', 'FIXED', 'ACCEPTED_RISK', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "file" TEXT,
    "line" INTEGER,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'scan',
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "lastScanId" TEXT NOT NULL,
    "firstScanId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "fixedAt" TIMESTAMP(3),
    "itRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityScan" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tools" TEXT[],
    "commit" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" INTEGER NOT NULL,
    "bySeverity" JSONB NOT NULL,

    CONSTRAINT "SecurityScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Finding_fingerprint_key" ON "Finding"("fingerprint");

-- CreateIndex
CREATE INDEX "Finding_status_severity_idx" ON "Finding"("status", "severity");

-- CreateIndex
CREATE INDEX "Finding_tool_status_idx" ON "Finding"("tool", "status");

-- CreateIndex
CREATE INDEX "SecurityScan_receivedAt_idx" ON "SecurityScan"("receivedAt" DESC);
