-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "RequestSource" AS ENUM ('EMAIL', 'PHONE', 'MANUAL', 'WEB');

-- CreateEnum
CREATE TYPE "RequestCategory" AS ENUM ('NEW_INSTALL', 'FAULT_REPAIR', 'QUOTE_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('NEW', 'CONTACTED', 'SITE_VISIT_BOOKED', 'QUOTED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'WORKFLOW', 'SYSTEM');

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "type" "ClientType" NOT NULL DEFAULT 'PERSON',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "emailNorm" TEXT,
    "phoneNorm" TEXT,
    "preferredContact" "ContactMethod" NOT NULL DEFAULT 'EMAIL',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "suburb" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NSW',
    "postcode" TEXT NOT NULL,
    "accessNotes" TEXT,
    "switchboardNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "siteId" TEXT,
    "source" "RequestSource" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "RequestCategory" NOT NULL DEFAULT 'OTHER',
    "urgency" "Urgency" NOT NULL DEFAULT 'ROUTINE',
    "status" "RequestStatus" NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerUserId" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "lostReason" TEXT,
    "rawEmailRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorLabel" TEXT,
    "clientId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT,
    "workflowInstanceId" TEXT,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_emailNorm_idx" ON "Client"("emailNorm");

-- CreateIndex
CREATE INDEX "Client_phoneNorm_idx" ON "Client"("phoneNorm");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Site_clientId_idx" ON "Site"("clientId");

-- CreateIndex
CREATE INDEX "Request_status_receivedAt_idx" ON "Request"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Request_clientId_idx" ON "Request"("clientId");

-- CreateIndex
CREATE INDEX "ActivityEvent_clientId_at_idx" ON "ActivityEvent"("clientId", "at" DESC);

-- CreateIndex
CREATE INDEX "ActivityEvent_entityType_entityId_at_idx" ON "ActivityEvent"("entityType", "entityId", "at" DESC);

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
