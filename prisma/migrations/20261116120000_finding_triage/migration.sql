-- AlterTable
ALTER TABLE "Finding" ADD COLUMN "triageVerdict" TEXT,
ADD COLUMN "triageConfidence" TEXT,
ADD COLUMN "triageReason" TEXT,
ADD COLUMN "triageDuplicateOf" TEXT,
ADD COLUMN "triagedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Finding_triagedAt_idx" ON "Finding"("triagedAt");
