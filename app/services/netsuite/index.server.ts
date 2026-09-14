import { MockNetSuiteClient } from "./mock-client.server";
import { SuiteTalkRestClient } from "./rest-client.server";
import type { NetSuiteClient } from "./types";

export type { NetSuiteClient, NetSuiteGroupPrice, NetSuiteItem, NetSuitePricingGroup } from "./types";

export function getNetSuiteMode(): "mock" | "rest" {
  return process.env.NETSUITE_MODE === "rest" ? "rest" : "mock";
}

export function getNetSuiteClient(): NetSuiteClient {
  if (getNetSuiteMode() === "rest") {
    return new SuiteTalkRestClient();
  }
  return new MockNetSuiteClient();
}
