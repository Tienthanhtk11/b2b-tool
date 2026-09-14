import { describe, expect, it } from "vitest";
import { evaluateAssignment } from "../app/services/assignment-logic";

describe("assignment conflict logic", () => {
  const appManaged = new Set([
    "gid://shopify/CompanyLocationCatalog/app-1",
    "gid://shopify/CompanyLocationCatalog/app-2",
  ]);
  const target = "gid://shopify/CompanyLocationCatalog/app-2";

  it("assigns when the location has no catalogs", () => {
    expect(evaluateAssignment([], appManaged, target)).toEqual({
      outcome: "assign",
      catalogsToRemove: [],
    });
  });

  it("removes another app-managed catalog before assigning", () => {
    expect(
      evaluateAssignment(
        ["gid://shopify/CompanyLocationCatalog/app-1"],
        appManaged,
        target,
      ),
    ).toEqual({
      outcome: "assign",
      catalogsToRemove: ["gid://shopify/CompanyLocationCatalog/app-1"],
    });
  });

  it("conflicts when an unmanaged catalog is present", () => {
    expect(
      evaluateAssignment(
        [
          "gid://shopify/CompanyLocationCatalog/app-1",
          "gid://shopify/CompanyLocationCatalog/foreign",
        ],
        appManaged,
        target,
      ),
    ).toEqual({
      outcome: "conflict",
      unmanagedCatalogIds: ["gid://shopify/CompanyLocationCatalog/foreign"],
    });
  });

  it("does not remove the target catalog itself", () => {
    expect(evaluateAssignment([target], appManaged, target)).toEqual({
      outcome: "assign",
      catalogsToRemove: [],
    });
  });
});
