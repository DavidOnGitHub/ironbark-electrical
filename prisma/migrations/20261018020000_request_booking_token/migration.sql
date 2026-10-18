-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "bookingToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Request_bookingToken_key" ON "Request"("bookingToken");
