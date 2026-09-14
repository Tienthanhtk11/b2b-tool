import { describe, expect, it } from "vitest";
import { classifySkuMatches, type VariantMatch } from "../app/services/sku-resolve.server";

function variant(sku: string, id: string): VariantMatch {
  return {
    id,
    sku,
    price: "10.00",
    productId: "gid://shopify/Product/1",
    inventoryItemId: "gid://shopify/InventoryItem/1",
  };
}

describe("SKU resolve rules", () => {
  it("returns valid when exactly one SKU matches", () => {
    const result = classifySkuMatches("BMG-1001", [
      variant("BMG-1001", "gid://shopify/ProductVariant/1"),
    ]);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.variant.id).toBe("gid://shopify/ProductVariant/1");
    }
  });

  it("returns missing when no SKU matches", () => {
    const result = classifySkuMatches("MISSING-SKU-01", [
      variant("BMG-1001", "gid://shopify/ProductVariant/1"),
    ]);
    expect(result).toEqual({
      kind: "missing",
      sku: "MISSING-SKU-01",
      reason: "MISSING_SKU",
    });
  });

  it("returns duplicate when more than one exact SKU matches", () => {
    const result = classifySkuMatches("DUP-SKU-01", [
      variant("DUP-SKU-01", "gid://shopify/ProductVariant/1"),
      variant("DUP-SKU-01", "gid://shopify/ProductVariant/2"),
    ]);
    expect(result).toEqual({
      kind: "duplicate",
      sku: "DUP-SKU-01",
      reason: "DUPLICATE_SKU",
    });
  });
});
