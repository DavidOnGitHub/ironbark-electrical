-- AlterTable
ALTER TABLE "ErrorEvent" ADD COLUMN     "classConfidence" TEXT,
ADD COLUMN     "classReason" TEXT,
ADD COLUMN     "classSource" TEXT,
ADD COLUMN     "classification" TEXT,
ADD COLUMN     "classifiedAt" TIMESTAMP(3);
