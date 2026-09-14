import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  EmptyState,
  IndexTable,
  InlineStack,
  Page,
  Pagination,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import type { PricingGroupStatus } from "@prisma/client";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  importPricingCsv,
  importPricingGroups,
  importGroupPrices,
  syncAllGroups,
} from "../services/pricing-sync.server";
import { formatRelativeDate, truncateText } from "../utils/format";

const PAGE_SIZE = 25;

const STATUS_TABS: Array<{ id: string; label: string; status?: PricingGroupStatus }> =
  [
    { id: "all", label: "All" },
    { id: "UNMAPPED", label: "Unmapped", status: "UNMAPPED" },
    { id: "READY", label: "Ready", status: "READY" },
    { id: "SYNCING", label: "Syncing", status: "SYNCING" },
    { id: "SYNCED", label: "Synced", status: "SYNCED" },
    { id: "PARTIAL", label: "Partial", status: "PARTIAL" },
    { id: "FAILED", label: "Failed", status: "FAILED" },
  ];

function statusBadge(status: PricingGroupStatus) {
  const map: Record<
    PricingGroupStatus,
    { tone: "attention" | "info" | "warning" | "success" | "critical"; label: string }
  > = {
    UNMAPPED: { tone: "attention", label: "Unmapped" },
    READY: { tone: "info", label: "Ready" },
    SYNCING: { tone: "warning", label: "Syncing" },
    SYNCED: { tone: "success", label: "Synced" },
    PARTIAL: { tone: "attention", label: "Partial" },
    FAILED: { tone: "critical", label: "Failed" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const search = url.searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const status =
    statusParam && STATUS_TABS.some((tab) => tab.status === statusParam)
      ? (statusParam as PricingGroupStatus)
      : undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { netsuiteGroupId: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [groups, filteredCount, statusGroups] = await Promise.all([
    prisma.pricingGroup.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.pricingGroup.count({ where }),
    prisma.pricingGroup.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const statusCounts: Record<string, number> = { all: 0 };
  for (const group of statusGroups) {
    statusCounts[group.status] = group._count._all;
    statusCounts.all += group._count._all;
  }

  return json({
    groups,
    filteredCount,
    statusCounts,
    page,
    pageSize: PAGE_SIZE,
    status: status ?? "all",
    search,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const actor = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "import-netsuite") {
      const result = await importPricingGroups();
      const groups = await prisma.pricingGroup.findMany({ select: { id: true } });
      for (const group of groups) {
        await importGroupPrices(group.id);
      }
      return json({ success: `Imported ${result.imported} pricing group(s)` });
    }

    if (intent === "sync-all") {
      const result = await syncAllGroups({ trigger: "MANUAL", actor });
      return json({
        success: `Synced ${result.groups} group(s): ${result.successCount} succeeded, ${result.skippedCount} skipped, ${result.failedCount} failed`,
      });
    }

    if (intent === "upload-csv") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return json({ error: "Choose a CSV file to upload" }, { status: 400 });
      }
      const text = await file.text();
      const result = await importPricingCsv(text, actor);
      return json({
        success: `Imported ${result.prices} price row(s) across ${result.groups} group(s)`,
      });
    }

    return json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed";
    return json({ error: message }, { status: 400 });
  }
};

export default function PricingGroupsPage() {
  const { groups, filteredCount, statusCounts, page, pageSize, status, search } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const shopify = useAppBridge();
  const [searchValue, setSearchValue] = useState(search);

  const submittingIntent = navigation.formData?.get("intent");
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    setSearchValue(search);
  }, [search]);

  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      shopify.toast.show(actionData.success);
    }
  }, [actionData, shopify]);

  const selectedTab = STATUS_TABS.findIndex((tab) =>
    status === "all" ? tab.id === "all" : tab.status === status,
  );

  const handleTabChange = useCallback(
    (index: number) => {
      const tab = STATUS_TABS[index];
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (tab.id === "all") next.delete("status");
        else next.set("status", tab.id);
        next.delete("page");
        return next;
      });
    },
    [setSearchParams],
  );

  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));

  const rowMarkup = groups.map((group, index) => (
    <IndexTable.Row
      id={group.id}
      key={group.id}
      position={index}
      onClick={() => navigate(`/app/pricing/${group.id}`)}
    >
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {group.name}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            NetSuite {group.netsuiteGroupId}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {group.catalogId ? truncateText(group.catalogId, 28) : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {group.priceListId ? truncateText(group.priceListId, 28) : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{group.skuCount}</IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(group.status)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm">
          {formatRelativeDate(group.lastSyncedAt?.toString())}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {group.lastError ? (
          <Text as="span" variant="bodySm" tone="critical">
            {truncateText(group.lastError, 40)}
          </Text>
        ) : (
          <Text as="span" tone="subdued">
            —
          </Text>
        )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const tabs = STATUS_TABS.map((tab) => ({
    id: tab.id,
    content: tab.label,
    badge: String(statusCounts[tab.id === "all" ? "all" : tab.status!] ?? 0),
  }));

  return (
    <Page
      title="Pricing Groups"
      primaryAction={{
        content: "Import from NetSuite",
        loading: isSubmitting && submittingIntent === "import-netsuite",
        onAction: () => submit({ intent: "import-netsuite" }, { method: "post" }),
      }}
      secondaryActions={[
        {
          content: "Sync all",
          loading: isSubmitting && submittingIntent === "sync-all",
          onAction: () => submit({ intent: "sync-all" }, { method: "post" }),
        },
      ]}
    >
      <TitleBar title="Pricing Groups" />
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
          </Banner>
        )}

        <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange} />

        <Form
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              if (searchValue.trim()) next.set("search", searchValue.trim());
              else next.delete("search");
              next.delete("page");
              return next;
            });
          }}
        >
          <Box maxWidth="320px">
            <TextField
              label="Search"
              labelHidden
              placeholder="Search by name or NetSuite ID"
              value={searchValue}
              onChange={setSearchValue}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => {
                setSearchValue("");
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.delete("search");
                  next.delete("page");
                  return next;
                });
              }}
            />
          </Box>
        </Form>

        <Form method="post" encType="multipart/form-data">
          <InlineStack gap="300" blockAlign="end">
            <input type="hidden" name="intent" value="upload-csv" />
            <input type="file" name="file" accept=".csv,text/csv" />
            <button type="submit">Upload pricing CSV</button>
          </InlineStack>
        </Form>
        <Text as="p" variant="bodySm" tone="subdued">
          CSV columns: group_id, group_name, sku, price
        </Text>

        {groups.length === 0 ? (
          <EmptyState
            heading="No pricing groups yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Import groups from NetSuite or upload a pricing CSV to get started.</p>
          </EmptyState>
        ) : (
          <BlockStack gap="400">
            <IndexTable
              resourceName={{ singular: "group", plural: "groups" }}
              itemCount={groups.length}
              selectable={false}
              headings={[
                { title: "Group" },
                { title: "Catalog" },
                { title: "Price list" },
                { title: "SKUs" },
                { title: "Status" },
                { title: "Last synced" },
                { title: "Error" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
            {totalPages > 1 && (
              <InlineStack align="center">
                <Pagination
                  hasPrevious={page > 1}
                  onPrevious={() => {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      next.set("page", String(page - 1));
                      return next;
                    });
                  }}
                  hasNext={page < totalPages}
                  onNext={() => {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      next.set("page", String(page + 1));
                      return next;
                    });
                  }}
                  label={`Page ${page} of ${totalPages}`}
                />
              </InlineStack>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Page>
  );
}
