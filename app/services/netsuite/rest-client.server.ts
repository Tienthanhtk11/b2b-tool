import { createHmac, randomBytes } from "node:crypto";
import type {
  NetSuiteClient,
  NetSuiteGroupPrice,
  NetSuiteItem,
  NetSuitePricingGroup,
} from "./types";

const SUITEQL_PAGE_SIZE = 1000;

const SUITEQL_PRICING_GROUPS = `
SELECT
  id,
  name,
  isinactive,
  lastmodifieddate
FROM pricinggroup
`.trim();

const SUITEQL_GROUP_PRICES = `
SELECT
  p.item AS item_id,
  i.itemid AS sku,
  p.unitprice AS price
FROM pricing p
INNER JOIN item i ON p.item = i.id
WHERE p.pricelevel = ?
`.trim();

const SUITEQL_ITEMS = `
SELECT
  i.id AS item_id,
  i.itemid AS sku,
  i.isinactive,
  p.unitprice AS base_price,
  ia.quantityavailable AS quantity_available
FROM item i
LEFT JOIN pricing p ON p.item = i.id AND p.pricelevel = 1
LEFT JOIN inventoryitemlocations ia ON ia.item = i.id
WHERE i.itemtype IN ('InvtPart', 'NonInvtPart', 'Assembly', 'Kit')
`.trim();

interface SuiteQlResponse {
  items?: Array<Record<string, unknown>>;
  hasMore?: boolean;
  count?: number;
  offset?: number;
  totalResults?: number;
}

function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function accountHost(accountId: string): string {
  return accountId.toLowerCase().replace(/_/g, "-");
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function asString(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function asBooleanActive(inactiveValue: unknown): boolean {
  if (typeof inactiveValue === "boolean") {
    return !inactiveValue;
  }
  const normalized = asString(inactiveValue).toUpperCase();
  return !(normalized === "T" || normalized === "TRUE" || normalized === "YES");
}

function toIsoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  const parsed = new Date(asString(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildOAuthHeader(method: string, url: string): string {
  const accountId = requiredEnv("NETSUITE_ACCOUNT_ID");
  const consumerKey = requiredEnv("NETSUITE_CONSUMER_KEY");
  const consumerSecret = requiredEnv("NETSUITE_CONSUMER_SECRET");
  const tokenId = requiredEnv("NETSUITE_TOKEN_ID");
  const tokenSecret = requiredEnv("NETSUITE_TOKEN_SECRET");

  const parsedUrl = new URL(url);
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: tokenId,
    oauth_version: "1.0",
  };

  const signatureParams: Record<string, string> = { ...oauthParams };
  parsedUrl.searchParams.forEach((value, key) => {
    signatureParams[key] = value;
  });

  const paramString = Object.keys(signatureParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(signatureParams[key]!)}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(`${parsedUrl.origin}${parsedUrl.pathname}`),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = createHmac("sha256", signingKey).update(baseString).digest("base64");

  const headerParams: Array<[string, string]> = [
    ["realm", accountId],
    ...Object.entries(oauthParams),
    ["oauth_signature", signature],
  ];

  return `OAuth ${headerParams
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ")}`;
}

export class SuiteTalkRestClient implements NetSuiteClient {
  private baseUrl(): string {
    const accountId = requiredEnv("NETSUITE_ACCOUNT_ID");
    return `https://${accountHost(accountId)}.suitetalk.api.netsuite.com`;
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      requiredEnv("NETSUITE_ACCOUNT_ID");
      requiredEnv("NETSUITE_CONSUMER_KEY");
      requiredEnv("NETSUITE_CONSUMER_SECRET");
      requiredEnv("NETSUITE_TOKEN_ID");
      requiredEnv("NETSUITE_TOKEN_SECRET");
      await this.runSuiteQl("SELECT id FROM pricinggroup FETCH FIRST 1 ROWS ONLY");
      return { ok: true, message: "Connected to NetSuite SuiteTalk REST" };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "NetSuite connection failed";
      return { ok: false, message };
    }
  }

  async fetchPricingGroups(): Promise<NetSuitePricingGroup[]> {
    const rows = await this.runSuiteQl(SUITEQL_PRICING_GROUPS);
    return rows.map((row) => ({
      id: asString(row.id ?? row.ID),
      name: asString(row.name ?? row.NAME),
      isActive: asBooleanActive(row.isinactive ?? row.ISINACTIVE),
      lastModified: toIsoDate(row.lastmodifieddate ?? row.LASTMODIFIEDDATE),
    }));
  }

  async fetchGroupPrices(groupId: string): Promise<NetSuiteGroupPrice[]> {
    const query = SUITEQL_GROUP_PRICES.replace("?", `'${groupId.replace(/'/g, "''")}'`);
    const rows = await this.runSuiteQl(query);
    return rows.map((row) => ({
      groupId,
      itemId: asString(row.item_id ?? row.ITEM_ID ?? row.item ?? row.ITEM),
      sku: asString(row.sku ?? row.SKU ?? row.itemid ?? row.ITEMID),
      price: asString(row.price ?? row.PRICE ?? row.unitprice ?? row.UNITPRICE),
      currency: "CAD",
    }));
  }

  async fetchItems(): Promise<NetSuiteItem[]> {
    const rows = await this.runSuiteQl(SUITEQL_ITEMS);
    return rows.map((row) => ({
      itemId: asString(row.item_id ?? row.ITEM_ID ?? row.id ?? row.ID),
      sku: asString(row.sku ?? row.SKU ?? row.itemid ?? row.ITEMID),
      basePrice:
        row.base_price == null && row.BASE_PRICE == null && row.unitprice == null
          ? null
          : asString(row.base_price ?? row.BASE_PRICE ?? row.unitprice),
      quantityAvailable: toNumberOrNull(
        row.quantity_available ?? row.QUANTITY_AVAILABLE ?? row.quantityavailable,
      ),
      isActive: asBooleanActive(row.isinactive ?? row.ISINACTIVE),
    }));
  }

  private async runSuiteQl(query: string): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${this.baseUrl()}/services/rest/query/v1/suiteql?limit=${SUITEQL_PAGE_SIZE}&offset=${offset}`;
      const authorization = buildOAuthHeader("POST", url);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          Prefer: "transient",
        },
        body: JSON.stringify({ q: query }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`NetSuite SuiteQL ${response.status}: ${body.slice(0, 500)}`);
      }

      const json = (await response.json()) as SuiteQlResponse;
      const page = json.items ?? [];
      rows.push(...page);

      const headerHasMore = response.headers.get("has-more");
      hasMore =
        json.hasMore === true ||
        headerHasMore === "true" ||
        page.length === SUITEQL_PAGE_SIZE;
      offset += page.length;

      if (page.length === 0) {
        hasMore = false;
      }
    }

    return rows;
  }
}

export const NETSUITE_SUITEQL = {
  pricingGroups: SUITEQL_PRICING_GROUPS,
  groupPrices: SUITEQL_GROUP_PRICES,
  items: SUITEQL_ITEMS,
};

