import {
  PriceRowStatus,
  PricingGroupStatus,
  Prisma,
  SyncTrigger,
  SyncType,
  type PricingGroup,
} from "@prisma/client";
import prisma from "../db.server";
import { chunk, parseDecimal } from "../utils/numbers";
import {
  adminGraphql,
  throwUserErrors,
  type GraphQLUserError,
} from "./admin-graphql.server";
import { parsePricingCsv } from "./csv";
import { logError } from "./logger.server";
import { getNetSuiteClient } from "./netsuite/index.server";
import { getAdminClient, getTargetShop } from "./shops.server";
import { resolveVariantBySku } from "./sku-resolve.server";
import {
  addFixedPrices,
  PRICE_LIST_BATCH_SIZE,
  type FixedPriceInput,
} from "./price-list.server";
import {
  createSyncRun,
  finishSyncRun,
  syncRunStatusFromCounts,
} from "./sync-run.server";

export { PRICE_LIST_BATCH_SIZE, addFixedPrices, toFixedPriceInput } from "./price-list.server";
export type { FixedPriceInput } from "./price-list.server";

const CATALOG_CREATE_MUTATION = `#graphql
  mutation CatalogCreate($input: CatalogCreateInput!) {
    catalogCreate(input: $input) {
      catalog {
        id
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PUBLICATION_CREATE_MUTATION = `#graphql
  mutation PublicationCreate($input: PublicationCreateInput!) {
    publicationCreate(input: $input) {
      publication {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRICE_LIST_CREATE_MUTATION = `#graphql
  mutation PriceListCreate($input: PriceListCreateInput!) {
    priceListCreate(input: $input) {
      priceList {
        id
        name
        currency
        catalog {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRICE_LIST_BY_ID_QUERY = `#graphql
  query PriceListById($id: ID!) {
    priceList(id: $id) {
      id
      name
      currency
      catalog {
        id
      }
      prices(first: 250) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          price {
            amount
            currencyCode
          }
          variant {
            id
            sku
          }
        }
      }
    }
  }
`;

const CATALOGS_QUERY = `#graphql
  query CompanyLocationCatalogs($first: Int!, $after: String) {
    catalogs(first: $first, after: $after, type: COMPANY_LOCATION) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        priceList {
          id
          name
          currency
        }
      }
    }
  }
`;

export async function importPricingGroups(): Promise<{
  imported: number;
  missingFromSource: number;
}> {
  const client = getNetSuiteClient();
  const groups = await client.fetchPricingGroups();
  const existing = await prisma.pricingGroup.findMany();
  const incomingIds = new Set(groups.map((group) => group.id));

  for (const group of groups) {
    await prisma.pricingGroup.upsert({
      where: { netsuiteGroupId: group.id },
      create: {
        netsuiteGroupId: group.id,
        name: group.name,
        currency: "CAD",
      },
      update: {
        name: group.name,
        lastError: null,
      },
    });
  }

  let missingFromSource = 0;
  for (const group of existing) {
    if (!incomingIds.has(group.netsuiteGroupId)) {
      missingFromSource += 1;
      await prisma.pricingGroup.update({
        where: { id: group.id },
        data: { lastError: "Missing from latest NetSuite import" },
      });
    }
  }

  return { imported: groups.length, missingFromSource };
}

function rowStatusForPrice(price: string): {
  amount: Prisma.Decimal;
  status: PriceRowStatus;
  statusReason: string | null;
} {
  const parsed = parseDecimal(price);
  if (parsed == null || parsed <= 0) {
    return {
      amount: new Prisma.Decimal(0),
      status: PriceRowStatus.SKIPPED,
      statusReason: "INVALID_PRICE",
    };
  }
  return {
    amount: new Prisma.Decimal(parsed.toFixed(2)),
    status: PriceRowStatus.PENDING,
    statusReason: null,
  };
}

export async function importGroupPrices(pricingGroupId: string): Promise<{
  upserted: number;
  orphaned: number;
  invalid: number;
}> {
  const group = await prisma.pricingGroup.findUniqueOrThrow({
    where: { id: pricingGroupId },
  });
  const client = getNetSuiteClient();
  const prices = await client.fetchGroupPrices(group.netsuiteGroupId);
  const incomingSkus = new Set(prices.map((price) => price.sku));

  let invalid = 0;
  for (const price of prices) {
    const next = rowStatusForPrice(price.price);
    if (next.statusReason === "INVALID_PRICE") {
      invalid += 1;
    }
    await prisma.groupPrice.upsert({
      where: {
        pricingGroupId_sku: {
          pricingGroupId,
          sku: price.sku,
        },
      },
      create: {
        pricingGroupId,
        sku: price.sku,
        netsuiteItemId: price.itemId,
        price: next.amount,
        currency: "CAD",
        status: next.status,
        statusReason: next.statusReason,
      },
      update: {
        netsuiteItemId: price.itemId,
        price: next.amount,
        status: next.status,
        statusReason: next.statusReason,
      },
    });
  }

  const existingRows = await prisma.groupPrice.findMany({
    where: { pricingGroupId },
  });
  let orphaned = 0;
  for (const row of existingRows) {
    if (!incomingSkus.has(row.sku)) {
      orphaned += 1;
      await prisma.groupPrice.update({
        where: { id: row.id },
        data: { statusReason: "ORPHANED" },
      });
    }
  }

  await prisma.pricingGroup.update({
    where: { id: pricingGroupId },
    data: { skuCount: prices.length },
  });

  return { upserted: prices.length, orphaned, invalid };
}

async function assertUniquePriceList(
  priceListId: string,
  pricingGroupId: string,
): Promise<void> {
  const existing = await prisma.pricingGroup.findFirst({
    where: {
      priceListId,
      id: { not: pricingGroupId },
    },
    select: { id: true, name: true },
  });
  if (existing) {
    throw new Error(
      `Price list already linked to pricing group "${existing.name}"`,
    );
  }
}

export async function createCatalogForGroup(
  pricingGroupId: string,
  actor = "system",
): Promise<PricingGroup> {
  const group = await prisma.pricingGroup.findUniqueOrThrow({
    where: { id: pricingGroupId },
  });
  const admin = await getAdminClient(getTargetShop());

  const catalogResult = await adminGraphql<{
    catalogCreate: {
      catalog: { id: string; title: string; status: string } | null;
      userErrors: GraphQLUserError[];
    };
  }>(admin, CATALOG_CREATE_MUTATION, {
    input: {
      title: group.name,
      status: "ACTIVE",
      context: { companyLocationIds: [] },
    },
  });
  throwUserErrors("catalogCreate", catalogResult.catalogCreate.userErrors);
  const catalogId = catalogResult.catalogCreate.catalog?.id;
  if (!catalogId) {
    throw new Error("catalogCreate did not return a catalog id");
  }

  try {
    const publicationResult = await adminGraphql<{
      publicationCreate: {
        publication: { id: string } | null;
        userErrors: GraphQLUserError[];
      };
    }>(admin, PUBLICATION_CREATE_MUTATION, {
      input: {
        catalogId,
        autoPublish: true,
        defaultState: "ALL_PRODUCTS",
      },
    });
    throwUserErrors(
      "publicationCreate",
      publicationResult.publicationCreate.userErrors,
    );
  } catch (error) {
    logError(`publicationCreate failed for group ${pricingGroupId}`, error);
  }

  const priceListResult = await adminGraphql<{
    priceListCreate: {
      priceList: {
        id: string;
        name: string;
        currency: string;
        catalog: { id: string } | null;
      } | null;
      userErrors: GraphQLUserError[];
    };
  }>(admin, PRICE_LIST_CREATE_MUTATION, {
    input: {
      name: `${group.name} CAD`,
      currency: "CAD",
      catalogId,
      parent: {
        adjustment: {
          type: "PERCENTAGE_DECREASE",
          value: 0,
        },
      },
    },
  });
  throwUserErrors("priceListCreate", priceListResult.priceListCreate.userErrors);
  const priceListId = priceListResult.priceListCreate.priceList?.id;
  if (!priceListId) {
    throw new Error("priceListCreate did not return a price list id");
  }

  await assertUniquePriceList(priceListId, pricingGroupId);

  const updated = await prisma.pricingGroup.update({
    where: { id: pricingGroupId },
    data: {
      catalogId,
      priceListId,
      status: PricingGroupStatus.READY,
      lastError: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor,
      action: "CATALOG_CREATED",
      entityType: "PricingGroup",
      entityId: pricingGroupId,
      details: { catalogId, priceListId },
    },
  });

  return updated;
}

export async function linkExistingPriceList(
  pricingGroupId: string,
  priceListId: string,
  catalogId: string | null,
  actor = "system",
): Promise<PricingGroup> {
  await assertUniquePriceList(priceListId, pricingGroupId);
  const admin = await getAdminClient(getTargetShop());
  const data = await adminGraphql<{
    priceList: {
      id: string;
      catalog: { id: string } | null;
    } | null;
  }>(admin, PRICE_LIST_BY_ID_QUERY, { id: priceListId });

  if (!data.priceList) {
    throw new Error(`Price list not found: ${priceListId}`);
  }

  const resolvedCatalogId = catalogId ?? data.priceList.catalog?.id ?? null;
  if (!resolvedCatalogId) {
    throw new Error("Price list is not associated with a catalog");
  }

  const updated = await prisma.pricingGroup.update({
    where: { id: pricingGroupId },
    data: {
      catalogId: resolvedCatalogId,
      priceListId,
      status: PricingGroupStatus.READY,
      lastError: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor,
      action: "CATALOG_LINKED",
      entityType: "PricingGroup",
      entityId: pricingGroupId,
      details: { catalogId: resolvedCatalogId, priceListId },
    },
  });

  return updated;
}

function groupStatusFromCounts(counts: {
  successCount: number;
  skippedCount: number;
  failedCount: number;
}): PricingGroupStatus {
  if (counts.failedCount > 0 && counts.successCount === 0) {
    return PricingGroupStatus.FAILED;
  }
  if (counts.skippedCount > 0 || counts.failedCount > 0) {
    return PricingGroupStatus.PARTIAL;
  }
  return PricingGroupStatus.SYNCED;
}

async function syncPriceRows(
  group: PricingGroup & { prices: Array<{ id: string; sku: string; price: Prisma.Decimal; status: PriceRowStatus; statusReason: string | null }> },
  rows: Array<{ id: string; sku: string; price: Prisma.Decimal; status: PriceRowStatus; statusReason: string | null }>,
  opts: { trigger: SyncTrigger; actor?: string; subjectType: string },
): Promise<{ successCount: number; skippedCount: number; failedCount: number }> {
  if (!group.priceListId) {
    throw new Error(`Pricing group ${group.name} is not mapped to a price list`);
  }

  const syncRun = await createSyncRun({
    type: SyncType.PRICING_SYNC,
    trigger: opts.trigger,
    subjectType: opts.subjectType,
    subjectId: group.id,
    triggeredBy: opts.actor,
  });

  await prisma.pricingGroup.update({
    where: { id: group.id },
    data: { status: PricingGroupStatus.SYNCING, lastError: null },
  });

  const counts = { successCount: 0, skippedCount: 0, failedCount: 0 };
  const errorDetails: Array<{ sku: string; message: string }> = [];

  try {
    const admin = await getAdminClient(getTargetShop());
    const ready: FixedPriceInput[] = [];
    const readyRowIds: string[] = [];

    for (const row of rows) {
      if (row.statusReason === "ORPHANED") {
        counts.skippedCount += 1;
        continue;
      }
      if (row.statusReason === "INVALID_PRICE") {
        counts.skippedCount += 1;
        continue;
      }

      const resolved = await resolveVariantBySku(admin, row.sku);
      if (resolved.kind !== "valid") {
        await prisma.groupPrice.update({
          where: { id: row.id },
          data: {
            status: PriceRowStatus.SKIPPED,
            statusReason: resolved.reason,
            variantId: null,
          },
        });
        counts.skippedCount += 1;
        continue;
      }

      ready.push({
        variantId: resolved.variant.id,
        amount: row.price.toFixed(2),
      });
      readyRowIds.push(row.id);
      await prisma.groupPrice.update({
        where: { id: row.id },
        data: { variantId: resolved.variant.id },
      });
    }

    for (const [batchIndex, batch] of chunk(ready, PRICE_LIST_BATCH_SIZE).entries()) {
      const rowIds = chunk(readyRowIds, PRICE_LIST_BATCH_SIZE)[batchIndex] ?? [];
      try {
        await addFixedPrices(admin, group.priceListId, batch);
        const syncedAt = new Date();
        await prisma.groupPrice.updateMany({
          where: { id: { in: rowIds } },
          data: {
            status: PriceRowStatus.SYNCED,
            statusReason: null,
            lastSyncedAt: syncedAt,
          },
        });
        counts.successCount += batch.length;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "priceListFixedPricesAdd failed";
        logError(`Fixed price upsert failed for group ${group.id}`, error);
        await prisma.groupPrice.updateMany({
          where: { id: { in: rowIds } },
          data: {
            status: PriceRowStatus.FAILED,
            statusReason: message,
          },
        });
        counts.failedCount += batch.length;
        errorDetails.push(
          ...batch.map((price, index) => ({
            sku: rows.find((row) => row.id === rowIds[index])?.sku ?? price.variantId,
            message,
          })),
        );
      }
    }

    const groupStatus = groupStatusFromCounts(counts);
    await prisma.pricingGroup.update({
      where: { id: group.id },
      data: {
        status: groupStatus,
        lastSyncedAt: new Date(),
        lastError: errorDetails[0]?.message ?? null,
      },
    });

    await finishSyncRun(syncRun.id, syncRunStatusFromCounts(counts), {
      ...counts,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    });

    return counts;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pricing sync failed";
    logError(`syncGroupPrices failed for ${group.id}`, error);
    await prisma.pricingGroup.update({
      where: { id: group.id },
      data: {
        status: PricingGroupStatus.FAILED,
        lastError: message,
      },
    });
    await finishSyncRun(syncRun.id, syncRunStatusFromCounts({
      successCount: counts.successCount,
      skippedCount: counts.skippedCount,
      failedCount: Math.max(counts.failedCount, 1),
    }), {
      ...counts,
      failedCount: Math.max(counts.failedCount, 1),
      errorDetails: { message },
    });
    throw error;
  }
}

export async function syncGroupPrices(
  pricingGroupId: string,
  opts: { trigger: SyncTrigger; actor?: string } = { trigger: SyncTrigger.MANUAL },
): Promise<{ successCount: number; skippedCount: number; failedCount: number }> {
  const group = await prisma.pricingGroup.findUniqueOrThrow({
    where: { id: pricingGroupId },
    include: { prices: true },
  });
  return syncPriceRows(group, group.prices, {
    trigger: opts.trigger,
    actor: opts.actor,
    subjectType: "PricingGroup",
  });
}

export async function retryFailedRows(
  pricingGroupId: string,
  actor = "system",
): Promise<{ successCount: number; skippedCount: number; failedCount: number }> {
  const group = await prisma.pricingGroup.findUniqueOrThrow({
    where: { id: pricingGroupId },
    include: {
      prices: {
        where: { status: PriceRowStatus.FAILED },
      },
    },
  });
  return syncPriceRows(group, group.prices, {
    trigger: SyncTrigger.MANUAL,
    actor,
    subjectType: "PricingGroupRetry",
  });
}

export async function syncAllGroups(
  opts: { trigger: SyncTrigger; actor?: string } = { trigger: SyncTrigger.MANUAL },
): Promise<{
  groups: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
}> {
  await importPricingGroups();
  const groups = await prisma.pricingGroup.findMany();
  const totals = { groups: 0, successCount: 0, skippedCount: 0, failedCount: 0 };

  for (const group of groups) {
    await importGroupPrices(group.id);
  }

  const syncable = await prisma.pricingGroup.findMany({
    where: {
      status: {
        in: [
          PricingGroupStatus.READY,
          PricingGroupStatus.SYNCED,
          PricingGroupStatus.PARTIAL,
        ],
      },
      priceListId: { not: null },
    },
  });

  for (const group of syncable) {
    totals.groups += 1;
    try {
      const counts = await syncGroupPrices(group.id, opts);
      totals.successCount += counts.successCount;
      totals.skippedCount += counts.skippedCount;
      totals.failedCount += counts.failedCount;
    } catch (error) {
      totals.failedCount += 1;
      logError(`syncAllGroups failed for ${group.id}`, error);
    }
  }

  return totals;
}

export async function importPricingCsv(
  text: string,
  actor = "system",
): Promise<{ groups: number; prices: number }> {
  const rows = parsePricingCsv(text).filter((row) => row.groupId && row.sku);
  const groupIds = new Set<string>();

  for (const row of rows) {
    const group = await prisma.pricingGroup.upsert({
      where: { netsuiteGroupId: row.groupId },
      create: {
        netsuiteGroupId: row.groupId,
        name: row.groupName || row.groupId,
        currency: "CAD",
      },
      update: {
        name: row.groupName || undefined,
      },
    });
    groupIds.add(group.id);
    const next = rowStatusForPrice(row.price);
    await prisma.groupPrice.upsert({
      where: {
        pricingGroupId_sku: {
          pricingGroupId: group.id,
          sku: row.sku,
        },
      },
      create: {
        pricingGroupId: group.id,
        sku: row.sku,
        price: next.amount,
        currency: "CAD",
        status: next.status,
        statusReason: next.statusReason,
      },
      update: {
        price: next.amount,
        status: next.status,
        statusReason: next.statusReason,
      },
    });
  }

  for (const groupId of groupIds) {
    const skuCount = await prisma.groupPrice.count({ where: { pricingGroupId: groupId } });
    await prisma.pricingGroup.update({
      where: { id: groupId },
      data: { skuCount },
    });
  }

  await prisma.auditLog.create({
    data: {
      actor,
      action: "PRICING_CSV_IMPORTED",
      entityType: "PricingGroup",
      entityId: "csv",
      details: { groups: groupIds.size, prices: rows.length, trigger: "MANUAL" },
    },
  });

  return { groups: groupIds.size, prices: rows.length };
}

export async function listCompanyLocationCatalogs(): Promise<
  Array<{
    id: string;
    title: string;
    status: string;
    priceList: { id: string; name: string; currency: string } | null;
  }>
> {
  const admin = await getAdminClient(getTargetShop());
  const catalogs: Array<{
    id: string;
    title: string;
    status: string;
    priceList: { id: string; name: string; currency: string } | null;
  }> = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: {
      catalogs: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          title: string;
          status: string;
          priceList: { id: string; name: string; currency: string } | null;
        }>;
      };
    } = await adminGraphql(admin, CATALOGS_QUERY, { first: 50, after });
    catalogs.push(...data.catalogs.nodes);
    hasNextPage = data.catalogs.pageInfo.hasNextPage;
    after = data.catalogs.pageInfo.endCursor;
  }

  return catalogs;
}

export async function getPriceListPrices(priceListId: string): Promise<
  Array<{ variantId: string; sku: string | null; amount: string }>
> {
  const admin = await getAdminClient(getTargetShop());
  const data = await adminGraphql<{
    priceList: {
      prices: {
        nodes: Array<{
          price: { amount: string };
          variant: { id: string; sku: string | null };
        }>;
      };
    } | null;
  }>(admin, PRICE_LIST_BY_ID_QUERY, { id: priceListId });

  return (
    data.priceList?.prices.nodes.map((node) => ({
      variantId: node.variant.id,
      sku: node.variant.sku,
      amount: node.price.amount,
    })) ?? []
  );
}
