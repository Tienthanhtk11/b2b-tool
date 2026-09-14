-- CreateEnum
CREATE TYPE "ItemRowStatus" AS ENUM ('PENDING', 'SYNCED', 'SKIPPED', 'FAILED');

-- AlterEnum
ALTER TYPE "SyncType" ADD VALUE 'ITEM_SYNC';

-- CreateTable
CREATE TABLE "NetSuiteItemState" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "netsuiteItemId" TEXT,
    "basePrice" DECIMAL(12,2),
    "quantityAvailable" INTEGER,
    "variantId" TEXT,
    "inventoryItemId" TEXT,
    "priceStatus" "ItemRowStatus" NOT NULL DEFAULT 'PENDING',
    "inventoryStatus" "ItemRowStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetSuiteItemState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "NetSuiteItemState_sku_key" ON "NetSuiteItemState"("sku");

-- CreateIndex
CREATE INDEX "NetSuiteItemState_priceStatus_idx" ON "NetSuiteItemState"("priceStatus");

-- CreateIndex
CREATE INDEX "NetSuiteItemState_inventoryStatus_idx" ON "NetSuiteItemState"("inventoryStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PricingGroup_priceListId_key" ON "PricingGroup"("priceListId");
