import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
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
  Button,
  Card,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Select,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import type { PriceRowStatus } from "@prisma/client";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  createCatalogForGroup,
  getPriceListPrices,
  importGroupPrices,
  linkExistingPriceList,
  listCompanyLocationCatalogs,
  retryFailedRows,
  syncGroupPrices,
} from "../services/pricing-sync.server";
import { formatMoney } from "../utils/numbers";
import { formatRelativeDate } from "../utils/format";

const ROW_TABS: Array<{ id: string; label: string; status?: PriceRowStatus; reason?: string }> =
  [
    { id: "all", label: "All" },
    { id: "PENDING", label: "Pending", status: "PENDING" },
    { id: "SYNCED", label: "Synced", status: "SYNCED" },
    { id: "SKIPPED", label: "Skipped", status: "SKIPPED" },
    { id: "FAILED", label: "Failed", status: "FAILED" },
    { id: "ORPHANED", label: "Orphaned", reason: "ORPHANED" },
  ];

function rowBadge(status: PriceRowStatus, reason: string | null) {
  if (reason === "ORPHANED") {
    return <Badge tone="warning">Orphaned</Badge>;
  }
  const map: Record<
    PriceRowStatus,
    { tone: "attention" | "info" | "warning" | "success" | "critical"; label: string }
  > = {
    PENDING: { tone: "info", label: "Pending" },
    SYNCED: { tone: "success", label: "Synced" },
    SKIPPED: { tone: "attention", label: "Skipped" },
    FAILED: { tone: "critical", label: "Failed" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{reason ? `${label}: ${reason}` : label}</Badge>;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const group = await prisma.pricingGroup.findUnique({
    where: { id: params.id },
    include: { prices: { orderBy: { sku: "asc" } } },
  });
  if (!group) {
    throw new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? "all";
  const success = url.searchParams.get("success");

  const filteredPrices = group.prices.filter((row) => {
    if (filter === "all") return true;
    if (filter === "ORPHANED") return row.statusReason === "ORPHANED";
    return row.status === filter;
  });

  let shopifyPrices: Array<{ variantId: string; sku: string | null; amount: string }> = [];
  let catalogs: Awaited<ReturnType<typeof listCompanyLocationCatalogs>> = [];
  try {
    if (group.priceListId) {
      shopifyPrices = await getPriceListPrices(group.priceListId);
    }
    catalogs = await listCompanyLocationCatalogs();
  } catch {
    shopifyPrices = [];
    catalogs = [];
  }

  const warningCounts = {
    missing: group.prices.filter((row) => row.statusReason === "MISSING_SKU").length,
    duplicate: group.prices.filter((row) => row.statusReason === "DUPLICATE_SKU").length,
    invalid: group.prices.filter((row) => row.statusReason === "INVALID_PRICE").length,
    orphaned: group.prices.filter((row) => row.statusReason === "ORPHANED").length,
  };

  return json({
    group: {
      ...group,
      prices: filteredPrices.map((row) => ({
        ...row,
        price: row.price.toString(),
      })),
      allCount: group.prices.length,
    },
    filter,
    success,
    shopifyPrices,
    catalogs,
    warningCounts,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const actor = session.shop;
  const groupId = params.id;
  if (!groupId) {
    return json({ error: "Missing group ID" }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "import":
        await importGroupPrices(groupId);
        return redirect(`/app/pricing/${groupId}?success=${encodeURIComponent("Imported prices from NetSuite")}`);
      case "sync":
        await syncGroupPrices(groupId, { trigger: "MANUAL", actor });
        return redirect(`/app/pricing/${groupId}?success=${encodeURIComponent("Group sync completed")}`);
      case "retry":
        await retryFailedRows(groupId, actor);
        return redirect(`/app/pricing/${groupId}?success=${encodeURIComponent("Retry completed")}`);
      case "create-catalog":
        await createCatalogForGroup(groupId, actor);
        return redirect(`/app/pricing/${groupId}?success=${encodeURIComponent("Catalog and price list created")}`);
      case "link-catalog": {
        const priceListId = String(formData.get("priceListId") ?? "").trim();
        const catalogId = String(formData.get("catalogId") ?? "").trim() || null;
        if (!priceListId) {
          return json({ error: "Price list ID is required" }, { status: 400 });
        }
        await linkExistingPriceList(groupId, priceListId, catalogId, actor);
        return redirect(`/app/pricing/${groupId}?success=${encodeURIComponent("Catalog mapping saved")}`);
      }
      default:
        return json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed";
    return json({ error: message }, { status: 400 });
  }
};

export default function PricingGroupDetailPage() {
  const { group, filter, success, shopifyPrices, catalogs, warningCounts } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [, setSearchParams] = useSearchParams();
  const [priceListId, setPriceListId] = useState(group.priceListId ?? "");
  const [catalogId, setCatalogId] = useState(group.catalogId ?? "");
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [selectedCatalog, setSelectedCatalog] = useState("");

  const submittingIntent = navigation.formData?.get("intent");
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (success) {
      shopify.toast.show(success);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("success");
          return next;
        },
        { replace: true },
      );
    }
  }, [success, shopify, setSearchParams]);

  const shopifyPriceByVariant = new Map(
    shopifyPrices.map((price) => [price.variantId, price.amount]),
  );

  const selectedTab = Math.max(
    0,
    ROW_TABS.findIndex((tab) => tab.id === filter),
  );

  const handleTabChange = useCallback(
    (index: number) => {
      const tab = ROW_TABS[index];
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (tab.id === "all") next.delete("filter");
        else next.set("filter", tab.id);
        return next;
      });
    },
    [setSearchParams],
  );

  const catalogOptions = [
    { label: "Select an existing catalog", value: "" },
    ...catalogs.map((catalog) => ({
      label: `${catalog.title}${catalog.priceList ? ` · ${catalog.priceList.name}` : ""}`,
      value: catalog.id,
    })),
  ];

  return (
    <Page
      backAction={{ content: "Pricing Groups", url: "/app/pricing" }}
      title={group.name}
      subtitle={`NetSuite ${group.netsuiteGroupId}`}
      primaryAction={{
        content: "Sync group",
        loading: isSubmitting && submittingIntent === "sync",
        disabled: !group.priceListId,
        onAction: () => submit({ intent: "sync" }, { method: "post" }),
      }}
      secondaryActions={[
        {
          content: "Import prices",
          loading: isSubmitting && submittingIntent === "import",
          onAction: () => submit({ intent: "import" }, { method: "post" }),
        },
        {
          content: "Retry failed",
          loading: isSubmitting && submittingIntent === "retry",
          onAction: () => submit({ intent: "retry" }, { method: "post" }),
        },
      ]}
    >
      <TitleBar title={group.name} />
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {(warningCounts.missing > 0 ||
          warningCounts.duplicate > 0 ||
          warningCounts.invalid > 0 ||
          warningCounts.orphaned > 0) && (
          <Banner tone="warning" title="SKU warnings">
            <p>
              Missing: {warningCounts.missing} · Duplicate: {warningCounts.duplicate} ·
              Invalid price: {warningCounts.invalid} · Orphaned: {warningCounts.orphaned}
            </p>
            <p>
              Orphaned SKUs keep their Shopify fixed price. Review and clean them up
              manually if needed.
            </p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Catalog mapping
            </Text>
            <Text as="p" variant="bodySm">
              Catalog: {group.catalogId ?? "—"}
            </Text>
            <Text as="p" variant="bodySm">
              Price list: {group.priceListId ?? "—"}
            </Text>
            <InlineStack gap="300">
              <Button
                variant="primary"
                loading={isSubmitting && submittingIntent === "create-catalog"}
                onClick={() => submit({ intent: "create-catalog" }, { method: "post" })}
              >
                Create catalog & price list
              </Button>
              <Button onClick={() => setLinkModalOpen(true)}>Link existing</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Tabs
          tabs={ROW_TABS.map((tab) => ({ id: tab.id, content: tab.label }))}
          selected={selectedTab}
          onSelect={handleTabChange}
        />

        <IndexTable
          resourceName={{ singular: "price", plural: "prices" }}
          itemCount={group.prices.length}
          selectable={false}
          headings={[
            { title: "SKU" },
            { title: "NetSuite price" },
            { title: "Shopify price" },
            { title: "Variant" },
            { title: "Status" },
            { title: "Last synced" },
          ]}
        >
          {group.prices.map((row, index) => (
            <IndexTable.Row id={row.id} key={row.id} position={index}>
              <IndexTable.Cell>
                <Text as="span" fontWeight="semibold">
                  {row.sku}
                </Text>
              </IndexTable.Cell>
              <IndexTable.Cell>{formatMoney(row.price)} CAD</IndexTable.Cell>
              <IndexTable.Cell>
                {row.variantId
                  ? formatMoney(shopifyPriceByVariant.get(row.variantId) ?? null)
                  : "—"}
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" variant="bodySm">
                  {row.variantId ?? "—"}
                </Text>
              </IndexTable.Cell>
              <IndexTable.Cell>{rowBadge(row.status, row.statusReason)}</IndexTable.Cell>
              <IndexTable.Cell>
                {formatRelativeDate(row.lastSyncedAt?.toString())}
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
        {group.prices.length === 0 && (
          <Text as="p" tone="subdued">
            No price rows for this filter. Import from NetSuite to load SKUs.
          </Text>
        )}
      </BlockStack>

      <Modal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title="Link existing catalog / price list"
        primaryAction={{
          content: "Save mapping",
          loading: isSubmitting && submittingIntent === "link-catalog",
          onAction: () => {
            submit(
              {
                intent: "link-catalog",
                priceListId,
                catalogId,
              },
              { method: "post" },
            );
            setLinkModalOpen(false);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setLinkModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Select
              label="Existing company location catalogs"
              options={catalogOptions}
              value={selectedCatalog}
              onChange={(value) => {
                setSelectedCatalog(value);
                const catalog = catalogs.find((item) => item.id === value);
                if (catalog) {
                  setCatalogId(catalog.id);
                  setPriceListId(catalog.priceList?.id ?? "");
                }
              }}
            />
            <TextField
              label="Catalog GID"
              value={catalogId}
              onChange={setCatalogId}
              autoComplete="off"
            />
            <TextField
              label="Price list GID"
              value={priceListId}
              onChange={setPriceListId}
              autoComplete="off"
              helpText="Two NetSuite groups cannot share the same price list."
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
