# SPEC — B2B Tool Technical Design

> Tài liệu thiết kế kỹ thuật, bổ sung cho `docs/SCOPE_OF_WORK.md`.
> Các quyết định mục 8 SOW đã được chốt ngày 2026-09-14 (xem mục 2 bên dưới).
> Thiết kế Product Sync (đã implement): `docs/PRODUCT_SYNC_DESIGN.md`.

## 1. Kiến trúc tổng thể

```text
┌──────────────┐  products/update webhook   ┌─────────────────────────────┐
│  72hours.ca  │ ─────────────────────────▶ │          B2B Tool           │
│ (source shop)│ ◀──── Admin GraphQL ────── │  Remix + Prisma + Postgres  │
└──────────────┘                            │                             │
                                            │  services/                  │
┌──────────────┐   SuiteTalk REST /         │   product-sync   (đã có)    │
│   NetSuite   │ ◀─── mock fixtures ─────── │   netsuite       (mới)      │
└──────────────┘                            │   pricing-sync   (mới)      │
                                            │   item-sync      (mới)      │
┌──────────────┐                            │   assignment     (mới)      │
│   b2b-site   │ ◀──── Admin GraphQL ────── │   scheduler      (mới)      │
│ (target shop)│   (product, variant price, └─────────────────────────────┘
└──────────────┘    inventory, catalog, price list, company location)
```

- App được cài trên **cả hai store** (cùng Shopify Plus organization). Session offline của mỗi store lưu trong bảng `Session`; lấy admin client qua `unauthenticated.admin(shop)` (`app/services/shops.server.ts`).
- Env: `SOURCE_SHOP_DOMAIN` (72hours.ca), `TARGET_SHOP_DOMAIN` (b2b-site).
- DB: PostgreSQL (docker-compose, host port 5433).

## 2. Các quyết định đã chốt (2026-09-14)

| # | Quyết định | Giá trị chốt |
|---|---|---|
| 1 | NetSuite integration | Adapter interface + 2 implementation: SuiteTalk REST và Mock (fixtures/CSV). Chọn qua env `NETSUITE_MODE=mock\|rest`. Dev/test chạy mock, production điền credentials là chạy. |
| 2 | Price & inventory sync | **CÓ trong scope** (theo SOW Summary): sync giá base + tồn kho từ NetSuite vào variant/location trên b2b-site. |
| 3 | Tự tạo product trên b2b-site | **KHÔNG**. Chỉ sync product đã mapping. |
| 4 | Tần suất pricing/item sync tự động | **Mỗi 15 phút** + nút Sync now thủ công. |
| 5 | Currency | **Một currency duy nhất: CAD** cho toàn bộ b2b-site. |
| 6 | SKU bị xóa khỏi group trong NetSuite | **Giữ lại** fixed price trên Shopify, đánh dấu `ORPHANED` và cảnh báo trong UI để admin xử lý thủ công. |

## 3. NetSuite adapter (`app/services/netsuite/`)

### 3.1 Interface

```ts
// netsuite/types.ts
export interface NetSuitePricingGroup {
  id: string;          // internal id trong NetSuite
  name: string;
  isActive: boolean;
  lastModified: string | null; // ISO
}

export interface NetSuiteGroupPrice {
  groupId: string;
  itemId: string;      // NetSuite item internal id
  sku: string;
  price: string;       // decimal string, CAD
  currency: "CAD";
}

export interface NetSuiteItem {
  itemId: string;
  sku: string;
  basePrice: string | null;   // giá bán lẻ/base (decimal string)
  quantityAvailable: number | null;
  isActive: boolean;
}

export interface NetSuiteClient {
  testConnection(): Promise<{ ok: boolean; message?: string }>;
  fetchPricingGroups(): Promise<NetSuitePricingGroup[]>;
  fetchGroupPrices(groupId: string): Promise<NetSuiteGroupPrice[]>;
  fetchItems(): Promise<NetSuiteItem[]>; // base price + inventory
}
```

### 3.2 Implementations

- **`MockNetSuiteClient`** (`netsuite/mock-client.server.ts`): đọc JSON fixtures từ `netsuite-fixtures/` (pricing-groups.json, group-prices.json, items.json). Repo phải kèm bộ fixtures mẫu đủ để demo mọi trạng thái (SKU hợp lệ, missing SKU, duplicate SKU, invalid price).
- **`SuiteTalkRestClient`** (`netsuite/rest-client.server.ts`): SuiteTalk REST Web Services, auth **OAuth 1.0a TBA** (consumer key/secret + token id/secret, realm = account id). Env: `NETSUITE_ACCOUNT_ID`, `NETSUITE_CONSUMER_KEY`, `NETSUITE_CONSUMER_SECRET`, `NETSUITE_TOKEN_ID`, `NETSUITE_TOKEN_SECRET`. Dùng SuiteQL (`POST /services/rest/query/v1/suiteql`) để đọc pricing groups (`pricinggroup`), item prices theo group (`itemprice`/`pricing`) và item + inventory. Query cụ thể có thể cần chỉnh khi có sandbox — cô lập toàn bộ SuiteQL trong file này.
- Factory `getNetSuiteClient()` chọn theo `NETSUITE_MODE` (default `mock`).

### 3.3 CSV import (bổ trợ)

UI cho phép upload CSV giá theo group (cột: `group_id,group_name,sku,price`) và CSV item (`sku,base_price,quantity`) — parse và ghi vào cùng bảng như sync bình thường, đánh dấu trigger `MANUAL`.

## 4. Group Pricing Sync (`app/services/pricing-sync.server.ts`)

### 4.1 Luồng import từ NetSuite

1. `importPricingGroups()`: fetch groups → upsert `PricingGroup` (không xóa group đã biến mất khỏi NetSuite; đánh dấu cảnh báo).
2. `importGroupPrices(pricingGroupId)`: fetch prices → upsert `GroupPrice` theo `(pricingGroupId, sku)`:
   - Giá ≤ 0 hoặc không parse được → `status=SKIPPED`, `statusReason=INVALID_PRICE`.
   - SKU không còn trong dữ liệu NetSuite mới → giữ nguyên row, set `statusReason=ORPHANED` (quyết định #6), không xóa giá trên Shopify.
3. Resolve variant: tìm variant trên b2b-site theo SKU (`productVariants(query: "sku:...")`).
   - 0 kết quả → `SKIPPED / MISSING_SKU`; ≥2 → `SKIPPED / DUPLICATE_SKU`.

### 4.2 Đẩy sang Shopify (b2b-site)

- Mỗi `PricingGroup` map 1-1 với một **Catalog** (`catalogCreate`, type company location catalog) + một **Price List** (`priceListCreate` gắn catalog, currency CAD, `parent: { adjustment: { type: PERCENTAGE_DECREASE, value: 0 } }` nếu API yêu cầu parent) + **Publication**: catalog cần publication chứa các product được bán — dùng `publicationCreate` với `autoPublish: true` (toàn bộ product) cho MVP.
- Upsert giá: `priceListFixedPricesAdd` (batch ≤ 250 dòng/call) — mutation này add-or-update theo variant nên retry an toàn, không tạo trùng.
- App chỉ quản lý catalog/price list do chính app tạo (lưu `catalogId`/`priceListId` trong `PricingGroup`). Cho phép "link" một catalog/price list có sẵn thay vì tạo mới.
- Không cho 2 group trỏ cùng một `priceListId` (unique constraint mức app).
- **Lưu ý**: tên mutation/field phải validate bằng Shopify MCP (`validate_graphql_codeblocks`) trước khi hoàn thiện.

### 4.3 Trạng thái group

`UNMAPPED` (chưa có catalog/price list) → `READY` → `SYNCING` → `SYNCED` / `PARTIAL` (có row skip/fail) / `FAILED`. Mỗi lần sync tạo `SyncRun` (type `PRICING_SYNC`) với counts + errorDetails.

## 5. Item Price & Inventory Sync (`app/services/item-sync.server.ts`)

Workstream mới theo quyết định #2. Model mới:

```prisma
enum ItemRowStatus { PENDING SYNCED SKIPPED FAILED }

model NetSuiteItemState {
  id                String        @id @default(cuid())
  sku               String        @unique
  netsuiteItemId    String?
  basePrice         Decimal?      @db.Decimal(12, 2)
  quantityAvailable Int?
  variantId         String?       // gid b2b-site
  inventoryItemId   String?       // gid b2b-site
  priceStatus       ItemRowStatus @default(PENDING)
  inventoryStatus   ItemRowStatus @default(PENDING)
  statusReason      String?
  lastSyncedAt      DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  @@index([priceStatus])
  @@index([inventoryStatus])
}

model AppSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

- `importItems()`: fetch từ NetSuite client → upsert theo SKU.
- `syncItemPrices()`: resolve variant theo SKU (cùng quy tắc missing/duplicate) → `productVariantsBulkUpdate` cập nhật `price` (giá guest/base trên b2b-site).
- `syncInventory()`: cần **location** trên b2b-site — lưu `b2b_location_id` trong `AppSetting`, UI Settings cho chọn location (query `locations(first: 20)`). Dùng `inventorySetQuantities` (name `available`, `ignoreCompareQuantity: true`) theo batch.
- Product Sync (content) **không được** đụng vào price/inventory — đã đúng ở code hiện tại, giữ nguyên.

## 6. Customer Group Assignment (`app/services/assignment.server.ts`)

- `importCompanyLocations()`: query `companies` + `companyLocations` từ b2b-site (bao gồm main contact email) → upsert `LocationAssignment` (status mặc định `UNASSIGNED`).
- `assignGroup(locationId, pricingGroupId, actor)`:
  1. Group phải có `catalogId` (đã mapped) — nếu chưa thì báo lỗi.
  2. Nếu location đang thuộc catalog của group khác **do app quản lý** → tháo trước (`catalogContextUpdate` với `contextsToRemove`), rồi gán mới (`contextsToAdd`).
  3. Catalog không do app quản lý: **không đụng**; nếu phát hiện location nằm trong ≥1 catalog pricing lạ → set `status=CONFLICT`, dừng, yêu cầu admin xử lý.
  4. Ghi `AuditLog` (action `GROUP_ASSIGNED` / `GROUP_CHANGED` / `GROUP_REMOVED`) với actor + before/after.
- `removeGroup`, `bulkAssign(locationIds[], groupId)` (chạy tuần tự, gom kết quả), retry cho row `FAILED`.

## 7. Scheduler (`app/services/scheduler.server.ts`)

- `node-cron` (thêm dependency), khởi tạo 1 lần trong `entry.server.tsx` (guard bằng global singleton, chỉ chạy khi `process.env.ENABLE_SCHEDULER === "true"`).
- Job mỗi **15 phút**: `importPricingGroups` → `importGroupPrices` + sync các group `READY|SYNCED|PARTIAL`; `importItems` → `syncItemPrices` + `syncInventory`.
- Khóa chống chạy chồng: dùng advisory lock qua bảng (`SyncRun` đang `RUNNING` cùng type thì skip).
- Trigger ghi `SCHEDULED`.

## 8. UI routes (Polaris v12, embedded)

| Route | Nội dung |
|---|---|
| `app._index.tsx` | Dashboard (đã có, mở rộng): trạng thái kết nối 3 hệ thống (source/target session tồn tại, `netsuiteClient.testConnection`), counters product/pricing/assignment, danh sách lỗi, quick actions. |
| `app.mappings.tsx`, `app.mappings.$id.tsx` | Đã có (Product Mapping UI). |
| `app.pricing.tsx` | Pricing group list: tên, NetSuite ID, catalog/price list, SKU count, last synced, status badge. Actions: Import from NetSuite, Sync all, Upload CSV. |
| `app.pricing.$id.tsx` | Group detail: bảng SKU/giá NetSuite vs giá hiện tại Shopify, preview add/change/skip, warnings (MISSING_SKU, DUPLICATE_SKU, INVALID_PRICE, ORPHANED), filter theo status, Sync group, Retry failed rows, Catalog mapping (tạo mới hoặc link có sẵn, đổi mapping có confirm). |
| `app.items.tsx` | Item price & inventory: bảng SKU, base price, quantity, variant match, status; Sync prices, Sync inventory, Upload CSV; chọn Shopify location (Settings). |
| `app.customers.tsx` | Assignment list: company/location/contact/email, group hiện tại, status; search + filter unassigned; assign/change/remove; bulk assign; link lịch sử. |
| `app.history.tsx` | Sync history: bảng `SyncRun` (type, trigger, counts, thời gian, người chạy, errorDetails) + `AuditLog`. |
| `app.settings.tsx` | NetSuite mode + connection test, b2b location chọn cho inventory, ENABLE_SCHEDULER hint. |

Điều hướng: thêm links vào `app.tsx` NavMenu.

## 9. Scopes & webhooks

Scopes cần trong `shopify.app.toml` (cập nhật):

```text
read_products,write_products,read_companies,write_companies,
write_price_lists,read_price_lists,read_publications,write_publications,
write_catalogs,read_catalogs,read_inventory,write_inventory,read_locations
```

Webhooks giữ nguyên (`products/update` từ source shop; handler đã lọc theo shop).

## 10. Testing

- **Vitest** (thêm dev dependency + `npm test`).
- Unit tests cho: content hash + stale-event logic (product-sync), SKU resolve rules (missing/duplicate), pricing upsert idempotency (mock admin client), assignment conflict logic, mock NetSuite client.
- Mock admin GraphQL client bằng stub trả fixture; không gọi Shopify thật trong test.

## 11. Env vars (tổng hợp)

```bash
DATABASE_URL=postgresql://b2b:b2b_dev_password@localhost:5433/b2b_tool
SHOPIFY_API_KEY=...            # từ Partner app (user cung cấp sau)
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=...
SCOPES=<như mục 9>
SOURCE_SHOP_DOMAIN=72hours-ca.myshopify.com   # placeholder
TARGET_SHOP_DOMAIN=b2b-site.myshopify.com     # placeholder
NETSUITE_MODE=mock             # mock | rest
NETSUITE_ACCOUNT_ID=
NETSUITE_CONSUMER_KEY=
NETSUITE_CONSUMER_SECRET=
NETSUITE_TOKEN_ID=
NETSUITE_TOKEN_SECRET=
ENABLE_SCHEDULER=false         # true ở production
```

Kèm file `.env.example` trong repo.
