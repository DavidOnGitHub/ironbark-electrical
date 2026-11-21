-- AlterTable
ALTER TABLE "ItRequest" ADD COLUMN     "credits" INTEGER,
ADD COLUMN     "creditsChargedAt" TIMESTAMP(3),
ADD COLUMN     "estimateSize" TEXT;

-- CreateIndex
CREATE INDEX "ItRequest_creditsChargedAt_idx" ON "ItRequest"("creditsChargedAt");
