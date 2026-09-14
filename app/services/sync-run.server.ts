import {
  SyncRunStatus,
  type Prisma,
  type SyncTrigger,
  type SyncType,
} from "@prisma/client";
import prisma from "../db.server";

export async function createSyncRun(input: {
  type: SyncType;
  trigger: SyncTrigger;
  subjectType?: string;
  subjectId?: string;
  triggeredBy?: string;
}): Promise<{ id: string }> {
  return prisma.syncRun.create({
    data: {
      type: input.type,
      trigger: input.trigger,
      status: SyncRunStatus.RUNNING,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      triggeredBy: input.triggeredBy ?? "system",
    },
    select: { id: true },
  });
}

export async function finishSyncRun(
  syncRunId: string,
  status: SyncRunStatus,
  counts: {
    successCount?: number;
    skippedCount?: number;
    failedCount?: number;
    errorDetails?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await prisma.syncRun.update({
    where: { id: syncRunId },
    data: {
      status,
      successCount: counts.successCount ?? 0,
      skippedCount: counts.skippedCount ?? 0,
      failedCount: counts.failedCount ?? 0,
      errorDetails: counts.errorDetails,
      finishedAt: new Date(),
    },
  });
}

export async function hasRunningSync(
  type: SyncType,
  subjectType?: string,
  subjectId?: string,
): Promise<boolean> {
  const running = await prisma.syncRun.findFirst({
    where: {
      type,
      status: SyncRunStatus.RUNNING,
      ...(subjectType ? { subjectType } : {}),
      ...(subjectId ? { subjectId } : {}),
    },
    select: { id: true },
  });
  return Boolean(running);
}

export function syncRunStatusFromCounts(counts: {
  successCount: number;
  skippedCount: number;
  failedCount: number;
}): SyncRunStatus {
  if (counts.failedCount > 0 && counts.successCount === 0) {
    return SyncRunStatus.FAILED;
  }
  if (counts.skippedCount > 0 || counts.failedCount > 0) {
    return SyncRunStatus.PARTIAL;
  }
  return SyncRunStatus.SUCCESS;
}
