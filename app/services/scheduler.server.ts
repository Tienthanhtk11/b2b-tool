import cron from "node-cron";
import { SyncTrigger, SyncType } from "@prisma/client";
import { logError } from "./logger.server";
import { importItems, syncInventory, syncItemPrices } from "./item-sync.server";
import { syncAllGroups } from "./pricing-sync.server";
import { hasRunningSync } from "./sync-run.server";

const SCHEDULER_FLAG = "__b2bSchedulerStarted";

type SchedulerGlobal = typeof globalThis & {
  [SCHEDULER_FLAG]?: boolean;
};

export async function runScheduledSync(): Promise<void> {
  try {
    if (await hasRunningSync(SyncType.PRICING_SYNC)) {
      console.info("Skipping scheduled pricing sync: a PRICING_SYNC run is already RUNNING");
    } else {
      await syncAllGroups({ trigger: SyncTrigger.SCHEDULED, actor: "system" });
    }
  } catch (error) {
    logError("Scheduled pricing sync failed", error);
  }

  try {
    if (await hasRunningSync(SyncType.ITEM_SYNC)) {
      console.info("Skipping scheduled item sync: an ITEM_SYNC run is already RUNNING");
    } else {
      await importItems();
      await syncItemPrices({ trigger: SyncTrigger.SCHEDULED, actor: "system" });
      await syncInventory({ trigger: SyncTrigger.SCHEDULED, actor: "system" });
    }
  } catch (error) {
    logError("Scheduled item sync failed", error);
  }
}

export function initScheduler(): void {
  if (process.env.ENABLE_SCHEDULER !== "true") {
    return;
  }

  const runtime = globalThis as SchedulerGlobal;
  if (runtime[SCHEDULER_FLAG]) {
    return;
  }
  runtime[SCHEDULER_FLAG] = true;

  cron.schedule("*/15 * * * *", () => {
    void runScheduledSync();
  });
}
