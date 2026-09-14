import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { handleProductUpdateWebhook } from "../services/product-sync.server";
import { logError } from "../services/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic, webhookId } = await authenticate.webhook(request);

  try {
    await handleProductUpdateWebhook(
      shop,
      webhookId,
      payload as Record<string, unknown>,
    );
  } catch (error) {
    logError(`Failed to process ${topic} webhook for ${shop}`, error);
    throw error;
  }

  return new Response();
};
