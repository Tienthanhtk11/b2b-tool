export interface NetSuitePricingGroup {
  id: string;
  name: string;
  isActive: boolean;
  lastModified: string | null;
}

export interface NetSuiteGroupPrice {
  groupId: string;
  itemId: string;
  sku: string;
  price: string;
  currency: "CAD";
}

export interface NetSuiteItem {
  itemId: string;
  sku: string;
  basePrice: string | null;
  quantityAvailable: number | null;
  isActive: boolean;
}

export interface NetSuiteClient {
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  fetchPricingGroups(): Promise<NetSuitePricingGroup[]>;
  fetchGroupPrices(groupId: string): Promise<NetSuiteGroupPrice[]>;
  fetchItems(): Promise<NetSuiteItem[]>;
}
