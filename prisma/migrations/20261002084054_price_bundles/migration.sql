-- CreateTable
CREATE TABLE "PriceBundle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBundleItem" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "priceItemId" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PriceBundleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceBundle_name_key" ON "PriceBundle"("name");

-- CreateIndex
CREATE INDEX "PriceBundleItem_bundleId_sortOrder_idx" ON "PriceBundleItem"("bundleId", "sortOrder");

-- AddForeignKey
ALTER TABLE "PriceBundleItem" ADD CONSTRAINT "PriceBundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "PriceBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBundleItem" ADD CONSTRAINT "PriceBundleItem_priceItemId_fkey" FOREIGN KEY ("priceItemId") REFERENCES "PriceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
