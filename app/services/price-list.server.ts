import { chunk } from "../utils/numbers";
import {
  adminGraphql,
  throwUserErrors,
  type AdminClient,
  type GraphQLUserError,
} from "./admin-graphql.server";

export const PRICE_LIST_BATCH_SIZE = 250;

export const PRICE_LIST_FIXED_PRICES_ADD_MUTATION = `#graphql
  mutation PriceListFixedPricesAdd($priceListId: ID!, $prices: [PriceListPriceInput!]!) {
    priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
      prices {
        variant {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface FixedPriceInput {
  variantId: string;
  amount: string;
  currency?: string;
}

export function toFixedPriceInput(
  variantId: string,
  amount: string,
  currency = "CAD",
): {
  variantId: string;
  price: { amount: string; currencyCode: string };
} {
  return {
    variantId,
    price: {
      amount,
      currencyCode: currency,
    },
  };
}

export async function addFixedPrices(
  admin: AdminClient,
  priceListId: string,
  prices: FixedPriceInput[],
): Promise<void> {
  for (const batch of chunk(prices, PRICE_LIST_BATCH_SIZE)) {
    const result = await adminGraphql<{
      priceListFixedPricesAdd: {
        prices: Array<{ variant: { id: string } }>;
        userErrors: GraphQLUserError[];
      };
    }>(admin, PRICE_LIST_FIXED_PRICES_ADD_MUTATION, {
      priceListId,
      prices: batch.map((price) =>
        toFixedPriceInput(price.variantId, price.amount, price.currency ?? "CAD"),
      ),
    });
    throwUserErrors(
      "priceListFixedPricesAdd",
      result.priceListFixedPricesAdd.userErrors,
    );
  }
}
