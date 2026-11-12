-- CreateEnum
CREATE TYPE "ItRequestKind" AS ENUM ('FEATURE', 'ERROR', 'FINDING');

-- CreateEnum
CREATE TYPE "ItRequestStatus" AS ENUM ('SUBMITTED', 'DRAFTING_SPEC', 'NEEDS_ANSWERS', 'SPEC_REVIEW', 'BUILDING', 'BUILD_FAILED', 'PR_OPEN', 'ACCEPTED', 'MERGED', 'CLOSED', 'FAILED');

-- CreateTable
CREATE TABLE "ItRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "ItRequestKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ItRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "sessionId" TEXT,
    "sessionStatus" TEXT,
    "prUrl" TEXT,
    "previewUrl" TEXT,
    "costUsd" DOUBLE PRECISION,
    "context" JSONB,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "intent" TEXT,
    "requestedByUserId" TEXT,
    "requestedByLabel" TEXT NOT NULL,
    "requestedByEmail" TEXT,
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "startingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItRequest_number_key" ON "ItRequest"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ItRequest_sessionId_key" ON "ItRequest"("sessionId");

-- CreateIndex
CREATE INDEX "ItRequest_status_createdAt_idx" ON "ItRequest"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ItRequest_sourceType_sourceId_idx" ON "ItRequest"("sourceType", "sourceId");
