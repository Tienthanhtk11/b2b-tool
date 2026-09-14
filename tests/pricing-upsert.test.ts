import { describe, expect, it, vi } from "vitest";
import {
  addFixedPrices,
  PRICE_LIST_BATCH_SIZE,
  toFixedPriceInput,
} from "../app/services/price-list.server";
import type { AdminClient } from "../app/services/admin-graphql.server";

function stubAdmin(handler: (query: string, variables?: Record<string, unknown>) => unknown): AdminClient {
  return {
    graphql: vi.fn(async (query: string, options?: { variables?: Record<string, unknown> }) => ({
      json: async () => handler(query, options?.variables),
    })),
  } as unknown as AdminClient;
}

describe("pricing upsert idempotency", () => {
  it("builds add-or-update inputs with CAD amounts", () => {
    expect(toFixedPriceInput("gid://shopify/ProductVariant/1", "10.00")).toEqual({
      variantId: "gid://shopify/ProductVariant/1",
      price: { amount: "10.00", currencyCode: "CAD" },
    });
  });

  it("calls priceListFixedPricesAdd again with the same payload", async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const admin = stubAdmin((_query, variables) => {
      calls.push(variables);
      return {
        data: {
          priceListFixedPricesAdd: {
            prices: [{ variant: { id: "gid://shopify/ProductVariant/1" } }],
            userErrors: [],
          },
        },
      };
    });

    const prices = [
      { variantId: "gid://shopify/ProductVariant/1", amount: "29.99" },
    ];
    const priceListId = "gid://shopify/PriceList/1";

    await addFixedPrices(admin, priceListId, prices);
    await addFixedPrices(admin, priceListId, prices);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toEqual({
      priceListId,
      prices: [
        {
          variantId: "gid://shopify/ProductVariant/1",
          price: { amount: "29.99", currencyCode: "CAD" },
        },
      ],
    });
  });

  it("batches at 250 rows", () => {
    expect(PRICE_LIST_BATCH_SIZE).toBe(250);
  });
});
