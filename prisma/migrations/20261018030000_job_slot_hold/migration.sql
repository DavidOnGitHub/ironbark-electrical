-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "requestedAt" TIMESTAMP(3),
ADD COLUMN     "requestedEnd" TIMESTAMP(3),
ADD COLUMN     "requestedStart" TIMESTAMP(3),
ADD COLUMN     "requestedUserId" TEXT;
