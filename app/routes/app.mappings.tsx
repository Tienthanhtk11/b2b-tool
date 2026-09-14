import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
  useSubmit,
  useActionData,
} from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  EmptyState,
  Icon,
  IndexTable,
  InlineStack,
  Page,
  Pagination,
  Tabs,
  Text,
  TextField,
  Thumbnail,
  Tooltip,
} from "@shopify/polaris";
import { ArrowRightIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import type { MappingStatus, MatchMethod } from "@prisma/client";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { importAllSourceProducts } from "../services/product-sync.server";

const PAGE_SIZE = 25;

const STATUS_TABS: Array<{ id: string; label: string; status?: MappingStatus }> =
  [
    { id: "all", label: "All" },
    { id: "NEEDS_MAPPING", label: "Needs mapping", status: "NEEDS_MAPPING" },
    { id: "READY", label: "Ready", status: "READY" },
    { id: "SYNCING", label: "Syncing", status: "SYNCING" },
    { id: "SYNCED", label: "Synced", status: "SYNCED" },
    { id: "FAILED", label: "Failed", status: "FAILED" },
  ];

function formatRelativeDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.floor(diffMonth / 12)}y ago`;
}

function statusBadge(status: MappingStatus) {
  const map: Record<
    MappingStatus,
    { tone: "attention" | "info" | "warning" | "success" | "critical"; label: string }
  > = {
    NEEDS_MAPPING: { tone: "attention", label: "Needs mapping" },
    READY: { tone: "info", label: "Ready" },
    SYNCING: { tone: "warning", label: "Syncing" },
    SYNCED: { tone: "success", label: "Synced" },
    FAILED: { tone: "critical", label: "Failed" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

function matchMethodBadge(method: MatchMethod | null) {
  if (!method) return <Text as="span" tone="subdued">—</Text>;
  const label = method === "SKU_SUGGESTION" ? "SKU suggestion" : "Manual";
  return <Badge>{label}</Badge>;
}

function truncateError(error: string, max = 40): string {
  if (error.length <= max) return error;
  return `${error.slice(0, max)}…`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const search = url.searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const status =
    statusParam &&
    STATUS_TABS.some((t) => t.status === statusParam)
      ? (statusParam as MappingStatus)
      : undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { sourceTitle: { contains: search, mode: "insensitive" as const } },
            { targetTitle: { contains: search, mode: "insensitive" as const } },
            {
              variantMappings: {
                some: { sku: { contains: search, mode: "insensitive" as const } },
              },
            },
          ],
        }
      : {}),
  };

  const [mappings, filteredCount, statusGroups] = await Promise.all([
    prisma.productMapping.findMany({
      where,
      include: { variantMappings: true },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.productMapping.count({ where }),
    prisma.productMapping.groupBy({
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
    mappings,
    filteredCount,
    statusCounts,
    page,
    pageSize: PAGE_SIZE,
    status: status ?? "all",
    search,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "import-all") {
    try {
      const result = await importAllSourceProducts();
      return json({ success: true, importResult: result });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Import from source failed";
      return json({ error: message }, { status: 400 });
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function MappingsPage() {
  const { mappings, filteredCount, statusCounts, page, pageSize, status, search } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const shopify = useAppBridge();
  const [searchValue, setSearchValue] = useState(search);

  const isImporting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "import-all";

  useEffect(() => {
    setSearchValue(search);
  }, [search]);

  useEffect(() => {
    if (actionData && "importResult" in actionData && actionData.importResult) {
      const { imported, suggested } = actionData.importResult;
      shopify.toast.show(
        `Imported ${imported} product(s), ${suggested} SKU suggestion(s) applied`,
      );
    }
  }, [actionData, shopify]);

  const selectedTab = STATUS_TABS.findIndex((t) =>
    status === "all" ? t.id === "all" : t.status === status,
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

  const handleSearchSubmit = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (searchValue.trim()) next.set("search", searchValue.trim());
      else next.delete("search");
      next.delete("page");
      return next;
    });
  }, [searchValue, setSearchParams]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));

  const rowMarkup = mappings.map((mapping, index) => {
    const firstSku =
      mapping.variantMappings.find((v) => v.sku)?.sku ??
      mapping.variantMappings[0]?.sku ??
      "—";

    return (
      <IndexTable.Row
        id={mapping.id}
        key={mapping.id}
        position={index}
        onClick={() => navigate(`/app/mappings/${mapping.id}`)}
      >
        <IndexTable.Cell>
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <Thumbnail
              source={mapping.sourceImageUrl ?? ""}
              alt={mapping.sourceTitle}
              size="small"
            />
            <BlockStack gap="100">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {mapping.sourceTitle}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                SKU: {firstSku}
              </Text>
            </BlockStack>
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Box paddingInlineStart="200" paddingInlineEnd="200">
            <Icon source={ArrowRightIcon} tone="subdued" />
          </Box>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {mapping.targetProductId ? (
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <Thumbnail
                source={mapping.targetImageUrl ?? ""}
                alt={mapping.targetTitle ?? "Target product"}
                size="small"
              />
              <Text as="span" variant="bodyMd">
                {mapping.targetTitle}
              </Text>
            </InlineStack>
          ) : (
            <Text as="span" tone="subdued">
              — not mapped —
            </Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>{statusBadge(mapping.status)}</IndexTable.Cell>
        <IndexTable.Cell>{matchMethodBadge(mapping.matchMethod)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {formatRelativeDate(mapping.sourceUpdatedAt?.toString())}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {formatRelativeDate(mapping.lastSyncedAt?.toString())}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {mapping.status === "FAILED" && mapping.lastError ? (
            <Tooltip content={mapping.lastError}>
              <Text as="span" variant="bodySm" tone="critical">
                {truncateError(mapping.lastError)}
              </Text>
            </Tooltip>
          ) : (
            <Text as="span" tone="subdued">
              —
            </Text>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const tabs = STATUS_TABS.map((tab) => ({
    id: tab.id,
    content: tab.label,
    badge: String(statusCounts[tab.id === "all" ? "all" : tab.status!] ?? 0),
  }));

  return (
    <Page
      title="Product Mappings"
      primaryAction={{
        content: "Import from source",
        loading: isImporting,
        onAction: () => submit({ intent: "import-all" }, { method: "post" }),
      }}
    >
      <TitleBar title="Product Mappings" />

      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title="Import failed">
            <p>{actionData.error}</p>
          </Banner>
        )}

        <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange} />

        <Form
          method="get"
          onSubmit={(e) => {
            e.preventDefault();
            handleSearchSubmit();
          }}
        >
          <InlineStack gap="300" blockAlign="end">
            <Box minWidth="320px">
              <TextField
                label="Search"
                labelHidden
                placeholder="Search by title or SKU"
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
            <button type="submit" style={{ display: "none" }} aria-hidden />
          </InlineStack>
        </Form>

        {mappings.length === 0 ? (
          <EmptyState
            heading="No product mappings found"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              {search || status !== "all"
                ? "Try adjusting your filters or search term."
                : 'Click "Import from source" to pull products from 72hours.ca.'}
            </p>
          </EmptyState>
        ) : (
          <BlockStack gap="400">
            <IndexTable
              resourceName={{ singular: "mapping", plural: "mappings" }}
              itemCount={mappings.length}
              selectable={false}
              headings={[
                { title: "Source product" },
                { title: "" },
                { title: "Target product" },
                { title: "Status" },
                { title: "Match" },
                { title: "Source updated" },
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
