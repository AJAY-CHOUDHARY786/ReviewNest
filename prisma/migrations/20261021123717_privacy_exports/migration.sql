-- CreateTable
CREATE TABLE "PrivacyExport" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivacyExport_shopId_expiresAt_idx" ON "PrivacyExport"("shopId", "expiresAt");

-- AddForeignKey
ALTER TABLE "PrivacyExport" ADD CONSTRAINT "PrivacyExport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
