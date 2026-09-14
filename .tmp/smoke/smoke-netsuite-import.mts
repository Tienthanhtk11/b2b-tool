/**
 * Smoke test: mock NetSuite -> Postgres (DB thật, không gọi Shopify API).
 * Chạy: npx tsx .tmp/smoke/smoke-netsuite-import.mts
 */
import prisma from "../../app/db.server";
import { getNetSuiteClient } from "../../app/services/netsuite/index.server";
import {
  importPricingGroups,
  importGroupPrices,
} from "../../app/services/pricing-sync.server";
import { importItems } from "../../app/services/item-sync.server";

async function main() {
  // 0. Connection test
  const client = getNetSuiteClient();
  const conn = await client.testConnection();
  console.log("testConnection:", conn);
  if (!conn.ok) throw new Error("NetSuite mock connection failed");

  // Dọn dữ liệu cũ của các lần smoke trước cho kết quả deterministic
  await prisma.groupPrice.deleteMany();
  await prisma.pricingGroup.deleteMany();
  await prisma.netSuiteItemState.deleteMany();

  // 1. Import pricing groups
  const groupsResult = await importPricingGroups();
  console.log("importPricingGroups:", groupsResult);

  const groups = await prisma.pricingGroup.findMany({ orderBy: { name: "asc" } });
  console.log(
    "groups in DB:",
    groups.map((g) => `${g.netsuiteGroupId}:${g.name} (${g.status})`),
  );
  if (groups.length === 0) throw new Error("No pricing groups imported");

  // 2. Import prices per group
  for (const group of groups) {
    const result = await importGroupPrices(group.id);
    console.log(`importGroupPrices(${group.name}):`, result);
  }

  const priceStats = await prisma.groupPrice.groupBy({
    by: ["status", "statusReason"],
    _count: true,
  });
  console.log("groupPrice status breakdown:", priceStats);

  // 3. Import items (base price + inventory)
  const itemsResult = await importItems();
  console.log("importItems:", itemsResult);

  const itemStats = await prisma.netSuiteItemState.groupBy({
    by: ["priceStatus"],
    _count: true,
  });
  console.log("item priceStatus breakdown:", itemStats);

  // 4. Chạy lại lần 2 để kiểm tra idempotency (không duplicate)
  const groupsBefore = await prisma.pricingGroup.count();
  const pricesBefore = await prisma.groupPrice.count();
  const itemsBefore = await prisma.netSuiteItemState.count();

  await importPricingGroups();
  for (const group of groups) await importGroupPrices(group.id);
  await importItems();

  const groupsAfter = await prisma.pricingGroup.count();
  const pricesAfter = await prisma.groupPrice.count();
  const itemsAfter = await prisma.netSuiteItemState.count();

  if (
    groupsBefore !== groupsAfter ||
    pricesBefore !== pricesAfter ||
    itemsBefore !== itemsAfter
  ) {
    throw new Error(
      `Idempotency FAILED: groups ${groupsBefore}->${groupsAfter}, prices ${pricesBefore}->${pricesAfter}, items ${itemsBefore}->${itemsAfter}`,
    );
  }
  console.log(
    `Idempotency OK: groups=${groupsAfter}, prices=${pricesAfter}, items=${itemsAfter} (không đổi sau lần chạy 2)`,
  );

  console.log("SMOKE TEST PASSED");
}

main()
  .catch((error) => {
    console.error("SMOKE TEST FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
