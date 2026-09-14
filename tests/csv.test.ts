import { describe, expect, it } from "vitest";
import { parseCsv, parseItemsCsv, parsePricingCsv } from "../app/services/csv";

describe("CSV parser", () => {
  it("parses quoted commas and escaped quotes", () => {
    const rows = parseCsv('a,"b,c","d ""e"" f"\n1,2,3\n');
    expect(rows).toEqual([
      ["a", "b,c", 'd "e" f'],
      ["1", "2", "3"],
    ]);
  });

  it("parses pricing CSV in the spec format", () => {
    const csv = [
      "group_id,group_name,sku,price",
      "101,Wholesale A,BMG-1001,29.99",
      '102,"Wholesale, B",BMG-1002,"45.00"',
    ].join("\n");
    expect(parsePricingCsv(csv)).toEqual([
      {
        groupId: "101",
        groupName: "Wholesale A",
        sku: "BMG-1001",
        price: "29.99",
      },
      {
        groupId: "102",
        groupName: "Wholesale, B",
        sku: "BMG-1002",
        price: "45.00",
      },
    ]);
  });

  it("parses item CSV in the spec format", () => {
    const csv = "sku,base_price,quantity\nBMG-1001,39.99,12\n";
    expect(parseItemsCsv(csv)).toEqual([
      { sku: "BMG-1001", basePrice: "39.99", quantity: "12" },
    ]);
  });

  it("rejects pricing CSV missing required columns", () => {
    expect(() => parsePricingCsv("sku,price\nA,1")).toThrow(/group_id/);
  });
});
