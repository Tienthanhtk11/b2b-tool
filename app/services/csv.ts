export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushCell = () => {
    row.push(current);
    current = "";
  };

  const pushRow = () => {
    pushCell();
    const isEmpty = row.every((cell) => cell.trim() === "");
    if (!isEmpty) {
      rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      pushCell();
      continue;
    }

    if (char === "\n") {
      pushRow();
      continue;
    }

    if (char === "\r") {
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  for (const name of names) {
    const index = normalized.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

export interface PricingCsvRow {
  groupId: string;
  groupName: string;
  sku: string;
  price: string;
}

export interface ItemCsvRow {
  sku: string;
  basePrice: string;
  quantity: string;
}

export function parsePricingCsv(text: string): PricingCsvRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const headers = rows[0]!;
  const groupIdIndex = headerIndex(headers, "group_id", "groupid", "id");
  const groupNameIndex = headerIndex(headers, "group_name", "groupname", "name");
  const skuIndex = headerIndex(headers, "sku");
  const priceIndex = headerIndex(headers, "price");

  if (groupIdIndex < 0 || skuIndex < 0 || priceIndex < 0) {
    throw new Error("Pricing CSV must include group_id, sku, and price columns");
  }

  return rows.slice(1).map((row) => ({
    groupId: (row[groupIdIndex] ?? "").trim(),
    groupName: (row[groupNameIndex] ?? "").trim(),
    sku: (row[skuIndex] ?? "").trim(),
    price: (row[priceIndex] ?? "").trim(),
  }));
}

export function parseItemsCsv(text: string): ItemCsvRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const headers = rows[0]!;
  const skuIndex = headerIndex(headers, "sku");
  const priceIndex = headerIndex(headers, "base_price", "baseprice", "price");
  const quantityIndex = headerIndex(headers, "quantity", "qty", "quantity_available");

  if (skuIndex < 0 || priceIndex < 0 || quantityIndex < 0) {
    throw new Error("Item CSV must include sku, base_price, and quantity columns");
  }

  return rows.slice(1).map((row) => ({
    sku: (row[skuIndex] ?? "").trim(),
    basePrice: (row[priceIndex] ?? "").trim(),
    quantity: (row[quantityIndex] ?? "").trim(),
  }));
}
