-- AlterEnum
ALTER TYPE "ItRequestStatus" ADD VALUE 'LIVE';
ALTER TYPE "ItRequestStatus" ADD VALUE 'DEPLOY_FAILED';

-- AlterTable
ALTER TABLE "ItRequest" ADD COLUMN "mergedAt" TIMESTAMP(3),
ADD COLUMN "deployError" TEXT,
ADD COLUMN "deployUrl" TEXT,
ADD COLUMN "deployFixId" TEXT;
