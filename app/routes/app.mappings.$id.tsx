import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  Icon,
  InlineError,
  InlineStack,
  Layout,
  Modal,
  Page,
  Text,
  TextField,
  Thumbnail,
} from "@shopify/polaris";
import { AlertCircleIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  confirmMapping,
  pullFromSource,
  pushToTarget,
  removeMapping,
  suggestMapping,
  syncNow,
} from "../services/product-sync.server";

function formatRelativeDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
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

function parseProductGid(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^gid:\/\/shopify\/Product\/\d+$/.test(trimmed)) {
    return trimmed;
  }

  const adminUrlMatch = trimmed.match(
    /admin\.shopify\.com\/store\/[^/]+\/products\/(\d+)/,
  );
  if (adminUrlMatch) {
    return `gid://shopify/Product/${adminUrlMatch[1]}`;
  }

  const legacyAdminMatch = trimmed.match(/\/admin\/products\/(\d+)/);
  if (legacyAdminMatch) {
    return `gid://shopify/Product/${legacyAdminMatch[1]}`;
  }

  return null;
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const mapping = await prisma.productMapping.findUnique({
    where: { id: params.id },
    include: { variantMappings: true },
  });

  if (!mapping) {
    throw new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const success = url.searchParams.get("success");

  return json({ mapping, success });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const actor = session.shop;
  const mappingId = params.id;

  if (!mappingId) {
    return json({ error: "Missing mapping ID", field: null }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "suggest": {
        await suggestMapping(mappingId);
        return redirect(
          `/app/mappings/${mappingId}?success=${encodeURIComponent("SKU suggestion applied")}`,
        );
      }
      case "confirm": {
        const targetInput = String(formData.get("targetProductId") ?? "");
        const gid = parseProductGid(targetInput);
        if (!gid) {
          return json(
            {
              error:
                "Enter a valid Shopify Admin product URL or product GID (gid://shopify/Product/...)",
              field: "targetProductId",
            },
            { status: 400 },
          );
        }
        await confirmMapping(mappingId, gid, actor);
        return redirect(
          `/app/mappings/${mappingId}?success=${encodeURIComponent("Mapping confirmed")}`,
        );
      }
      case "remove": {
        await removeMapping(mappingId, actor);
        return redirect(
          `/app/mappings/${mappingId}?success=${encodeURIComponent("Target mapping removed")}`,
        );
      }
      case "pull": {
        const mapping = await prisma.productMapping.findUniqueOrThrow({
          where: { id: mappingId },
        });
        await pullFromSource(mapping.sourceProductId);
        return redirect(
          `/app/mappings/${mappingId}?success=${encodeURIComponent("Pulled latest from source")}`,
        );
      }
      case "push": {
        await pushToTarget(mappingId, { trigger: "MANUAL", actor });
        return redirect(
          `/app/mappings/${mappingId}?success=${encodeURIComponent("Pushed to target store")}`,
        );
      }
      case "sync": {
        await syncNow(mappingId, actor);
        return redirect(
          `/app/mappings/${mappingId}?success=${encodeURIComponent("Sync completed")}`,
        );
      }
      default:
        return json({ error: "Unknown action", field: null }, { status: 400 });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Action failed unexpectedly";
    return json({ error: message, field: null }, { status: 400 });
  }
};

export default function MappingDetailPage() {
  const { mapping, success } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [, setSearchParams] = useSearchParams();

  const [targetProductInput, setTargetProductInput] = useState(
    mapping.targetProductId ?? "",
  );
  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | undefined>();

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

  useEffect(() => {
    if (actionData && "field" in actionData && actionData.field === "targetProductId") {
      setConfirmError(actionData.error);
    }
  }, [actionData]);

  const submitIntent = useCallback(
    (intent: string, extra?: Record<string, string>) => {
      submit({ intent, ...extra }, { method: "post" });
    },
    [submit],
  );

  const isIntentLoading = (intent: string) =>
    isSubmitting && submittingIntent === intent;

  const variantRows = mapping.variantMappings.map((variant) => [
    variant.sku ?? "—",
    variant.sourceVariantId,
    variant.targetVariantId ?? (
      <InlineStack gap="100" blockAlign="center" wrap={false}>
        <Icon source={AlertCircleIcon} tone="warning" />
        <Text as="span" tone="caution">
          Unmatched
        </Text>
      </InlineStack>
    ),
  ]);

  const targetConfirmDisabled = !targetProductInput.trim();

  return (
    <Page
      backAction={{ content: "Product Mappings", url: "/app/mappings" }}
      title={mapping.sourceTitle}
      subtitle={`Mapping ${mapping.id}`}
    >
      <TitleBar title={mapping.sourceTitle} />

      <BlockStack gap="400">
        {actionData && "error" in actionData && !actionData.field && (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {mapping.status === "FAILED" && mapping.lastError && (
          <Banner tone="critical" title="Last sync error">
            <p>{mapping.lastError}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingSm">
              Mapping metadata
            </Text>
            <InlineStack gap="400" wrap>
              <Text as="span" variant="bodySm">
                Confirmed by: {mapping.confirmedBy ?? "—"}
              </Text>
              <Text as="span" variant="bodySm">
                Confirmed:{" "}
                {mapping.confirmedAt
                  ? formatRelativeDate(mapping.confirmedAt.toString())
                  : "—"}
              </Text>
              <Text as="span" variant="bodySm">
                Content hash: {shortHash(mapping.contentHash)}
              </Text>
              <Text as="span" variant="bodySm">
                Status: {mapping.status}
              </Text>
            </InlineStack>
          </BlockStack>
        </Card>

        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Source product (72hours.ca)
                </Text>
                <InlineStack gap="400" blockAlign="start" wrap={false}>
                  <Thumbnail
                    source={mapping.sourceImageUrl ?? ""}
                    alt={mapping.sourceTitle}
                    size="large"
                  />
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {mapping.sourceTitle}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {mapping.sourceProductId}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Updated{" "}
                      {formatRelativeDate(mapping.sourceUpdatedAt?.toString())}
                    </Text>
                  </BlockStack>
                </InlineStack>
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["SKU", "Source variant ID", "Target variant ID"]}
                  rows={variantRows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Target product (b2b-site)
                </Text>
                {mapping.targetProductId ? (
                  <InlineStack gap="400" blockAlign="start" wrap={false}>
                    <Thumbnail
                      source={mapping.targetImageUrl ?? ""}
                      alt={mapping.targetTitle ?? "Target product"}
                      size="large"
                    />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {mapping.targetTitle}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {mapping.targetProductId}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Last synced{" "}
                        {formatRelativeDate(mapping.lastSyncedAt?.toString())}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                ) : (
                  <Text as="p" tone="subdued">
                    — not mapped —
                  </Text>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Actions
            </Text>

            <InlineStack gap="300" wrap>
              <Button
                loading={isIntentLoading("suggest")}
                onClick={() => submitIntent("suggest")}
              >
                Suggest by SKU
              </Button>
              <Button
                loading={isIntentLoading("pull")}
                onClick={() => submitIntent("pull")}
              >
                Pull from source
              </Button>
              <Button
                loading={isIntentLoading("push")}
                disabled={!mapping.targetProductId}
                onClick={() => submitIntent("push")}
              >
                Push to target
              </Button>
              <Button
                variant="primary"
                loading={isIntentLoading("sync")}
                onClick={() => submitIntent("sync")}
              >
                Sync now
              </Button>
              <Button
                tone="critical"
                onClick={() => setRemoveModalOpen(true)}
                disabled={!mapping.targetProductId}
              >
                Remove mapping
              </Button>
            </InlineStack>

            <Form
              method="post"
              onSubmit={(e) => {
                const gid = parseProductGid(targetProductInput);
                if (!gid) {
                  e.preventDefault();
                  setConfirmError(
                    "Enter a valid Shopify Admin product URL or product GID (gid://shopify/Product/...)",
                  );
                  return;
                }
                setConfirmError(undefined);
              }}
            >
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  Confirm mapping
                </Text>
                <TextField
                  label="Target product"
                  helpText="Paste a Shopify Admin product URL or product GID"
                  value={targetProductInput}
                  onChange={(value) => {
                    setTargetProductInput(value);
                    if (confirmError) setConfirmError(undefined);
                  }}
                  autoComplete="off"
                  error={confirmError}
                />
                {confirmError && !actionData?.field && (
                  <InlineError message={confirmError} fieldID="targetProductId" />
                )}
                <input type="hidden" name="targetProductId" value={targetProductInput} />
                <input type="hidden" name="intent" value="confirm" />
                <Box>
                  <Button
                    submit
                    variant="primary"
                    loading={isIntentLoading("confirm")}
                    disabled={targetConfirmDisabled}
                  >
                    Confirm mapping
                  </Button>
                </Box>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={removeModalOpen}
        onClose={() => setRemoveModalOpen(false)}
        title="Remove target mapping?"
        primaryAction={{
          content: "Remove mapping",
          destructive: true,
          loading: isIntentLoading("remove"),
          onAction: () => {
            submitIntent("remove");
            setRemoveModalOpen(false);
          },
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setRemoveModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This clears the target product link and variant matches. Source data
            is kept. You can map again later.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
