-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "acceptToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_acceptToken_key" ON "Quote"("acceptToken");
