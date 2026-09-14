# Scope of Work (Summary) — BMG B2B Product & Group Pricing Integration

> Short version for reporting. Full details: `docs/SCOPE_OF_WORK.md`  
> Platform: Shopify Plus (72hours.ca, b2b-site) + NetSuite

## 1. Problem

BMG currently manages data across disconnected systems: product content lives on **72hours.ca**, B2B group pricing, product prices, and inventory live in **NetSuite**, and B2B customers buy on **b2b-site**. Manual operations require copying products between stores, re-entering prices and stock, and configuring each customer — this is slow, error-prone (wrong price/SKU/stock), and has no audit trail.

**B2B Tool** is a Shopify custom app (installed on both stores in the same Plus organization) that automates this process:

```text
72hours.ca ── product content ──────────▶ B2B Tool ──▶ b2b-site
NetSuite ──── product price + inventory ─▶ B2B Tool ──▶ b2b-site (variant price + stock)
NetSuite ──── group pricing ─────────────▶ B2B Tool ──▶ Shopify B2B Catalog/Price List
Admin ─────── assign customers to a pricing group ──▶ correct prices after login
```

## 2. Objectives

1. Automatically sync product information from 72hours.ca to b2b-site.
2. Sync product price and inventory from NetSuite to Shopify (b2b-site).
3. Sync pricing groups and SKU-level group prices from NetSuite into Shopify B2B Catalog/Price List.
4. Allow admins to assign B2B customers (by Company Location) to the correct pricing group.
5. Ensure logged-in B2B customers see the correct group prices on the product page, cart, and checkout.

## 3. Scope of work

| # | Workstream | What is included |
|---|---|---|
| 1 | **Product Sync** | Auto-sync title, SKU, description, images, SEO, and tags from 72hours.ca to b2b-site on change (webhook). Product price and inventory are **not** copied from 72hours.ca. |
| 2 | **Product Mapping UI** | Screen to link products between the two stores: SKU auto-suggest, manual confirm, change preview, sync/retry. |
| 3 | **NetSuite Price & Inventory Sync** | Read SKU-level list/base price and available quantity from NetSuite and upsert them to Shopify variant price and inventory on b2b-site. |
| 4 | **NetSuite Group Pricing Sync** | Read pricing groups and SKU prices from NetSuite and upsert them into Shopify Price Lists. One group can be shared by many customers. |
| 5 | **Pricing Sync UI** | Manage group ↔ Catalog/Price List mapping, preview price/inventory changes, flag SKU errors, and view sync history. |
| 6 | **Customer Assignment UI** | Search customers/companies, assign them to a pricing group, bulk assign, and view change history. |
| 7 | **Dashboard** | Connection status for all 3 systems, mapped/unmapped/error counts, and a list of issues to resolve. |

**Source of truth:** 72hours.ca (product content) — NetSuite (product price, inventory, and B2B group pricing) — b2b-site (customers).

## 4. Out of MVP scope

- Order or customer sync to/from NetSuite.
- Promotions, discounts, volume pricing, tax rules, or payment terms.
- Per-customer prices outside a pricing group (if needed, create a dedicated group in NetSuite).
- Auto-deleting products or auto-fixing duplicate SKUs.

## 5. Deliverables

- Shopify embedded admin app (custom distribution, installed on both stores in the same Plus organization).
- Three sync services (product content, NetSuite price & inventory, group pricing) with queue/retry and audit log.
- Operations UIs: mapping, pricing, customer assignment, dashboard.
- Dev/staging/production environments, operations docs, and tests for the main flows.

## 6. Key acceptance criteria

- Product content changes on 72hours.ca automatically update the correctly mapped product on b2b-site (without overwriting NetSuite-managed price or inventory).
- NetSuite product prices and inventory are written correctly to Shopify variants/locations on b2b-site.
- NetSuite group prices are written correctly to Shopify Price Lists; repeated syncs do not create duplicates.
- Logged-in B2B customers see the correct group price; unassigned customers see the NetSuite-synced base price, not another group's prices.
- Admins can review sync history, errors, and who performed each action.

## 7. Dependencies from BMG

- Confirm that 72hours.ca and b2b-site belong to **the same Shopify Plus organization**.
- Access to both stores and NetSuite sandbox/production APIs.
- Official pricing group list and the initial set of customers to assign.
- Unique, consistent SKU convention across all three systems.
- NetSuite fields for list/base price and available quantity, plus Shopify location mapping for inventory.
- A business owner to confirm mappings and test data.

## 8. Timeline & cost notes

Timeline and cost will be estimated after the remaining decisions are closed (see section 8 of the full SOW). The most important ones:

1. May the app create new products on b2b-site when no mapping exists?
2. Required pricing and inventory sync latency (near real-time, every 15 minutes, hourly, or on demand)?
3. How NetSuite exposes pricing group, item price, and inventory data (standard record, saved search, or custom record)?
4. Which Shopify location(s) receive NetSuite inventory, and which NetSuite price level is the Shopify variant (guest/base) price?
5. Initial data volume (SKU count, group count, customer count) and the initial sync plan.
