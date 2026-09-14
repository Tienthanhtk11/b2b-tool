import { adminGraphql, type AdminClient } from "./admin-graphql.server";

export const PRODUCT_VARIANTS_BY_SKU_QUERY = `#graphql
  query ProductVariantsBySku($q: String!) {
    productVariants(first: 10, query: $q) {
      nodes {
        id
        sku
        price
        product {
          id
        }
        inventoryItem {
          id
        }
      }
    }
  }
`;

export interface VariantMatch {
  id: string;
  sku: string | null;
  price: string | null;
  productId: string;
  inventoryItemId: string | null;
}

export type SkuResolveResult =
  | { kind: "valid"; sku: string; variant: VariantMatch }
  | { kind: "missing"; sku: string; reason: "MISSING_SKU" }
  | { kind: "duplicate"; sku: string; reason: "DUPLICATE_SKU" };

export function escapeSkuForQuery(sku: string): string {
  return sku.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function classifySkuMatches(
  sku: string,
  nodes: VariantMatch[],
): SkuResolveResult {
  const exact = nodes.filter((node) => node.sku === sku);
  if (exact.length === 0) {
    return { kind: "missing", sku, reason: "MISSING_SKU" };
  }
  if (exact.length > 1) {
    return { kind: "duplicate", sku, reason: "DUPLICATE_SKU" };
  }
  return { kind: "valid", sku, variant: exact[0]! };
}

export async function resolveVariantBySku(
  admin: AdminClient,
  sku: string,
): Promise<SkuResolveResult> {
  const data = await adminGraphql<{
    productVariants: {
      nodes: Array<{
        id: string;
        sku: string | null;
        price: string | null;
        product: { id: string };
        inventoryItem: { id: string } | null;
      }>;
    };
  }>(admin, PRODUCT_VARIANTS_BY_SKU_QUERY, {
    q: `sku:'${escapeSkuForQuery(sku)}'`,
  });

  const nodes: VariantMatch[] = data.productVariants.nodes.map((node) => ({
    id: node.id,
    sku: node.sku,
    price: node.price,
    productId: node.product.id,
    inventoryItemId: node.inventoryItem?.id ?? null,
  }));

  return classifySkuMatches(sku, nodes);
}
