import { useCallback, useEffect, useState } from "react";
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
  Button,
  EmptyState,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Pagination,
  Select,
  Tabs,
  Text,
  TextField,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import type { AssignmentStatus } from "@prisma/client";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  assignGroup,
  bulkAssign,
  importCompanyLocations,
  removeGroup,
  retryFailedAssignment,
} from "../services/assignment.server";
import { formatRelativeDate } from "../utils/format";

const PAGE_SIZE = 25;
const STATUS_TABS: Array<{ id: string; label: string; status?: AssignmentStatus }> =
  [
    { id: "all", label: "All" },
    { id: "UNASSIGNED", label: "Unassigned", status: "UNASSIGNED" },
    { id: "ASSIGNED", label: "Assigned", status: "ASSIGNED" },
    { id: "CONFLICT", label: "Conflict", status: "CONFLICT" },
    { id: "FAILED", label: "Failed", status: "FAILED" },
  ];

function statusBadge(status: AssignmentStatus) {
  const map: Record<
    AssignmentStatus,
    { tone: "attention" | "info" | "warning" | "success" | "critical"; label: string }
  > = {
    UNASSIGNED: { tone: "attention", label: "Unassigned" },
    ASSIGNED: { tone: "success", label: "Assigned" },
    CONFLICT: { tone: "warning", label: "Conflict" },
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
      ? (statusParam as AssignmentStatus)
      : undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { companyName: { contains: search, mode: "insensitive" as const } },
            { locationName: { contains: search, mode: "insensitive" as const } },
            { contactEmail: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [assignments, filteredCount, groups] = await Promise.all([
    prisma.locationAssignment.findMany({
      where,
      include: { pricingGroup: true },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.locationAssignment.count({ where }),
    prisma.pricingGroup.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, catalogId: true, status: true },
    }),
  ]);

  return json({
    assignments,
    filteredCount,
    groups,
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
    if (intent === "import") {
      const result = await importCompanyLocations();
      return json({ success: `Imported ${result.imported} company location(s)` });
    }
    if (intent === "assign") {
      const assignmentId = String(formData.get("assignmentId") ?? "");
      const pricingGroupId = String(formData.get("pricingGroupId") ?? "");
      const result = await assignGroup(assignmentId, pricingGroupId, actor);
      if (result.status === "CONFLICT") {
        return json({ error: result.lastError ?? "Assignment conflict" }, { status: 400 });
      }
      return json({ success: "Group assigned" });
    }
    if (intent === "remove") {
      await removeGroup(String(formData.get("assignmentId") ?? ""), actor);
      return json({ success: "Group removed" });
    }
    if (intent === "retry") {
      await retryFailedAssignment(String(formData.get("assignmentId") ?? ""), actor);
      return json({ success: "Retry completed" });
    }
    if (intent === "bulk-assign") {
      const ids = String(formData.get("assignmentIds") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const pricingGroupId = String(formData.get("pricingGroupId") ?? "");
      const result = await bulkAssign(ids, pricingGroupId, actor);
      return json({
        success: `Bulk assign: ${result.successCount} assigned, ${result.conflictCount} conflict, ${result.failedCount} failed`,
      });
    }
    return json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed";
    return json({ error: message }, { status: 400 });
  }
};

export default function CustomersPage() {
  const { assignments, filteredCount, groups, page, pageSize, status, search } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [, setSearchParams] = useSearchParams();
  const shopify = useAppBridge();
  const [searchValue, setSearchValue] = useState(search);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id ?? "");

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(assignments);

  const submittingIntent = navigation.formData?.get("intent");
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      shopify.toast.show(actionData.success);
      clearSelection();
    }
  }, [actionData, shopify, clearSelection]);

  const groupOptions = groups.map((group) => ({
    label: `${group.name}${group.catalogId ? "" : " (unmapped)"}`,
    value: group.id,
    disabled: !group.catalogId,
  }));

  const selectedTab = STATUS_TABS.findIndex((tab) =>
    status === "all" ? tab.id === "all" : tab.status === status,
  );
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));

  const openAssign = useCallback((assignmentId: string) => {
    setActiveAssignmentId(assignmentId);
    setAssignModalOpen(true);
  }, []);

  return (
    <Page
      title="Customer group assignment"
      primaryAction={{
        content: "Import company locations",
        loading: isSubmitting && submittingIntent === "import",
        onAction: () => submit({ intent: "import" }, { method: "post" }),
      }}
      secondaryActions={[
        {
          content: "Bulk assign selected",
          disabled: selectedResources.length === 0,
          onAction: () => setBulkModalOpen(true),
        },
      ]}
    >
      <TitleBar title="Customers" />
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
          </Banner>
        )}

        <Tabs
          tabs={STATUS_TABS.map((tab) => ({ id: tab.id, content: tab.label }))}
          selected={Math.max(0, selectedTab)}
          onSelect={(index) => {
            const tab = STATUS_TABS[index];
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
          <Box maxWidth="360px">
            <TextField
              label="Search"
              labelHidden
              placeholder="Search company, location, or email"
              value={searchValue}
              onChange={setSearchValue}
              autoComplete="off"
            />
          </Box>
        </Form>

        {assignments.length === 0 ? (
          <EmptyState
            heading="No company locations yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Import company locations from b2b-site to assign pricing groups.</p>
          </EmptyState>
        ) : (
          <BlockStack gap="400">
            <IndexTable
              resourceName={{ singular: "location", plural: "locations" }}
              itemCount={assignments.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Company" },
                { title: "Location" },
                { title: "Email" },
                { title: "Group" },
                { title: "Status" },
                { title: "Updated" },
                { title: "Actions" },
              ]}
            >
              {assignments.map((assignment, index) => (
                <IndexTable.Row
                  id={assignment.id}
                  key={assignment.id}
                  position={index}
                  selected={selectedResources.includes(assignment.id)}
                >
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {assignment.companyName}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{assignment.locationName}</IndexTable.Cell>
                  <IndexTable.Cell>{assignment.contactEmail ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {assignment.pricingGroup?.name ?? "—"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{statusBadge(assignment.status)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {formatRelativeDate(assignment.updatedAt.toString())}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="200">
                      <Button
                        size="slim"
                        onClick={() => openAssign(assignment.id)}
                      >
                        {assignment.pricingGroupId ? "Change" : "Assign"}
                      </Button>
                      {assignment.pricingGroupId && (
                        <Button
                          size="slim"
                          tone="critical"
                          loading={
                            isSubmitting &&
                            submittingIntent === "remove" &&
                            navigation.formData?.get("assignmentId") === assignment.id
                          }
                          onClick={() =>
                            submit(
                              { intent: "remove", assignmentId: assignment.id },
                              { method: "post" },
                            )
                          }
                        >
                          Remove
                        </Button>
                      )}
                      {assignment.status === "FAILED" && assignment.pricingGroupId && (
                        <Button
                          size="slim"
                          onClick={() =>
                            submit(
                              { intent: "retry", assignmentId: assignment.id },
                              { method: "post" },
                            )
                          }
                        >
                          Retry
                        </Button>
                      )}
                    </InlineStack>
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

      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Assign pricing group"
        primaryAction={{
          content: "Assign",
          disabled: !selectedGroupId || !activeAssignmentId,
          loading: isSubmitting && submittingIntent === "assign",
          onAction: () => {
            if (!activeAssignmentId) return;
            submit(
              {
                intent: "assign",
                assignmentId: activeAssignmentId,
                pricingGroupId: selectedGroupId,
              },
              { method: "post" },
            );
            setAssignModalOpen(false);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAssignModalOpen(false) }]}
      >
        <Modal.Section>
          <Select
            label="Pricing group"
            options={groupOptions}
            value={selectedGroupId}
            onChange={setSelectedGroupId}
            helpText="Only groups mapped to a Shopify catalog can be assigned."
          />
        </Modal.Section>
      </Modal>

      <Modal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title={`Assign ${selectedResources.length} location(s)`}
        primaryAction={{
          content: "Bulk assign",
          disabled: !selectedGroupId || selectedResources.length === 0,
          loading: isSubmitting && submittingIntent === "bulk-assign",
          onAction: () => {
            submit(
              {
                intent: "bulk-assign",
                assignmentIds: selectedResources.join(","),
                pricingGroupId: selectedGroupId,
              },
              { method: "post" },
            );
            setBulkModalOpen(false);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setBulkModalOpen(false) }]}
      >
        <Modal.Section>
          <Select
            label="Pricing group"
            options={groupOptions}
            value={selectedGroupId}
            onChange={setSelectedGroupId}
          />
        </Modal.Section>
      </Modal>
    </Page>
  );
}
