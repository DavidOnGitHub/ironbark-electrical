-- CreateTable
CREATE TABLE "WatchCursor" (
    "key" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchCursor_pkey" PRIMARY KEY ("key")
);
