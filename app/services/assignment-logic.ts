export function evaluateAssignment(
  locationCatalogIds: string[],
  appManagedCatalogIds: Set<string>,
  targetCatalogId: string,
):
  | { outcome: "conflict"; unmanagedCatalogIds: string[] }
  | { outcome: "assign"; catalogsToRemove: string[] } {
  const unmanagedCatalogIds = locationCatalogIds.filter(
    (catalogId) => !appManagedCatalogIds.has(catalogId),
  );

  if (unmanagedCatalogIds.length > 0) {
    return { outcome: "conflict", unmanagedCatalogIds };
  }

  const catalogsToRemove = locationCatalogIds.filter(
    (catalogId) =>
      appManagedCatalogIds.has(catalogId) && catalogId !== targetCatalogId,
  );

  return { outcome: "assign", catalogsToRemove };
}
