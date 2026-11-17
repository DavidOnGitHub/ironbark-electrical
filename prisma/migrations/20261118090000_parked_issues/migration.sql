-- AlterEnum
ALTER TYPE "ItRequestStatus" ADD VALUE 'PARKED';

-- AlterTable
ALTER TABLE "ItRequest" ADD COLUMN     "parked" BOOLEAN NOT NULL DEFAULT false;
