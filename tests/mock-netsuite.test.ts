import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { MockNetSuiteClient } from "../app/services/netsuite/mock-client.server";

describe("Mock NetSuite client", () => {
  const client = new MockNetSuiteClient();

  it("reads pricing group fixtures", async () => {
    process.env.NETSUITE_FIXTURES_DIR = join(process.cwd(), "netsuite-fixtures");
    const groups = await client.fetchPricingGroups();
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.id).sort()).toEqual(["101", "102", "103"]);
    expect(groups.find((group) => group.id === "103")?.isActive).toBe(false);
  });

  it("covers valid, missing, duplicate, and invalid price SKUs", async () => {
    const prices = await client.fetchGroupPrices("101");
    const skus = prices.map((price) => price.sku);
    expect(skus).toContain("BMG-1001");
    expect(skus).toContain("MISSING-SKU-01");
    expect(skus).toContain("DUP-SKU-01");
    expect(prices.find((price) => price.sku === "INVALID-ZERO")?.price).toBe("0");
    expect(prices.find((price) => price.sku === "INVALID-NEG")?.price).toBe("-5.00");
    expect(prices.length).toBeGreaterThanOrEqual(10);
  });

  it("reads item fixtures with base price and quantity", async () => {
    const items = await client.fetchItems();
    const sample = items.find((item) => item.sku === "BMG-1001");
    expect(sample?.basePrice).toBe("39.99");
    expect(sample?.quantityAvailable).toBe(120);
    expect(await client.testConnection()).toMatchObject({ ok: true });
  });
});
