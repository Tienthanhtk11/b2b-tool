# Scope of Work (Summary) — BMG B2B Product & Group Pricing Integration

> Short version for reporting. Full details: `docs/SCOPE_OF_WORK.md`  
> Platform: Shopify Plus (72hours.ca, b2b-site) + NetSuite

## 1. Problem

BMG currently manages data across disconnected systems: product content lives on **72hours.ca**, B2B group pricing lives in **NetSuite**, and B2B customers buy on **b2b-site**. Manual operations require copying products between stores, re-entering price lists, and configuring each customer — this is slow, error-prone (wrong price/SKU), and has no audit trail.

**B2B Tool** is a Shopify custom app (installed on both stores in the same Plus organization) that automates this process:

```text
72hours.ca ── product content ──▶ B2B Tool ──▶ b2b-site
NetSuite ──── group pricing ───▶ B2B Tool ──▶ Shopify B2B Catalog/Price List
Admin ─────── assign customers to a pricing group ──▶ correct prices after login
```

## 2. Objectives

1. Automatically sync product information from 72hours.ca to b2b-site.
2. Sync pricing groups and SKU-level prices from NetSuite into Shopify B2B Catalog/Price List.
3. Allow admins to assign B2B customers (by Company Location) to the correct pricing group.
4. Ensure logged-in B2B customers see the correct group prices on the product page, cart, and checkout.

## 3. Scope of work

| # | Workstream | What is included |
|---|---|---|
| 1 | **Product Sync** | Auto-sync title, SKU, description, images, SEO, and tags from 72hours.ca to b2b-site on change (webhook). Price and inventory are out of scope. |
| 2 | **Product Mapping UI** | Screen to link products between the two stores: SKU auto-suggest, manual confirm, change preview, sync/retry. |
| 3 | **NetSuite Pricing Sync** | Read pricing groups and SKU prices from NetSuite and upsert them into Shopify Price Lists. One group can be shared by many customers. |
| 4 | **Pricing Sync UI** | Manage group ↔ Catalog/Price List mapping, preview price changes, flag SKU errors, and view sync history. |
| 5 | **Customer Assignment UI** | Search customers/companies, assign them to a pricing group, bulk assign, and view change history. |
| 6 | **Dashboard** | Connection status for all 3 systems, mapped/unmapped/error counts, and a list of issues to resolve. |

**Source of truth:** 72hours.ca (product content) — NetSuite (B2B pricing) — b2b-site (customers).

## 4. Out of MVP scope

- Inventory, order, or customer sync to/from NetSuite.
- Promotions, discounts, volume pricing, tax rules, or payment terms.
- Per-customer prices outside a pricing group (if needed, create a dedicated group in NetSuite).
- Auto-deleting products or auto-fixing duplicate SKUs.

## 5. Deliverables

- Shopify embedded admin app (custom distribution, installed on both stores in the same Plus organization).
- Two sync services (product sync, pricing sync) with queue/retry and audit log.
- Operations UIs: mapping, pricing, customer assignment, dashboard.
- Dev/staging/production environments, operations docs, and tests for the main flows.

## 6. Key acceptance criteria

- Product changes on 72hours.ca automatically update the correctly mapped product on b2b-site.
- NetSuite prices are written correctly to Shopify Price Lists; repeated syncs do not create duplicates.
- Logged-in B2B customers see the correct group price; unassigned customers do not see another group's prices.
- Admins can review sync history, errors, and who performed each action.

## 7. Dependencies from BMG

- Confirm that 72hours.ca and b2b-site belong to **the same Shopify Plus organization**.
- Access to both stores and NetSuite sandbox/production APIs.
- Official pricing group list and the initial set of customers to assign.
- Unique, consistent SKU convention across all three systems.
- A business owner to confirm mappings and test data.

## 8. Timeline & cost notes

Timeline and cost will be estimated after the remaining decisions are closed (see section 8 of the full SOW). The most important ones:

1. May the app create new products on b2b-site when no mapping exists?
2. Required pricing sync latency (near real-time, every 15 minutes, hourly, or on demand)?
3. How NetSuite exposes pricing group data (standard record, saved search, or custom record)?
4. Initial data volume (SKU count, group count, customer count) and the initial sync plan.
