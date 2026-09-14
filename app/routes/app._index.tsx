import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import type {
  AssignmentStatus,
  ItemRowStatus,
  MappingStatus,
  PricingGroupStatus,
  SyncRunStatus,
} from "@prisma/client";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getNetSuiteClient } from "../services/netsuite/index.server";
import {
  getSourceShop,
  getTargetShop,
  hasShopSession,
} from "../services/shops.server";

type StatusCount<T extends string> = { status: T; count: number };

function countsFromGroupBy<T extends string>(
  groups: { status: T; _count: { status: number } }[],
): StatusCount<T>[] {
  return groups.map((group) => ({
    status: group.status,
    count: group._count.status,
  }));
}

function countStatus<T extends string>(
  counts: StatusCount<T>[],
  status: T,
): number {
  return counts.find((item) => item.status === status)?.count ?? 0;
}

function totalCount<T extends string>(counts: StatusCount<T>[]): number {
  return counts.reduce((sum, item) => sum + item.count, 0);
}

function truncateError(error: string | null | undefined, maxLength = 120): string {
  if (!error) return "Unknown error";
  if (error.length <= maxLength) return error;
  return `${error.slice(0, maxLength)}…`;
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function syncRunBadgeTone(
  status: SyncRunStatus,
): "success" | "critical" | "attention" | "info" {
  switch (status) {
    case "SUCCESS":
      return "success";
    case "FAILED":
      return "critical";
    case "PARTIAL":
      return "attention";
    case "RUNNING":
    default:
      return "info";
  }
}

function SyncRunSummary({
  label,
  syncRun,
}: {
  label: string;
  syncRun: {
    status: SyncRunStatus;
    startedAt: string;
    successCount: number;
    skippedCount: number;
    failedCount: number;
  } | null;
}) {
  if (!syncRun) {
    return (
      <Text as="p" variant="bodyMd" tone="subdued">
        No {label.toLowerCase()} runs yet.
      </Text>
    );
  }

  return (
    <BlockStack gap="100">
      <InlineStack gap="200" blockAlign="center">
        <Text as="span" variant="bodyMd">
          Last run
        </Text>
        <Badge tone={syncRunBadgeTone(syncRun.status)}>{syncRun.status}</Badge>
        <Text as="span" variant="bodyMd" tone="subdued">
          {formatDateTime(syncRun.startedAt)}
        </Text>
      </InlineStack>
      <Text as="p" variant="bodyMd" tone="subdued">
        {syncRun.successCount} succeeded · {syncRun.skippedCount} skipped ·{" "}
        {syncRun.failedCount} failed
      </Text>
    </BlockStack>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  let sourceShop = "";
  let targetShop = "";
  try {
    sourceShop = getSourceShop();
  } catch {
    sourceShop = "";
  }
  try {
    targetShop = getTargetShop();
  } catch {
    targetShop = "";
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    sourceConnected,
    targetConnected,
    netsuiteConnection,
    productStatusGroups,
    pricingStatusGroups,
    assignmentStatusGroups,
    itemPriceStatusGroups,
    lastProductSync,
    lastPricingSync,
    lastItemSync,
    failedMappings,
    failedPricingGroups,
    failedItems,
    failedAssignments,
    failedSyncRuns,
  ] = await Promise.all([
    sourceShop ? hasShopSession(sourceShop) : Promise.resolve(false),
    targetShop ? hasShopSession(targetShop) : Promise.resolve(false),
    getNetSuiteClient().testConnection(),
    prisma.productMapping.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
    prisma.pricingGroup.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
    prisma.locationAssignment.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
    prisma.netSuiteItemState.groupBy({
      by: ["priceStatus"],
      _count: { priceStatus: true },
    }),
    prisma.syncRun.findFirst({
      where: { type: "PRODUCT_SYNC" },
      orderBy: { startedAt: "desc" },
      select: {
        status: true,
        startedAt: true,
        successCount: true,
        skippedCount: true,
        failedCount: true,
      },
    }),
    prisma.syncRun.findFirst({
      where: { type: "PRICING_SYNC" },
      orderBy: { startedAt: "desc" },
      select: {
        status: true,
        startedAt: true,
        successCount: true,
        skippedCount: true,
        failedCount: true,
      },
    }),
    prisma.syncRun.findFirst({
      where: { type: "ITEM_SYNC" },
      orderBy: { startedAt: "desc" },
      select: {
        status: true,
        startedAt: true,
        successCount: true,
        skippedCount: true,
        failedCount: true,
      },
    }),
    prisma.productMapping.findMany({
      where: { status: "FAILED" },
      select: { id: true, sourceTitle: true, lastError: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.pricingGroup.findMany({
      where: { status: "FAILED" },
      select: { id: true, name: true, lastError: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.netSuiteItemState.findMany({
      where: {
        OR: [{ priceStatus: "FAILED" }, { inventoryStatus: "FAILED" }],
      },
      select: { id: true, sku: true, statusReason: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.locationAssignment.findMany({
      where: { status: { in: ["FAILED", "CONFLICT"] } },
      select: { id: true, companyName: true, locationName: true, lastError: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.syncRun.findMany({
      where: {
        status: "FAILED",
        startedAt: { gte: sevenDaysAgo },
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        type: true,
        startedAt: true,
        failedCount: true,
      },
      take: 5,
    }),
  ]);

  const productCounts = countsFromGroupBy(productStatusGroups);
  const pricingCounts = countsFromGroupBy(pricingStatusGroups);
  const assignmentCounts = countsFromGroupBy(assignmentStatusGroups);
  const itemCounts = itemPriceStatusGroups.map((group) => ({
    status: group.priceStatus as ItemRowStatus,
    count: group._count.priceStatus,
  }));

  const errorItems = [
    ...failedMappings.map((mapping) => ({
      kind: "mapping" as const,
      id: mapping.id,
      title: mapping.sourceTitle,
      href: `/app/mappings/${mapping.id}`,
      detail: truncateError(mapping.lastError),
    })),
    ...failedPricingGroups.map((group) => ({
      kind: "pricing" as const,
      id: group.id,
      title: group.name,
      href: `/app/pricing/${group.id}`,
      detail: truncateError(group.lastError),
    })),
    ...failedItems.map((item) => ({
      kind: "item" as const,
      id: item.id,
      title: item.sku,
      href: "/app/items",
      detail: truncateError(item.statusReason),
    })),
    ...failedAssignments.map((assignment) => ({
      kind: "assignment" as const,
      id: assignment.id,
      title: `${assignment.companyName} / ${assignment.locationName}`,
      href: "/app/customers",
      detail: truncateError(assignment.lastError),
    })),
    ...failedSyncRuns.map((syncRun) => ({
      kind: "syncRun" as const,
      id: syncRun.id,
      title: `${syncRun.type.replaceAll("_", " ")} sync failed`,
      href: "/app/history",
      detail: `${syncRun.failedCount} failed · ${formatDateTime(syncRun.startedAt)}`,
    })),
  ].slice(0, 10);

  return {
    connections: {
      source: {
        label: "72hours.ca (source)",
        connected: sourceConnected,
      },
      target: {
        label: "b2b-site (target)",
        connected: targetConnected,
      },
      netsuite: {
        label: "NetSuite",
        connected: netsuiteConnection.ok,
        message: netsuiteConnection.message ?? null,
      },
    },
    productSync: {
      total: totalCount(productCounts),
      mapped:
        countStatus(productCounts, "READY" satisfies MappingStatus) +
        countStatus(productCounts, "SYNCED" satisfies MappingStatus),
      needsMapping: countStatus(
        productCounts,
        "NEEDS_MAPPING" satisfies MappingStatus,
      ),
      failed: countStatus(productCounts, "FAILED" satisfies MappingStatus),
      lastRun: lastProductSync,
    },
    pricingSync: {
      total: totalCount(pricingCounts),
      counts: pricingCounts,
      lastRun: lastPricingSync,
    },
    itemSync: {
      total: totalCount(itemCounts),
      pending: countStatus(itemCounts, "PENDING" satisfies ItemRowStatus),
      synced: countStatus(itemCounts, "SYNCED" satisfies ItemRowStatus),
      failed: countStatus(itemCounts, "FAILED" satisfies ItemRowStatus),
      lastRun: lastItemSync,
    },
    customerAssignment: {
      total: totalCount(assignmentCounts),
      assigned: countStatus(
        assignmentCounts,
        "ASSIGNED" satisfies AssignmentStatus,
      ),
      unassigned: countStatus(
        assignmentCounts,
        "UNASSIGNED" satisfies AssignmentStatus,
      ),
      conflict: countStatus(
        assignmentCounts,
        "CONFLICT" satisfies AssignmentStatus,
      ),
      failed: countStatus(assignmentCounts, "FAILED" satisfies AssignmentStatus),
    },
    errorItems,
  };
};

export default function Dashboard() {
  const {
    connections,
    productSync,
    pricingSync,
    itemSync,
    customerAssignment,
    errorItems,
  } = useLoaderData<typeof loader>();

  return (
    <Page title="B2B Tool Dashboard">
      <TitleBar title="B2B Tool Dashboard" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Connections
                </Text>
                <BlockStack gap="300">
                  {[connections.source, connections.target].map((store) => (
                    <InlineStack
                      key={store.label}
                      align="space-between"
                      blockAlign="center"
                    >
                      <Text as="span" variant="bodyMd">
                        {store.label}
                      </Text>
                      <Badge tone={store.connected ? "success" : "critical"}>
                        {store.connected ? "Connected" : "Not installed"}
                      </Badge>
                    </InlineStack>
                  ))}
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd">
                      {connections.netsuite.label}
                    </Text>
                    <Badge
                      tone={
                        connections.netsuite.connected ? "success" : "critical"
                      }
                    >
                      {connections.netsuite.connected
                        ? "Connected"
                        : "Connection failed"}
                    </Badge>
                  </InlineStack>
                  {connections.netsuite.message && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {connections.netsuite.message}
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Quick actions
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/mappings">Sync products</Button>
              <Button url="/app/pricing">Sync pricing</Button>
              <Button url="/app/items">Sync items</Button>
              <Button url="/app/customers">Review assignments</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Product sync
              </Text>
              <InlineGrid columns={2} gap="300">
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Total
                  </Text>
                  <Text as="p" variant="headingLg">
                    {productSync.total}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Mapped
                  </Text>
                  <Text as="p" variant="headingLg">
                    {productSync.mapped}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Needs mapping
                  </Text>
                  <Text as="p" variant="headingLg">
                    {productSync.needsMapping}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Failed
                  </Text>
                  <Text as="p" variant="headingLg">
                    {productSync.failed}
                  </Text>
                </BlockStack>
              </InlineGrid>
              <SyncRunSummary label="product sync" syncRun={productSync.lastRun} />
              <InlineStack>
                <Button url="/app/mappings">Manage mappings</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Pricing sync
              </Text>
              <InlineGrid columns={2} gap="300">
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Total groups
                  </Text>
                  <Text as="p" variant="headingLg">
                    {pricingSync.total}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Synced
                  </Text>
                  <Text as="p" variant="headingLg">
                    {countStatus(
                      pricingSync.counts,
                      "SYNCED" satisfies PricingGroupStatus,
                    )}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Unmapped
                  </Text>
                  <Text as="p" variant="headingLg">
                    {countStatus(
                      pricingSync.counts,
                      "UNMAPPED" satisfies PricingGroupStatus,
                    )}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Failed
                  </Text>
                  <Text as="p" variant="headingLg">
                    {countStatus(
                      pricingSync.counts,
                      "FAILED" satisfies PricingGroupStatus,
                    )}
                  </Text>
                </BlockStack>
              </InlineGrid>
              <SyncRunSummary
                label="pricing sync"
                syncRun={pricingSync.lastRun}
              />
              <InlineStack>
                <Button url="/app/pricing">Manage pricing</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Item price & inventory
              </Text>
              <InlineGrid columns={2} gap="300">
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Total SKUs
                  </Text>
                  <Text as="p" variant="headingLg">
                    {itemSync.total}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Synced
                  </Text>
                  <Text as="p" variant="headingLg">
                    {itemSync.synced}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Pending
                  </Text>
                  <Text as="p" variant="headingLg">
                    {itemSync.pending}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Failed
                  </Text>
                  <Text as="p" variant="headingLg">
                    {itemSync.failed}
                  </Text>
                </BlockStack>
              </InlineGrid>
              <SyncRunSummary label="item sync" syncRun={itemSync.lastRun} />
              <InlineStack>
                <Button url="/app/items">Manage items</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Customer assignment
              </Text>
              <InlineGrid columns={2} gap="300">
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Assigned
                  </Text>
                  <Text as="p" variant="headingLg">
                    {customerAssignment.assigned}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Unassigned
                  </Text>
                  <Text as="p" variant="headingLg">
                    {customerAssignment.unassigned}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Conflict
                  </Text>
                  <Text as="p" variant="headingLg">
                    {customerAssignment.conflict}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Failed
                  </Text>
                  <Text as="p" variant="headingLg">
                    {customerAssignment.failed}
                  </Text>
                </BlockStack>
              </InlineGrid>
              <InlineStack>
                <Button url="/app/customers">Manage assignments</Button>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Errors to resolve
              </Text>
              {errorItems.length === 0 ? (
                <Text as="p" variant="bodyMd" tone="subdued">
                  No outstanding errors
                </Text>
              ) : (
                <BlockStack gap="300">
                  {errorItems.map((item) => (
                    <BlockStack key={`${item.kind}-${item.id}`} gap="100">
                      <Button url={item.href} variant="plain">
                        {item.title}
                      </Button>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.detail}
                      </Text>
                    </BlockStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
