import {
  ItemRowStatus,
  SyncTrigger,
  SyncType,
  type Prisma,
} from "@prisma/client";
import prisma from "../db.server";
import { chunk, parseDecimal } from "../utils/numbers";
import {
  adminGraphql,
  throwUserErrors,
  type AdminClient,
  type GraphQLUserError,
} from "./admin-graphql.server";
import { parseItemsCsv } from "./csv";
import { logError } from "./logger.server";
import { getNetSuiteClient } from "./netsuite/index.server";
import { B2B_LOCATION_SETTING_KEY, getAppSetting } from "./settings.server";
import { getAdminClient, getTargetShop } from "./shops.server";
import { resolveVariantBySku } from "./sku-resolve.server";
import {
  createSyncRun,
  finishSyncRun,
  syncRunStatusFromCounts,
} from "./sync-run.server";

const VARIANT_PRICE_BATCH_SIZE = 100;
const INVENTORY_BATCH_SIZE = 100;

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `#graphql
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const INVENTORY_SET_QUANTITIES_MUTATION = `#graphql
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        reason
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const LOCATIONS_QUERY = `#graphql
  query ShopLocations($first: Int!) {
    locations(first: $first) {
      nodes {
        id
        name
        isActive
      }
    }
  }
`;

export async function listShopLocations(): Promise<
  Array<{ id: string; name: string; isActive: boolean }>
> {
  const admin = await getAdminClient(getTargetShop());
  const data = await adminGraphql<{
    locations: {
      nodes: Array<{ id: string; name: string; isActive: boolean }>;
    };
  }>(admin, LOCATIONS_QUERY, { first: 20 });
  return data.locations.nodes;
}

export async function importItems(): Promise<{ imported: number; invalid: number }> {
  const client = getNetSuiteClient();
  const items = await client.fetchItems();
  let invalid = 0;

  for (const item of items) {
    const parsedPrice =
      item.basePrice == null ? null : parseDecimal(item.basePrice);
    const invalidPrice =
      item.basePrice != null && (parsedPrice == null || parsedPrice <= 0);
    if (invalidPrice) invalid += 1;

    await prisma.netSuiteItemState.upsert({
      where: { sku: item.sku },
      create: {
        sku: item.sku,
        netsuiteItemId: item.itemId,
        basePrice: parsedPrice != null && parsedPrice > 0 ? parsedPrice : null,
        quantityAvailable: item.quantityAvailable,
        priceStatus: invalidPrice ? ItemRowStatus.SKIPPED : ItemRowStatus.PENDING,
        inventoryStatus: ItemRowStatus.PENDING,
        statusReason: invalidPrice ? "INVALID_PRICE" : null,
      },
      update: {
        netsuiteItemId: item.itemId,
        basePrice: parsedPrice != null && parsedPrice > 0 ? parsedPrice : null,
        quantityAvailable: item.quantityAvailable,
        priceStatus: invalidPrice ? ItemRowStatus.SKIPPED : ItemRowStatus.PENDING,
        inventoryStatus: ItemRowStatus.PENDING,
        statusReason: invalidPrice ? "INVALID_PRICE" : null,
      },
    });
  }

  return { imported: items.length, invalid };
}

async function updateItemRow(
  id: string,
  data: Prisma.NetSuiteItemStateUpdateInput,
): Promise<void> {
  await prisma.netSuiteItemState.update({ where: { id }, data });
}

export async function syncItemPrices(
  opts: { trigger: SyncTrigger; actor?: string } = { trigger: SyncTrigger.MANUAL },
): Promise<{ successCount: number; skippedCount: number; failedCount: number }> {
  const syncRun = await createSyncRun({
    type: SyncType.ITEM_SYNC,
    trigger: opts.trigger,
    subjectType: "ItemPrices",
    triggeredBy: opts.actor,
  });

  const counts = { successCount: 0, skippedCount: 0, failedCount: 0 };
  const errorDetails: Array<{ sku: string; message: string }> = [];

  try {
    const admin = await getAdminClient(getTargetShop());
    const rows = await prisma.netSuiteItemState.findMany();
    const byProduct = new Map<
      string,
      Array<{ id: string; sku: string; variantId: string; price: string }>
    >();

    for (const row of rows) {
      if (row.priceStatus === ItemRowStatus.SKIPPED && row.statusReason === "INVALID_PRICE") {
        counts.skippedCount += 1;
        continue;
      }
      if (row.basePrice == null) {
        await updateItemRow(row.id, {
          priceStatus: ItemRowStatus.SKIPPED,
          statusReason: "INVALID_PRICE",
        });
        counts.skippedCount += 1;
        continue;
      }

      const resolved = await resolveVariantBySku(admin, row.sku);
      if (resolved.kind !== "valid") {
        await updateItemRow(row.id, {
          priceStatus: ItemRowStatus.SKIPPED,
          statusReason: resolved.reason,
          variantId: null,
          inventoryItemId: null,
        });
        counts.skippedCount += 1;
        continue;
      }

      await updateItemRow(row.id, {
        variantId: resolved.variant.id,
        inventoryItemId: resolved.variant.inventoryItemId,
      });

      const productId = resolved.variant.productId;
      const list = byProduct.get(productId) ?? [];
      list.push({
        id: row.id,
        sku: row.sku,
        variantId: resolved.variant.id,
        price: row.basePrice.toFixed(2),
      });
      byProduct.set(productId, list);
    }

    for (const [productId, variants] of byProduct.entries()) {
      for (const batch of chunk(variants, VARIANT_PRICE_BATCH_SIZE)) {
        try {
          await bulkUpdateVariantPrices(admin, productId, batch);
          const syncedAt = new Date();
          await prisma.netSuiteItemState.updateMany({
            where: { id: { in: batch.map((item) => item.id) } },
            data: {
              priceStatus: ItemRowStatus.SYNCED,
              statusReason: null,
              lastSyncedAt: syncedAt,
            },
          });
          counts.successCount += batch.length;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "productVariantsBulkUpdate failed";
          logError(`Item price sync failed for product ${productId}`, error);
          await prisma.netSuiteItemState.updateMany({
            where: { id: { in: batch.map((item) => item.id) } },
            data: {
              priceStatus: ItemRowStatus.FAILED,
              statusReason: message,
            },
          });
          counts.failedCount += batch.length;
          errorDetails.push(
            ...batch.map((item) => ({ sku: item.sku, message })),
          );
        }
      }
    }

    await finishSyncRun(syncRun.id, syncRunStatusFromCounts(counts), {
      ...counts,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    });
    return counts;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Item price sync failed";
    logError("syncItemPrices failed", error);
    await finishSyncRun(syncRun.id, syncRunStatusFromCounts({
      ...counts,
      failedCount: Math.max(counts.failedCount, 1),
    }), {
      ...counts,
      failedCount: Math.max(counts.failedCount, 1),
      errorDetails: { message },
    });
    throw error;
  }
}

async function bulkUpdateVariantPrices(
  admin: AdminClient,
  productId: string,
  variants: Array<{ variantId: string; price: string }>,
): Promise<void> {
  const result = await adminGraphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string; price: string }> | null;
      userErrors: GraphQLUserError[];
    };
  }>(admin, PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
    productId,
    variants: variants.map((variant) => ({
      id: variant.variantId,
      price: variant.price,
    })),
  });
  throwUserErrors(
    "productVariantsBulkUpdate",
    result.productVariantsBulkUpdate.userErrors,
  );
}

export async function syncInventory(
  opts: { trigger: SyncTrigger; actor?: string } = { trigger: SyncTrigger.MANUAL },
): Promise<{ successCount: number; skippedCount: number; failedCount: number }> {
  const locationId = await getAppSetting(B2B_LOCATION_SETTING_KEY);
  if (!locationId) {
    throw new Error("b2b_location_id is not configured in Settings");
  }

  const syncRun = await createSyncRun({
    type: SyncType.ITEM_SYNC,
    trigger: opts.trigger,
    subjectType: "ItemInventory",
    triggeredBy: opts.actor,
  });

  const counts = { successCount: 0, skippedCount: 0, failedCount: 0 };
  const errorDetails: Array<{ sku: string; message: string }> = [];

  try {
    const admin = await getAdminClient(getTargetShop());
    const rows = await prisma.netSuiteItemState.findMany();
    const ready: Array<{
      id: string;
      sku: string;
      inventoryItemId: string;
      quantity: number;
    }> = [];

    for (const row of rows) {
      if (row.quantityAvailable == null) {
        await updateItemRow(row.id, {
          inventoryStatus: ItemRowStatus.SKIPPED,
          statusReason: row.statusReason ?? "MISSING_QUANTITY",
        });
        counts.skippedCount += 1;
        continue;
      }

      let inventoryItemId = row.inventoryItemId;
      let variantId = row.variantId;
      if (!inventoryItemId || !variantId) {
        const resolved = await resolveVariantBySku(admin, row.sku);
        if (resolved.kind !== "valid") {
          await updateItemRow(row.id, {
            inventoryStatus: ItemRowStatus.SKIPPED,
            statusReason: resolved.reason,
          });
          counts.skippedCount += 1;
          continue;
        }
        if (!resolved.variant.inventoryItemId) {
          await updateItemRow(row.id, {
            inventoryStatus: ItemRowStatus.SKIPPED,
            statusReason: "MISSING_INVENTORY_ITEM",
            variantId: resolved.variant.id,
          });
          counts.skippedCount += 1;
          continue;
        }
        inventoryItemId = resolved.variant.inventoryItemId;
        variantId = resolved.variant.id;
        await updateItemRow(row.id, {
          variantId,
          inventoryItemId,
        });
      }

      ready.push({
        id: row.id,
        sku: row.sku,
        inventoryItemId,
        quantity: row.quantityAvailable,
      });
    }

    for (const batch of chunk(ready, INVENTORY_BATCH_SIZE)) {
      try {
        await setInventoryQuantities(admin, locationId, batch, syncRun.id);
        const syncedAt = new Date();
        await prisma.netSuiteItemState.updateMany({
          where: { id: { in: batch.map((item) => item.id) } },
          data: {
            inventoryStatus: ItemRowStatus.SYNCED,
            lastSyncedAt: syncedAt,
          },
        });
        counts.successCount += batch.length;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "inventorySetQuantities failed";
        logError("Inventory sync batch failed", error);
        await prisma.netSuiteItemState.updateMany({
          where: { id: { in: batch.map((item) => item.id) } },
          data: {
            inventoryStatus: ItemRowStatus.FAILED,
            statusReason: message,
          },
        });
        counts.failedCount += batch.length;
        errorDetails.push(...batch.map((item) => ({ sku: item.sku, message })));
      }
    }

    await finishSyncRun(syncRun.id, syncRunStatusFromCounts(counts), {
      ...counts,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    });
    return counts;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inventory sync failed";
    logError("syncInventory failed", error);
    await finishSyncRun(syncRun.id, syncRunStatusFromCounts({
      ...counts,
      failedCount: Math.max(counts.failedCount, 1),
    }), {
      ...counts,
      failedCount: Math.max(counts.failedCount, 1),
      errorDetails: { message },
    });
    throw error;
  }
}

async function setInventoryQuantities(
  admin: AdminClient,
  locationId: string,
  items: Array<{ inventoryItemId: string; quantity: number }>,
  runId: string,
): Promise<void> {
  const result = await adminGraphql<{
    inventorySetQuantities: {
      inventoryAdjustmentGroup: { reason: string } | null;
      userErrors: GraphQLUserError[];
    };
  }>(admin, INVENTORY_SET_QUANTITIES_MUTATION, {
    input: {
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: true,
      referenceDocumentUri: `gid://b2b-tool/ItemSync/${runId}`,
      quantities: items.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        locationId,
        quantity: item.quantity,
      })),
    },
  });
  throwUserErrors(
    "inventorySetQuantities",
    result.inventorySetQuantities.userErrors,
  );
}

export async function importItemsCsv(
  text: string,
  actor = "system",
): Promise<{ imported: number }> {
  const rows = parseItemsCsv(text).filter((row) => row.sku);
  for (const row of rows) {
    const parsedPrice = parseDecimal(row.basePrice);
    const quantity = parseDecimal(row.quantity);
    const invalidPrice = parsedPrice == null || parsedPrice <= 0;
    await prisma.netSuiteItemState.upsert({
      where: { sku: row.sku },
      create: {
        sku: row.sku,
        basePrice: invalidPrice ? null : parsedPrice,
        quantityAvailable: quantity == null ? null : Math.trunc(quantity),
        priceStatus: invalidPrice ? ItemRowStatus.SKIPPED : ItemRowStatus.PENDING,
        inventoryStatus: ItemRowStatus.PENDING,
        statusReason: invalidPrice ? "INVALID_PRICE" : null,
      },
      update: {
        basePrice: invalidPrice ? null : parsedPrice,
        quantityAvailable: quantity == null ? null : Math.trunc(quantity),
        priceStatus: invalidPrice ? ItemRowStatus.SKIPPED : ItemRowStatus.PENDING,
        inventoryStatus: ItemRowStatus.PENDING,
        statusReason: invalidPrice ? "INVALID_PRICE" : null,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      actor,
      action: "ITEMS_CSV_IMPORTED",
      entityType: "NetSuiteItemState",
      entityId: "csv",
      details: { imported: rows.length, trigger: "MANUAL" },
    },
  });

  return { imported: rows.length };
}
