import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

function normalizeShop(shop: string): string {
  return shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function getSourceShop(): string {
  const shop = process.env.SOURCE_SHOP_DOMAIN;
  if (!shop) {
    throw new Error("SOURCE_SHOP_DOMAIN is not configured");
  }
  return normalizeShop(shop);
}

export function getTargetShop(): string {
  const shop = process.env.TARGET_SHOP_DOMAIN;
  if (!shop) {
    throw new Error("TARGET_SHOP_DOMAIN is not configured");
  }
  return normalizeShop(shop);
}

export async function hasShopSession(shop: string): Promise<boolean> {
  const normalizedShop = normalizeShop(shop);
  const session = await prisma.session.findFirst({
    where: { shop: normalizedShop },
    select: { id: true },
  });
  return Boolean(session);
}

export async function getAdminClient(shop: string) {
  const normalizedShop = normalizeShop(shop);

  const session = await prisma.session.findFirst({
    where: { shop: normalizedShop },
  });

  if (!session) {
    throw new Error(`App not installed on shop: ${normalizedShop}`);
  }

  const { admin } = await unauthenticated.admin(normalizedShop);
  return admin;
}
