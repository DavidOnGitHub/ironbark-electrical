-- AlterTable
ALTER TABLE "ItRequest" ADD COLUMN     "needsDeveloper" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "protectedFiles" TEXT[],
ADD COLUMN     "liveAt" TIMESTAMP(3),
ADD COLUMN     "revertCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ErrorBucket" (
    "errorId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ErrorBucket_pkey" PRIMARY KEY ("errorId","startsAt")
);

-- CreateIndex
CREATE INDEX "ErrorBucket_startsAt_idx" ON "ErrorBucket"("startsAt");
