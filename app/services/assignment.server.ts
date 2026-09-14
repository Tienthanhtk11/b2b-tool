import {
  AssignmentStatus,
  SyncTrigger,
  SyncType,
  type LocationAssignment,
} from "@prisma/client";
import prisma from "../db.server";
import {
  adminGraphql,
  throwUserErrors,
  type GraphQLUserError,
} from "./admin-graphql.server";
import { evaluateAssignment } from "./assignment-logic";
import { logError } from "./logger.server";
import { getAdminClient, getTargetShop } from "./shops.server";
import {
  createSyncRun,
  finishSyncRun,
  syncRunStatusFromCounts,
} from "./sync-run.server";

const COMPANY_LOCATIONS_QUERY = `#graphql
  query CompanyLocations($first: Int!, $after: String) {
    companyLocations(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        company {
          id
          name
          contacts(first: 5) {
            nodes {
              isMainContact
              customer {
                defaultEmailAddress {
                  emailAddress
                }
              }
            }
          }
        }
        catalogs(first: 20) {
          nodes {
            id
            title
          }
        }
      }
    }
  }
`;

const CATALOG_CONTEXT_UPDATE_MUTATION = `#graphql
  mutation CatalogContextUpdate(
    $catalogId: ID!
    $contextsToAdd: CatalogContextInput
    $contextsToRemove: CatalogContextInput
  ) {
    catalogContextUpdate(
      catalogId: $catalogId
      contextsToAdd: $contextsToAdd
      contextsToRemove: $contextsToRemove
    ) {
      catalog {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface CompanyLocationNode {
  id: string;
  name: string;
  company: {
    id: string;
    name: string;
    contacts: {
      nodes: Array<{
        isMainContact: boolean;
        customer: {
          defaultEmailAddress: { emailAddress: string } | null;
        } | null;
      }>;
    };
  };
  catalogs: {
    nodes: Array<{ id: string; title: string }>;
  };
}

function contactEmail(node: CompanyLocationNode): string | null {
  const contacts = node.company.contacts.nodes;
  const main = contacts.find((contact) => contact.isMainContact) ?? contacts[0];
  return main?.customer?.defaultEmailAddress?.emailAddress ?? null;
}

async function appManagedCatalogIds(): Promise<Set<string>> {
  const groups = await prisma.pricingGroup.findMany({
    where: { catalogId: { not: null } },
    select: { catalogId: true },
  });
  return new Set(
    groups
      .map((group) => group.catalogId)
      .filter((id): id is string => Boolean(id)),
  );
}

async function locationCatalogIds(locationId: string): Promise<string[]> {
  const admin = await getAdminClient(getTargetShop());
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: {
      companyLocations: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: CompanyLocationNode[];
      };
    } = await adminGraphql(admin, COMPANY_LOCATIONS_QUERY, {
      first: 50,
      after,
    });

    const match = data.companyLocations.nodes.find((node) => node.id === locationId);
    if (match) {
      return match.catalogs.nodes.map((catalog) => catalog.id);
    }

    hasNextPage = data.companyLocations.pageInfo.hasNextPage;
    after = data.companyLocations.pageInfo.endCursor;
  }

  return [];
}

async function updateCatalogContext(
  catalogId: string,
  input: {
    contextsToAdd?: { companyLocationIds: string[] };
    contextsToRemove?: { companyLocationIds: string[] };
  },
): Promise<void> {
  const admin = await getAdminClient(getTargetShop());
  const result = await adminGraphql<{
    catalogContextUpdate: {
      catalog: { id: string } | null;
      userErrors: GraphQLUserError[];
    };
  }>(admin, CATALOG_CONTEXT_UPDATE_MUTATION, {
    catalogId,
    contextsToAdd: input.contextsToAdd,
    contextsToRemove: input.contextsToRemove,
  });
  throwUserErrors("catalogContextUpdate", result.catalogContextUpdate.userErrors);
}

export async function importCompanyLocations(): Promise<{ imported: number }> {
  const admin = await getAdminClient(getTargetShop());
  let imported = 0;
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: {
      companyLocations: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: CompanyLocationNode[];
      };
    } = await adminGraphql(admin, COMPANY_LOCATIONS_QUERY, {
      first: 50,
      after,
    });

    for (const node of data.companyLocations.nodes) {
      await prisma.locationAssignment.upsert({
        where: { companyLocationId: node.id },
        create: {
          companyLocationId: node.id,
          companyId: node.company.id,
          companyName: node.company.name,
          locationName: node.name,
          contactEmail: contactEmail(node),
          status: AssignmentStatus.UNASSIGNED,
        },
        update: {
          companyId: node.company.id,
          companyName: node.company.name,
          locationName: node.name,
          contactEmail: contactEmail(node),
        },
      });
      imported += 1;
    }

    hasNextPage = data.companyLocations.pageInfo.hasNextPage;
    after = data.companyLocations.pageInfo.endCursor;
  }

  return { imported };
}

export async function assignGroup(
  locationAssignmentId: string,
  pricingGroupId: string,
  actor: string,
): Promise<LocationAssignment> {
  const assignment = await prisma.locationAssignment.findUniqueOrThrow({
    where: { id: locationAssignmentId },
  });
  const group = await prisma.pricingGroup.findUniqueOrThrow({
    where: { id: pricingGroupId },
  });

  if (!group.catalogId) {
    throw new Error(`Pricing group "${group.name}" is not mapped to a catalog`);
  }

  const catalogIds = await locationCatalogIds(assignment.companyLocationId);
  const managed = await appManagedCatalogIds();
  const decision = evaluateAssignment(catalogIds, managed, group.catalogId);

  if (decision.outcome === "conflict") {
    const updated = await prisma.locationAssignment.update({
      where: { id: locationAssignmentId },
      data: {
        status: AssignmentStatus.CONFLICT,
        lastError: `Location belongs to unmanaged catalog(s): ${decision.unmanagedCatalogIds.join(", ")}`,
      },
    });
    return updated;
  }

  try {
    for (const catalogId of decision.catalogsToRemove) {
      await updateCatalogContext(catalogId, {
        contextsToRemove: { companyLocationIds: [assignment.companyLocationId] },
      });
    }

    if (!catalogIds.includes(group.catalogId)) {
      await updateCatalogContext(group.catalogId, {
        contextsToAdd: { companyLocationIds: [assignment.companyLocationId] },
      });
    }

    const previousGroupId = assignment.pricingGroupId;
    const action =
      previousGroupId && previousGroupId !== pricingGroupId
        ? "GROUP_CHANGED"
        : "GROUP_ASSIGNED";

    const updated = await prisma.locationAssignment.update({
      where: { id: locationAssignmentId },
      data: {
        pricingGroupId,
        status: AssignmentStatus.ASSIGNED,
        lastError: null,
        assignedBy: actor,
        assignedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        actor,
        action,
        entityType: "LocationAssignment",
        entityId: locationAssignmentId,
        details: {
          before: previousGroupId,
          after: pricingGroupId,
          catalogId: group.catalogId,
        },
      },
    });

    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assignment failed";
    logError(`assignGroup failed for ${locationAssignmentId}`, error);
    return prisma.locationAssignment.update({
      where: { id: locationAssignmentId },
      data: {
        status: AssignmentStatus.FAILED,
        lastError: message,
      },
    });
  }
}

export async function removeGroup(
  locationAssignmentId: string,
  actor: string,
): Promise<LocationAssignment> {
  const assignment = await prisma.locationAssignment.findUniqueOrThrow({
    where: { id: locationAssignmentId },
    include: { pricingGroup: true },
  });

  const previousGroupId = assignment.pricingGroupId;
  const catalogId = assignment.pricingGroup?.catalogId ?? null;

  try {
    if (catalogId) {
      await updateCatalogContext(catalogId, {
        contextsToRemove: {
          companyLocationIds: [assignment.companyLocationId],
        },
      });
    }

    const updated = await prisma.locationAssignment.update({
      where: { id: locationAssignmentId },
      data: {
        pricingGroupId: null,
        status: AssignmentStatus.UNASSIGNED,
        lastError: null,
        assignedBy: actor,
        assignedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        actor,
        action: "GROUP_REMOVED",
        entityType: "LocationAssignment",
        entityId: locationAssignmentId,
        details: {
          before: previousGroupId,
          after: null,
          catalogId,
        },
      },
    });

    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remove group failed";
    logError(`removeGroup failed for ${locationAssignmentId}`, error);
    return prisma.locationAssignment.update({
      where: { id: locationAssignmentId },
      data: {
        status: AssignmentStatus.FAILED,
        lastError: message,
      },
    });
  }
}

export async function bulkAssign(
  locationAssignmentIds: string[],
  pricingGroupId: string,
  actor: string,
): Promise<{
  successCount: number;
  skippedCount: number;
  failedCount: number;
  conflictCount: number;
}> {
  const syncRun = await createSyncRun({
    type: SyncType.ASSIGNMENT,
    trigger: SyncTrigger.MANUAL,
    subjectType: "BulkAssign",
    subjectId: pricingGroupId,
    triggeredBy: actor,
  });

  const counts = {
    successCount: 0,
    skippedCount: 0,
    failedCount: 0,
    conflictCount: 0,
  };

  for (const id of locationAssignmentIds) {
    try {
      const result = await assignGroup(id, pricingGroupId, actor);
      if (result.status === AssignmentStatus.ASSIGNED) {
        counts.successCount += 1;
      } else if (result.status === AssignmentStatus.CONFLICT) {
        counts.conflictCount += 1;
        counts.skippedCount += 1;
      } else {
        counts.failedCount += 1;
      }
    } catch (error) {
      counts.failedCount += 1;
      logError(`bulkAssign failed for ${id}`, error);
    }
  }

  await finishSyncRun(
    syncRun.id,
    syncRunStatusFromCounts({
      successCount: counts.successCount,
      skippedCount: counts.skippedCount,
      failedCount: counts.failedCount,
    }),
    {
      successCount: counts.successCount,
      skippedCount: counts.skippedCount,
      failedCount: counts.failedCount,
      errorDetails: { conflictCount: counts.conflictCount },
    },
  );

  return counts;
}

export async function retryFailedAssignment(
  locationAssignmentId: string,
  actor: string,
): Promise<LocationAssignment> {
  const assignment = await prisma.locationAssignment.findUniqueOrThrow({
    where: { id: locationAssignmentId },
  });
  if (!assignment.pricingGroupId) {
    throw new Error("Cannot retry assignment without a pricing group");
  }
  return assignGroup(locationAssignmentId, assignment.pricingGroupId, actor);
}
