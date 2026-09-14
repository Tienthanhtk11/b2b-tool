import type { getAdminClient } from "./shops.server";

export type AdminClient = Awaited<ReturnType<typeof getAdminClient>>;

export interface GraphQLUserError {
  field?: string[] | null;
  message: string;
}

export function throwUserErrors(label: string, errors: GraphQLUserError[]): void {
  if (errors.length > 0) {
    throw new Error(
      `${label}: ${errors.map((error) => error.message).join("; ")}`,
    );
  }
}

export async function adminGraphql<T>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  if (!json.data) {
    throw new Error("GraphQL response missing data");
  }

  return json.data;
}
