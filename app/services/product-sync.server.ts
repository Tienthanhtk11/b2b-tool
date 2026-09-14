import { createHash } from "node:crypto";
import {
  MappingStatus,
  MatchMethod,
  Prisma,
  SyncRunStatus,
  SyncType,
  type ProductMapping,
  type SyncTrigger,
} from "@prisma/client";
import prisma from "../db.server";
import {
  adminGraphql,
  throwUserErrors,
  type AdminClient,
  type GraphQLUserError,
} from "./admin-graphql.server";
import { logError } from "./logger.server";
import { getAdminClient, getSourceShop, getTargetShop } from "./shops.server";
import { finishSyncRun } from "./sync-run.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceProductImage {
  url: string;
  altText: string | null;
  position: number;
}

interface SourceProductVariant {
  id: string;
  sku: string | null;
}

interface SourceProduct {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  tags: string[];
  updatedAt: string;
  seo: {
    title: string | null;
    description: string | null;
  };
  featuredMedia: {
    preview: {
      image: {
        url: string;
      } | null;
    } | null;
  } | null;
  media: {
    nodes: Array<{
      alt: string | null;
      image: {
        url: string;
      } | null;
    }>;
  };
  variants: {
    nodes: SourceProductVariant[];
  };
}

interface TargetProductSummary {
  id: string;
  title: string;
  featuredMedia: {
    preview: {
      image: {
        url: string;
      } | null;
    } | null;
  } | null;
  variants: {
    nodes: Array<{
      id: string;
      sku: string | null;
    }>;
  };
}

interface TargetProductMediaNode {
  id: string;
  alt: string | null;
  mediaContentType: string;
  image?: {
    url: string;
  } | null;
}

interface TargetProductMedia {
  id: string;
  media: {
    nodes: TargetProductMediaNode[];
  };
}

interface ProductVariantLookupNode {
  id: string;
  sku: string | null;
  product: {
    id: string;
    title: string;
    featuredMedia: {
      preview: {
        image: {
          url: string;
        } | null;
      } | null;
    } | null;
  };
}

interface UnmappedProductNode {
  id: string;
  title: string;
  featuredMedia: {
    preview: {
      image: {
        url: string;
      } | null;
    } | null;
  } | null;
  updatedAt: string;
}

interface ContentHashPayload {
  title: string;
  handle: string;
  descriptionHtml: string;
  tags: string[];
  seo: {
    title: string | null;
    description: string | null;
  };
  images: SourceProductImage[];
  variants: Array<{ id: string; sku: string | null }>;
}

export interface UnmappedProductsPage {
  products: UnmappedProductNode[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const SOURCE_PRODUCT_QUERY = `#graphql
  query SourceProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      descriptionHtml
      tags
      updatedAt
      seo {
        title
        description
      }
      featuredMedia {
        preview {
          image {
            url
          }
        }
      }
      media(first: 50) {
        nodes {
          ... on MediaImage {
            alt
            image {
              url
            }
          }
        }
      }
      variants(first: 100) {
        nodes {
          id
          sku
        }
      }
    }
  }
`;

const TARGET_PRODUCT_QUERY = `#graphql
  query TargetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      featuredMedia {
        preview {
          image {
            url
          }
        }
      }
      variants(first: 100) {
        nodes {
          id
          sku
        }
      }
    }
  }
`;

const TARGET_PRODUCT_MEDIA_QUERY = `#graphql
  query TargetProductMedia($id: ID!) {
    product(id: $id) {
      id
      media(first: 50) {
        nodes {
          id
          alt
          mediaContentType
          ... on MediaImage {
            image {
              url
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_BY_SKU_QUERY = `#graphql
  query ProductVariantsBySku($q: String!) {
    productVariants(first: 10, query: $q) {
      nodes {
        id
        sku
        product {
          id
          title
          featuredMedia {
            preview {
              image {
                url
              }
            }
          }
        }
      }
    }
  }
`;

const LIST_SOURCE_PRODUCTS_QUERY = `#graphql
  query ListSourceProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        updatedAt
        featuredMedia {
          preview {
            image {
              url
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation ProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_CREATE_MEDIA_MUTATION = `#graphql
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_DELETE_MEDIA_MUTATION = `#graphql
  mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeSkuForQuery(sku: string): string {
  return sku.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function extractSourceImages(product: SourceProduct): SourceProductImage[] {
  const images: SourceProductImage[] = [];

  for (const [index, node] of product.media.nodes.entries()) {
    if (node.image?.url) {
      images.push({
        url: node.image.url,
        altText: node.alt,
        position: index + 1,
      });
    }
  }

  return images;
}

function buildContentHashPayload(product: SourceProduct): ContentHashPayload {
  return {
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml,
    tags: [...product.tags].sort(),
    seo: {
      title: product.seo.title,
      description: product.seo.description,
    },
    images: extractSourceImages(product),
    variants: product.variants.nodes
      .map((variant) => ({ id: variant.id, sku: variant.sku }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function computeContentHash(product: SourceProduct): string {
  const payload = buildContentHashPayload(product);
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function featuredImageUrl(
  featuredMedia: SourceProduct["featuredMedia"],
): string | null {
  return featuredMedia?.preview?.image?.url ?? null;
}

async function fetchSourceProduct(
  admin: AdminClient,
  sourceProductId: string,
): Promise<SourceProduct> {
  const data = await adminGraphql<{ product: SourceProduct | null }>(
    admin,
    SOURCE_PRODUCT_QUERY,
    { id: sourceProductId },
  );

  if (!data.product) {
    throw new Error(`Source product not found: ${sourceProductId}`);
  }

  return data.product;
}

async function fetchTargetProductSummary(
  admin: AdminClient,
  targetProductId: string,
): Promise<TargetProductSummary> {
  const data = await adminGraphql<{ product: TargetProductSummary | null }>(
    admin,
    TARGET_PRODUCT_QUERY,
    { id: targetProductId },
  );

  if (!data.product) {
    throw new Error(`Target product not found: ${targetProductId}`);
  }

  return data.product;
}

function mapVariantsBySku(
  sourceVariants: SourceProductVariant[],
  targetVariants: Array<{ id: string; sku: string | null }>,
): Map<string, string> {
  const targetBySku = new Map<string, string>();

  for (const variant of targetVariants) {
    if (variant.sku) {
      targetBySku.set(variant.sku, variant.id);
    }
  }

  const mapping = new Map<string, string>();
  for (const sourceVariant of sourceVariants) {
    if (sourceVariant.sku) {
      const targetVariantId = targetBySku.get(sourceVariant.sku);
      if (targetVariantId) {
        mapping.set(sourceVariant.id, targetVariantId);
      }
    }
  }

  return mapping;
}

function imageSetsEqual(
  sourceImages: SourceProductImage[],
  targetUrls: string[],
): boolean {
  if (sourceImages.length !== targetUrls.length) {
    return false;
  }

  return sourceImages.every(
    (image, index) => normalizeImageUrl(image.url) === normalizeImageUrl(targetUrls[index] ?? ""),
  );
}

function normalizeImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

async function syncTargetProductMedia(
  admin: AdminClient,
  targetProductId: string,
  sourceImages: SourceProductImage[],
): Promise<void> {
  const data = await adminGraphql<{ product: TargetProductMedia | null }>(
    admin,
    TARGET_PRODUCT_MEDIA_QUERY,
    { id: targetProductId },
  );

  if (!data.product) {
    throw new Error(`Target product not found: ${targetProductId}`);
  }

  const targetMedia = data.product.media.nodes.filter(
    (node) => node.mediaContentType === "IMAGE" && node.image?.url,
  );
  const targetUrls = targetMedia.map((node) => node.image!.url);

  if (imageSetsEqual(sourceImages, targetUrls)) {
    return;
  }

  if (targetMedia.length > 0) {
    const deleteResult = await adminGraphql<{
      productDeleteMedia: {
        deletedMediaIds: string[];
        mediaUserErrors: GraphQLUserError[];
      };
    }>(admin, PRODUCT_DELETE_MEDIA_MUTATION, {
      productId: targetProductId,
      mediaIds: targetMedia.map((node) => node.id),
    });

    throwUserErrors(
      "productDeleteMedia",
      deleteResult.productDeleteMedia.mediaUserErrors,
    );
  }

  if (sourceImages.length === 0) {
    return;
  }

  const createResult = await adminGraphql<{
    productCreateMedia: {
      media: Array<{ id: string }>;
      mediaUserErrors: GraphQLUserError[];
    };
  }>(admin, PRODUCT_CREATE_MEDIA_MUTATION, {
    productId: targetProductId,
    media: sourceImages.map((image) => ({
      originalSource: image.url,
      alt: image.altText ?? "",
      mediaContentType: "IMAGE",
    })),
  });

  throwUserErrors(
    "productCreateMedia",
    createResult.productCreateMedia.mediaUserErrors,
  );
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export async function pullFromSource(
  sourceProductId: string,
): Promise<ProductMapping> {
  const sourceShop = getSourceShop();
  const admin = await getAdminClient(sourceShop);
  const product = await fetchSourceProduct(admin, sourceProductId);

  const contentHash = computeContentHash(product);
  const sourceImageUrl = featuredImageUrl(product.featuredMedia);

  const existing = await prisma.productMapping.findUnique({
    where: { sourceProductId },
    include: { variantMappings: true },
  });

  const existingTargetVariantIds = new Map<string, string | null>();
  if (existing) {
    for (const variantMapping of existing.variantMappings) {
      existingTargetVariantIds.set(
        variantMapping.sourceVariantId,
        variantMapping.targetVariantId,
      );
    }
  }

  const mapping = await prisma.productMapping.upsert({
    where: { sourceProductId },
    create: {
      sourceProductId,
      sourceTitle: product.title,
      sourceImageUrl,
      sourceUpdatedAt: new Date(product.updatedAt),
      contentHash,
      status: MappingStatus.NEEDS_MAPPING,
      variantMappings: {
        create: product.variants.nodes.map((variant) => ({
          sourceVariantId: variant.id,
          sku: variant.sku,
        })),
      },
    },
    update: {
      sourceTitle: product.title,
      sourceImageUrl,
      sourceUpdatedAt: new Date(product.updatedAt),
      contentHash,
    },
    include: { variantMappings: true },
  });

  for (const variant of product.variants.nodes) {
    await prisma.variantMapping.upsert({
      where: {
        productMappingId_sourceVariantId: {
          productMappingId: mapping.id,
          sourceVariantId: variant.id,
        },
      },
      create: {
        productMappingId: mapping.id,
        sourceVariantId: variant.id,
        sku: variant.sku,
        targetVariantId: existingTargetVariantIds.get(variant.id) ?? null,
      },
      update: {
        sku: variant.sku,
        targetVariantId: existingTargetVariantIds.get(variant.id) ?? undefined,
      },
    });
  }

  return prisma.productMapping.findUniqueOrThrow({
    where: { id: mapping.id },
    include: { variantMappings: true },
  });
}

export async function suggestMapping(mappingId: string): Promise<ProductMapping> {
  const mapping = await prisma.productMapping.findUniqueOrThrow({
    where: { id: mappingId },
    include: { variantMappings: true },
  });

  if (mapping.targetProductId) {
    return mapping;
  }

  const skus = mapping.variantMappings
    .map((variant) => variant.sku)
    .filter((sku): sku is string => Boolean(sku));

  if (skus.length === 0) {
    await prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        status: MappingStatus.NEEDS_MAPPING,
        lastError: "No source variant SKUs available for matching",
      },
    });
    return prisma.productMapping.findUniqueOrThrow({ where: { id: mappingId } });
  }

  const uniqueSkus = new Set(skus);
  if (uniqueSkus.size !== skus.length) {
    await prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        status: MappingStatus.NEEDS_MAPPING,
        lastError: "Duplicate SKUs among source variants",
      },
    });
    return prisma.productMapping.findUniqueOrThrow({ where: { id: mappingId } });
  }

  const targetAdmin = await getAdminClient(getTargetShop());
  const matches: ProductVariantLookupNode[] = [];

  for (const sku of skus) {
    const data = await adminGraphql<{
      productVariants: { nodes: ProductVariantLookupNode[] };
    }>(targetAdmin, PRODUCT_VARIANTS_BY_SKU_QUERY, {
      q: `sku:'${escapeSkuForQuery(sku)}'`,
    });

    const nodes = data.productVariants.nodes.filter(
      (node) => node.sku === sku,
    );

    if (nodes.length !== 1) {
      await prisma.productMapping.update({
        where: { id: mappingId },
        data: {
          status: MappingStatus.NEEDS_MAPPING,
          lastError:
            nodes.length === 0
              ? `No target variant found for SKU: ${sku}`
              : `Multiple target variants found for SKU: ${sku}`,
        },
      });
      return prisma.productMapping.findUniqueOrThrow({ where: { id: mappingId } });
    }

    matches.push(nodes[0]!);
  }

  const targetProductIds = new Set(matches.map((match) => match.product.id));
  if (targetProductIds.size !== 1) {
    await prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        status: MappingStatus.NEEDS_MAPPING,
        lastError: "Source SKUs resolve to multiple target products",
      },
    });
    return prisma.productMapping.findUniqueOrThrow({ where: { id: mappingId } });
  }

  const targetProduct = matches[0]!.product;
  const skuToTargetVariantId = new Map(
    matches.map((match) => [match.sku!, match.id]),
  );

  await prisma.$transaction([
    prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        targetProductId: targetProduct.id,
        targetTitle: targetProduct.title,
        targetImageUrl: featuredImageUrl(targetProduct.featuredMedia),
        matchMethod: MatchMethod.SKU_SUGGESTION,
        status: MappingStatus.READY,
        lastError: null,
        confirmedBy: null,
        confirmedAt: null,
      },
    }),
    ...mapping.variantMappings.map((variantMapping) =>
      prisma.variantMapping.update({
        where: { id: variantMapping.id },
        data: {
          targetVariantId: variantMapping.sku
            ? (skuToTargetVariantId.get(variantMapping.sku) ?? null)
            : null,
        },
      }),
    ),
  ]);

  return prisma.productMapping.findUniqueOrThrow({
    where: { id: mappingId },
    include: { variantMappings: true },
  });
}

export async function confirmMapping(
  mappingId: string,
  targetProductId: string,
  actor: string,
): Promise<ProductMapping> {
  const mapping = await prisma.productMapping.findUniqueOrThrow({
    where: { id: mappingId },
    include: { variantMappings: true },
  });

  const targetAdmin = await getAdminClient(getTargetShop());
  const targetProduct = await fetchTargetProductSummary(
    targetAdmin,
    targetProductId,
  );

  const variantLinks = mapVariantsBySku(
    mapping.variantMappings.map((variant) => ({
      id: variant.sourceVariantId,
      sku: variant.sku,
    })),
    targetProduct.variants.nodes,
  );

  await prisma.$transaction([
    prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        targetProductId: targetProduct.id,
        targetTitle: targetProduct.title,
        targetImageUrl: featuredImageUrl(targetProduct.featuredMedia),
        matchMethod: MatchMethod.MANUAL,
        status: MappingStatus.READY,
        lastError: null,
        confirmedBy: actor,
        confirmedAt: new Date(),
      },
    }),
    ...mapping.variantMappings.map((variantMapping) =>
      prisma.variantMapping.update({
        where: { id: variantMapping.id },
        data: {
          targetVariantId:
            variantLinks.get(variantMapping.sourceVariantId) ?? null,
        },
      }),
    ),
    prisma.auditLog.create({
      data: {
        actor,
        action: "MAPPING_CONFIRMED",
        entityType: "ProductMapping",
        entityId: mappingId,
        details: {
          targetProductId: targetProduct.id,
          targetTitle: targetProduct.title,
        },
      },
    }),
  ]);

  return prisma.productMapping.findUniqueOrThrow({
    where: { id: mappingId },
    include: { variantMappings: true },
  });
}

export async function removeMapping(
  mappingId: string,
  actor: string,
): Promise<ProductMapping> {
  const mapping = await prisma.productMapping.findUniqueOrThrow({
    where: { id: mappingId },
    include: { variantMappings: true },
  });

  await prisma.$transaction([
    prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        targetProductId: null,
        targetTitle: null,
        targetImageUrl: null,
        matchMethod: null,
        status: MappingStatus.NEEDS_MAPPING,
        lastError: null,
        confirmedBy: null,
        confirmedAt: null,
      },
    }),
    ...mapping.variantMappings.map((variantMapping) =>
      prisma.variantMapping.update({
        where: { id: variantMapping.id },
        data: { targetVariantId: null },
      }),
    ),
    prisma.auditLog.create({
      data: {
        actor,
        action: "MAPPING_REMOVED",
        entityType: "ProductMapping",
        entityId: mappingId,
        details: {
          previousTargetProductId: mapping.targetProductId,
        },
      },
    }),
  ]);

  return prisma.productMapping.findUniqueOrThrow({
    where: { id: mappingId },
    include: { variantMappings: true },
  });
}

export async function pushToTarget(
  mappingId: string,
  opts: { trigger: "WEBHOOK" | "MANUAL"; actor?: string },
): Promise<ProductMapping> {
  const mapping = await prisma.productMapping.findUniqueOrThrow({
    where: { id: mappingId },
  });

  const allowedStatuses: MappingStatus[] = [
    MappingStatus.READY,
    MappingStatus.SYNCED,
    MappingStatus.FAILED,
  ];

  if (
    !allowedStatuses.includes(mapping.status) ||
    !mapping.targetProductId
  ) {
    throw new Error(
      `Mapping ${mappingId} is not ready to sync (status=${mapping.status})`,
    );
  }

  const syncRun = await prisma.syncRun.create({
    data: {
      type: SyncType.PRODUCT_SYNC,
      trigger: opts.trigger as SyncTrigger,
      status: SyncRunStatus.RUNNING,
      subjectType: "ProductMapping",
      subjectId: mappingId,
      triggeredBy: opts.actor ?? "system",
    },
  });

  await prisma.productMapping.update({
    where: { id: mappingId },
    data: { status: MappingStatus.SYNCING },
  });

  try {
    const sourceAdmin = await getAdminClient(getSourceShop());
    const targetAdmin = await getAdminClient(getTargetShop());

    const sourceProduct = await fetchSourceProduct(
      sourceAdmin,
      mapping.sourceProductId,
    );
    const sourceImages = extractSourceImages(sourceProduct);

    const updateResult = await adminGraphql<{
      productUpdate: {
        product: { id: string } | null;
        userErrors: GraphQLUserError[];
      };
    }>(targetAdmin, PRODUCT_UPDATE_MUTATION, {
      input: {
        id: mapping.targetProductId,
        title: sourceProduct.title,
        descriptionHtml: sourceProduct.descriptionHtml,
        tags: sourceProduct.tags,
        seo: {
          title: sourceProduct.seo.title,
          description: sourceProduct.seo.description,
        },
      },
    });

    throwUserErrors("productUpdate", updateResult.productUpdate.userErrors);

    await syncTargetProductMedia(
      targetAdmin,
      mapping.targetProductId,
      sourceImages,
    );

    const updatedMapping = await prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        status: MappingStatus.SYNCED,
        lastSyncedAt: new Date(),
        lastError: null,
      },
    });

    await finishSyncRun(syncRun.id, SyncRunStatus.SUCCESS, {
      successCount: 1,
    });

    return updatedMapping;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync error";
    logError(`pushToTarget failed for mapping ${mappingId}`, error);

    await prisma.productMapping.update({
      where: { id: mappingId },
      data: {
        status: MappingStatus.FAILED,
        lastError: message,
      },
    });

    await finishSyncRun(syncRun.id, SyncRunStatus.FAILED, {
      failedCount: 1,
      errorDetails: { message },
    });

    throw error;
  }
}

export async function syncNow(
  mappingId: string,
  actor: string,
): Promise<ProductMapping> {
  const existing = await prisma.productMapping.findUniqueOrThrow({
    where: { id: mappingId },
  });

  const oldHash = existing.contentHash;
  const oldStatus = existing.status;

  const updated = await pullFromSource(existing.sourceProductId);

  if (updated.contentHash !== oldHash || oldStatus === MappingStatus.FAILED) {
    return pushToTarget(mappingId, { trigger: "MANUAL", actor });
  }

  return updated;
}

export async function handleProductUpdateWebhook(
  shop: string,
  webhookId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sourceShop = getSourceShop();
  if (shop !== sourceShop) {
    return;
  }

  try {
    await prisma.webhookEvent.create({
      data: {
        id: webhookId,
        shop,
        topic: "products/update",
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }

  try {
    const sourceProductId = payload.admin_graphql_api_id;
    if (typeof sourceProductId !== "string") {
      throw new Error("Webhook payload missing admin_graphql_api_id");
    }

    const existing = await prisma.productMapping.findUnique({
      where: { sourceProductId },
    });

    const oldHash = existing?.contentHash ?? null;
    const oldSourceUpdatedAt = existing?.sourceUpdatedAt ?? null;

    const updated = await pullFromSource(sourceProductId);

    const staleEvent =
      oldSourceUpdatedAt !== null &&
      updated.sourceUpdatedAt !== null &&
      updated.sourceUpdatedAt < oldSourceUpdatedAt;

    const hashUnchanged = oldHash !== null && updated.contentHash === oldHash;

    if (staleEvent || hashUnchanged) {
      return;
    }

    let mapping = updated;

    if (mapping.status === MappingStatus.NEEDS_MAPPING) {
      mapping = await suggestMapping(mapping.id);
    }

    if (
      mapping.status === MappingStatus.READY ||
      mapping.status === MappingStatus.SYNCED
    ) {
      await pushToTarget(mapping.id, { trigger: "WEBHOOK" });
    }
  } catch (error) {
    // Release the dedup record so Shopify's webhook retry can reprocess
    // this event instead of being silently skipped.
    await prisma.webhookEvent
      .delete({ where: { id: webhookId } })
      .catch(() => undefined);
    throw error;
  }
}

export async function listUnmappedSourceProducts(
  cursor?: string | null,
): Promise<UnmappedProductsPage> {
  const sourceAdmin = await getAdminClient(getSourceShop());

  const data = await adminGraphql<{
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: UnmappedProductNode[];
    };
  }>(sourceAdmin, LIST_SOURCE_PRODUCTS_QUERY, {
    first: 50,
    after: cursor ?? null,
  });

  const sourceProductIds = data.products.nodes.map((node) => node.id);
  const existingMappings = await prisma.productMapping.findMany({
    where: { sourceProductId: { in: sourceProductIds } },
    select: { sourceProductId: true },
  });
  const mappedIds = new Set(
    existingMappings.map((mapping) => mapping.sourceProductId),
  );

  return {
    products: data.products.nodes.filter((node) => !mappedIds.has(node.id)),
    pageInfo: data.products.pageInfo,
  };
}

export async function importAllSourceProducts(): Promise<{
  imported: number;
  suggested: number;
}> {
  let cursor: string | null = null;
  let imported = 0;
  let suggested = 0;
  let hasNextPage = true;

  const sourceAdmin = await getAdminClient(getSourceShop());

  while (hasNextPage) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{ id: string }>;
      };
    } = await adminGraphql(sourceAdmin, LIST_SOURCE_PRODUCTS_QUERY, {
      first: 50,
      after: cursor,
    });

    for (const node of data.products.nodes) {
      const mapping = await pullFromSource(node.id);
      imported += 1;

      if (!mapping.targetProductId) {
        const suggestedMapping = await suggestMapping(mapping.id);
        if (suggestedMapping.status === MappingStatus.READY) {
          suggested += 1;
        }
      }
    }

    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  return { imported, suggested };
}
