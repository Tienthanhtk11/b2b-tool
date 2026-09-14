import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
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
import type { ItemRowStatus } from "@prisma/client";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  importItems,
  importItemsCsv,
  syncInventory,
  syncItemPrices,
} from "../services/item-sync.server";
import { B2B_LOCATION_SETTING_KEY, getAppSetting } from "../services/settings.server";
import { formatMoney } from "../utils/numbers";
import { formatRelativeDate, truncateText } from "../utils/format";

const PAGE_SIZE = 25;
const TABS: Array<{ id: string; label: string; status?: ItemRowStatus }> = [
  { id: "all", label: "All" },
  { id: "PENDING", label: "Pending", status: "PENDING" },
  { id: "SYNCED", label: "Synced", status: "SYNCED" },
  { id: "SKIPPED", label: "Skipped", status: "SKIPPED" },
  { id: "FAILED", label: "Failed", status: "FAILED" },
];

function itemBadge(status: ItemRowStatus) {
  const map: Record<
    ItemRowStatus,
    { tone: "attention" | "info" | "warning" | "success" | "critical"; label: string }
  > = {
    PENDING: { tone: "info", label: "Pending" },
    SYNCED: { tone: "success", label: "Synced" },
    SKIPPED: { tone: "attention", label: "Skipped" },
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
    statusParam && TABS.some((tab) => tab.status === statusParam)
      ? (statusParam as ItemRowStatus)
      : undefined;

  const where = {
    ...(status
      ? {
          OR: [{ priceStatus: status }, { inventoryStatus: status }],
        }
      : {}),
    ...(search
      ? { sku: { contains: search, mode: "insensitive" as const } }
      : {}),
  };

  const [items, filteredCount, locationId] = await Promise.all([
    prisma.netSuiteItemState.findMany({
      where,
      orderBy: { sku: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.netSuiteItemState.count({ where }),
    getAppSetting(B2B_LOCATION_SETTING_KEY),
  ]);

  return json({
    items: items.map((item) => ({
      ...item,
      basePrice: item.basePrice?.toString() ?? null,
    })),
    filteredCount,
    page,
    pageSize: PAGE_SIZE,
    status: status ?? "all",
    search,
    locationId,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const actor = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "import") {
      const result = await importItems();
      return json({ success: `Imported ${result.imported} item(s)` });
    }
    if (intent === "sync-prices") {
      const result = await syncItemPrices({ trigger: "MANUAL", actor });
      return json({
        success: `Prices: ${result.successCount} synced, ${result.skippedCount} skipped, ${result.failedCount} failed`,
      });
    }
    if (intent === "sync-inventory") {
      const result = await syncInventory({ trigger: "MANUAL", actor });
      return json({
        success: `Inventory: ${result.successCount} synced, ${result.skippedCount} skipped, ${result.failedCount} failed`,
      });
    }
    if (intent === "upload-csv") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return json({ error: "Choose a CSV file to upload" }, { status: 400 });
      }
      const result = await importItemsCsv(await file.text(), actor);
      return json({ success: `Imported ${result.imported} item row(s)` });
    }
    return json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed";
    return json({ error: message }, { status: 400 });
  }
};

export default function ItemsPage() {
  const { items, filteredCount, page, pageSize, status, search, locationId } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [, setSearchParams] = useSearchParams();
  const shopify = useAppBridge();
  const [searchValue, setSearchValue] = useState(search);
  const submittingIntent = navigation.formData?.get("intent");
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      shopify.toast.show(actionData.success);
    }
  }, [actionData, shopify]);

  const selectedTab = TABS.findIndex((tab) =>
    status === "all" ? tab.id === "all" : tab.status === status,
  );
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));

  return (
    <Page
      title="Item price & inventory"
      primaryAction={{
        content: "Import from NetSuite",
        loading: isSubmitting && submittingIntent === "import",
        onAction: () => submit({ intent: "import" }, { method: "post" }),
      }}
      secondaryActions={[
        {
          content: "Sync prices",
          loading: isSubmitting && submittingIntent === "sync-prices",
          onAction: () => submit({ intent: "sync-prices" }, { method: "post" }),
        },
        {
          content: "Sync inventory",
          loading: isSubmitting && submittingIntent === "sync-inventory",
          disabled: !locationId,
          onAction: () => submit({ intent: "sync-inventory" }, { method: "post" }),
        },
      ]}
    >
      <TitleBar title="Item price & inventory" />
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {!locationId && (
          <Banner tone="warning" title="Inventory location not set">
            <p>
              Choose a b2b-site location on the Settings page before syncing
              inventory.
            </p>
          </Banner>
        )}

        <Tabs
          tabs={TABS.map((tab) => ({ id: tab.id, content: tab.label }))}
          selected={Math.max(0, selectedTab)}
          onSelect={(index) => {
            const tab = TABS[index];
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              if (tab.id === "all") next.delete("status");
              else next.set("status", tab.id);
              next.delete("page");
              return next;
            });
          }}
        />

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
              label="Search SKU"
              labelHidden
              value={searchValue}
              onChange={setSearchValue}
              autoComplete="off"
              placeholder="Search SKU"
            />
          </Box>
        </Form>

        <Form method="post" encType="multipart/form-data">
          <InlineStack gap="300" blockAlign="center">
            <input type="hidden" name="intent" value="upload-csv" />
            <input type="file" name="file" accept=".csv,text/csv" />
            <button type="submit">Upload item CSV</button>
          </InlineStack>
        </Form>
        <Text as="p" variant="bodySm" tone="subdued">
          CSV columns: sku, base_price, quantity
        </Text>

        {items.length === 0 ? (
          <EmptyState
            heading="No item rows yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Import items from NetSuite or upload a CSV.</p>
          </EmptyState>
        ) : (
          <BlockStack gap="400">
            <IndexTable
              resourceName={{ singular: "item", plural: "items" }}
              itemCount={items.length}
              selectable={false}
              headings={[
                { title: "SKU" },
                { title: "Base price" },
                { title: "Quantity" },
                { title: "Variant" },
                { title: "Price status" },
                { title: "Inventory status" },
                { title: "Reason" },
                { title: "Last synced" },
              ]}
            >
              {items.map((item, index) => (
                <IndexTable.Row id={item.id} key={item.id} position={index}>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {item.sku}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{formatMoney(item.basePrice)}</IndexTable.Cell>
                  <IndexTable.Cell>{item.quantityAvailable ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm">
                      {truncateText(item.variantId, 24)}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{itemBadge(item.priceStatus)}</IndexTable.Cell>
                  <IndexTable.Cell>{itemBadge(item.inventoryStatus)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm">
                      {item.statusReason ?? "—"}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {formatRelativeDate(item.lastSyncedAt?.toString())}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
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
