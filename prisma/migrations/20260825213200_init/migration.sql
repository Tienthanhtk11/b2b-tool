-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('NEEDS_MAPPING', 'READY', 'SYNCING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('SKU_SUGGESTION', 'MANUAL');

-- CreateEnum
CREATE TYPE "PricingGroupStatus" AS ENUM ('UNMAPPED', 'READY', 'SYNCING', 'SYNCED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "PriceRowStatus" AS ENUM ('PENDING', 'SYNCED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'UNASSIGNED', 'CONFLICT', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('PRODUCT_SYNC', 'PRICING_SYNC', 'ASSIGNMENT');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('WEBHOOK', 'MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceImageUrl" TEXT,
    "targetProductId" TEXT,
    "targetTitle" TEXT,
    "targetImageUrl" TEXT,
    "matchMethod" "MatchMethod",
    "status" "MappingStatus" NOT NULL DEFAULT 'NEEDS_MAPPING',
    "sourceUpdatedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantMapping" (
    "id" TEXT NOT NULL,
    "productMappingId" TEXT NOT NULL,
    "sourceVariantId" TEXT NOT NULL,
    "targetVariantId" TEXT,
    "sku" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payloadHash" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingGroup" (
    "id" TEXT NOT NULL,
    "netsuiteGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "catalogId" TEXT,
    "priceListId" TEXT,
    "status" "PricingGroupStatus" NOT NULL DEFAULT 'UNMAPPED',
    "skuCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPrice" (
    "id" TEXT NOT NULL,
    "pricingGroupId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "netsuiteItemId" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "variantId" TEXT,
    "status" "PriceRowStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationAssignment" (
    "id" TEXT NOT NULL,
    "companyLocationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "pricingGroupId" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "lastError" TEXT,
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "type" "SyncType" NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "subjectType" TEXT,
    "subjectId" TEXT,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorDetails" JSONB,
    "triggeredBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_sourceProductId_key" ON "ProductMapping"("sourceProductId");

-- CreateIndex
CREATE INDEX "ProductMapping_status_idx" ON "ProductMapping"("status");

-- CreateIndex
CREATE INDEX "ProductMapping_targetProductId_idx" ON "ProductMapping"("targetProductId");

-- CreateIndex
CREATE INDEX "VariantMapping_sku_idx" ON "VariantMapping"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "VariantMapping_productMappingId_sourceVariantId_key" ON "VariantMapping"("productMappingId", "sourceVariantId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shop_topic_idx" ON "WebhookEvent"("shop", "topic");

-- CreateIndex
CREATE UNIQUE INDEX "PricingGroup_netsuiteGroupId_key" ON "PricingGroup"("netsuiteGroupId");

-- CreateIndex
CREATE INDEX "PricingGroup_status_idx" ON "PricingGroup"("status");

-- CreateIndex
CREATE INDEX "GroupPrice_sku_idx" ON "GroupPrice"("sku");

-- CreateIndex
CREATE INDEX "GroupPrice_status_idx" ON "GroupPrice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPrice_pricingGroupId_sku_key" ON "GroupPrice"("pricingGroupId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "LocationAssignment_companyLocationId_key" ON "LocationAssignment"("companyLocationId");

-- CreateIndex
CREATE INDEX "LocationAssignment_companyId_idx" ON "LocationAssignment"("companyId");

-- CreateIndex
CREATE INDEX "LocationAssignment_status_idx" ON "LocationAssignment"("status");

-- CreateIndex
CREATE INDEX "SyncRun_type_startedAt_idx" ON "SyncRun"("type", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_status_idx" ON "SyncRun"("status");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "VariantMapping" ADD CONSTRAINT "VariantMapping_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPrice" ADD CONSTRAINT "GroupPrice_pricingGroupId_fkey" FOREIGN KEY ("pricingGroupId") REFERENCES "PricingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationAssignment" ADD CONSTRAINT "LocationAssignment_pricingGroupId_fkey" FOREIGN KEY ("pricingGroupId") REFERENCES "PricingGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
