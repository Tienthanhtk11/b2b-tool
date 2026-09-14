import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Pagination,
  Tabs,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import type { SyncRunStatus, SyncType } from "@prisma/client";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { formatDateTime, truncateText } from "../utils/format";

const PAGE_SIZE = 25;

function syncBadge(status: SyncRunStatus) {
  const tone =
    status === "SUCCESS"
      ? "success"
      : status === "FAILED"
        ? "critical"
        : status === "PARTIAL"
          ? "attention"
          : "info";
  return <Badge tone={tone}>{status}</Badge>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") === "audit" ? "audit" : "runs";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  if (tab === "audit") {
    const [logs, count] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.auditLog.count(),
    ]);
    return json({
      tab,
      page,
      pageSize: PAGE_SIZE,
      runs: [] as Array<{
        id: string;
        type: SyncType;
        trigger: string;
        status: SyncRunStatus;
        subjectType: string | null;
        successCount: number;
        skippedCount: number;
        failedCount: number;
        triggeredBy: string | null;
        startedAt: Date;
        finishedAt: Date | null;
        errorDetails: unknown;
      }>,
      runCount: 0,
      logs,
      logCount: count,
    });
  }

  const [runs, count] = await Promise.all([
    prisma.syncRun.findMany({
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.syncRun.count(),
  ]);

  return json({
    tab,
    page,
    pageSize: PAGE_SIZE,
    runs,
    runCount: count,
    logs: [] as Array<{
      id: string;
      actor: string;
      action: string;
      entityType: string;
      entityId: string;
      details: unknown;
      createdAt: Date;
    }>,
    logCount: 0,
  });
};

export default function HistoryPage() {
  const { tab, page, pageSize, runs, runCount, logs, logCount } =
    useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState(tab === "audit" ? 1 : 0);
  const total = tab === "audit" ? logCount : runCount;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Page title="Sync history">
      <TitleBar title="History" />
      <BlockStack gap="400">
        <Tabs
          tabs={[
            { id: "runs", content: "Sync runs" },
            { id: "audit", content: "Audit log" },
          ]}
          selected={selected}
          onSelect={(index) => {
            setSelected(index);
            setSearchParams({ tab: index === 1 ? "audit" : "runs" });
          }}
        />

        {tab === "runs" ? (
          <Card>
            <IndexTable
              resourceName={{ singular: "run", plural: "runs" }}
              itemCount={runs.length}
              selectable={false}
              headings={[
                { title: "Type" },
                { title: "Trigger" },
                { title: "Status" },
                { title: "Counts" },
                { title: "Actor" },
                { title: "Started" },
                { title: "Error" },
              ]}
            >
              {runs.map((run, index) => (
                <IndexTable.Row id={run.id} key={run.id} position={index}>
                  <IndexTable.Cell>
                    {run.type}
                    {run.subjectType ? ` / ${run.subjectType}` : ""}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{run.trigger}</IndexTable.Cell>
                  <IndexTable.Cell>{syncBadge(run.status)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {run.successCount}/{run.skippedCount}/{run.failedCount}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{run.triggeredBy ?? "—"}</IndexTable.Cell>
                  <IndexTable.Cell>{formatDateTime(run.startedAt.toString())}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm">
                      {run.errorDetails
                        ? truncateText(JSON.stringify(run.errorDetails), 60)
                        : "—"}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
            {runs.length === 0 && (
              <Text as="p" tone="subdued">
                No sync runs yet.
              </Text>
            )}
          </Card>
        ) : (
          <Card>
            <IndexTable
              resourceName={{ singular: "event", plural: "events" }}
              itemCount={logs.length}
              selectable={false}
              headings={[
                { title: "When" },
                { title: "Actor" },
                { title: "Action" },
                { title: "Entity" },
                { title: "Details" },
              ]}
            >
              {logs.map((log, index) => (
                <IndexTable.Row id={log.id} key={log.id} position={index}>
                  <IndexTable.Cell>{formatDateTime(log.createdAt.toString())}</IndexTable.Cell>
                  <IndexTable.Cell>{log.actor}</IndexTable.Cell>
                  <IndexTable.Cell>{log.action}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {log.entityType} {log.entityId}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" variant="bodySm">
                      {log.details ? truncateText(JSON.stringify(log.details), 80) : "—"}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
            {logs.length === 0 && (
              <Text as="p" tone="subdued">
                No audit events yet.
              </Text>
            )}
          </Card>
        )}

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
    </Page>
  );
}
