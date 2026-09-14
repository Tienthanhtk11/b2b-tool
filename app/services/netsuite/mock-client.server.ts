import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  NetSuiteClient,
  NetSuiteGroupPrice,
  NetSuiteItem,
  NetSuitePricingGroup,
} from "./types";

function fixturesDir(): string {
  return process.env.NETSUITE_FIXTURES_DIR ?? join(process.cwd(), "netsuite-fixtures");
}

function readJsonFile<T>(filename: string): T {
  const path = join(fixturesDir(), filename);
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as T;
}

function isCadCurrency(value: string): value is "CAD" {
  return value === "CAD";
}

function normalizeGroup(raw: NetSuitePricingGroup): NetSuitePricingGroup {
  return {
    id: String(raw.id),
    name: String(raw.name),
    isActive: Boolean(raw.isActive),
    lastModified: raw.lastModified ?? null,
  };
}

function normalizeGroupPrice(raw: NetSuiteGroupPrice, groupId: string): NetSuiteGroupPrice {
  const currency = isCadCurrency(raw.currency) ? raw.currency : "CAD";
  return {
    groupId: String(raw.groupId || groupId),
    itemId: String(raw.itemId),
    sku: String(raw.sku),
    price: String(raw.price),
    currency,
  };
}

function normalizeItem(raw: NetSuiteItem): NetSuiteItem {
  return {
    itemId: String(raw.itemId),
    sku: String(raw.sku),
    basePrice: raw.basePrice == null ? null : String(raw.basePrice),
    quantityAvailable:
      raw.quantityAvailable == null ? null : Number(raw.quantityAvailable),
    isActive: Boolean(raw.isActive),
  };
}

export class MockNetSuiteClient implements NetSuiteClient {
  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      readJsonFile<unknown>("pricing-groups.json");
      return { ok: true, message: "Mock NetSuite client (fixtures)" };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to read NetSuite fixtures";
      return { ok: false, message };
    }
  }

  async fetchPricingGroups(): Promise<NetSuitePricingGroup[]> {
    const groups = readJsonFile<NetSuitePricingGroup[]>("pricing-groups.json");
    return groups.map(normalizeGroup);
  }

  async fetchGroupPrices(groupId: string): Promise<NetSuiteGroupPrice[]> {
    const all = readJsonFile<Record<string, NetSuiteGroupPrice[]>>("group-prices.json");
    const prices = all[groupId] ?? [];
    return prices.map((price) => normalizeGroupPrice(price, groupId));
  }

  async fetchItems(): Promise<NetSuiteItem[]> {
    const items = readJsonFile<NetSuiteItem[]>("items.json");
    return items.map(normalizeItem);
  }
}
