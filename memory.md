# B2B Tool — Memory / Context Log

> File này được cập nhật ở mỗi bước để giữ context giữa các phiên làm việc (local → VM Google).
> Đọc file này ĐẦU TIÊN khi mở phiên mới.

## Tổng quan dự án

- **Dự án:** BMG B2B Product & Group Pricing Integration (Shopify Plus + NetSuite).
- **Stack:** Remix (v2, vite) + Prisma + PostgreSQL (docker-compose, port 5433) + Shopify App Remix v4 + Polaris v12. Node >= 20.19.
- **3 hệ thống:** `72hours.ca` (nguồn product content) → B2B Tool → `b2b-site` (kênh bán B2B); NetSuite (nguồn group pricing).
- **Tài liệu scope:** `docs/SCOPE_OF_WORK.md` (chi tiết, tiếng Việt) và `docs/SCOPE_OF_WORK_SUMMARY.md` (tóm tắt, tiếng Anh).
- **Lưu ý:** 2 file SOW có mâu thuẫn — bản Summary có thêm workstream "NetSuite Price & Inventory Sync" (variant base price + inventory), bản đầy đủ ghi inventory là ngoài scope. Đang chờ chủ dự án chốt.

## Trạng thái hạ tầng / môi trường

- Docker Desktop: **chưa bật** trong phiên coding 2026-09-14 — postgres chưa chạy, migration `pricing_item_sync` **chưa apply** lên DB thật. File SQL đã viết tay: `prisma/migrations/20260914100000_pricing_item_sync/migration.sql`. Prisma schema đã `validate` + `generate`.
- Chưa connect Shopify Partner app (client_id trong `shopify.app.toml` đang rỗng) — user sẽ hỗ trợ sau khi coding xong.
- Chưa có NetSuite credentials. Dev mặc định `NETSUITE_MODE=mock` + fixtures trong `netsuite-fixtures/`.
- Kế hoạch: coding xong → connect Shopify Partner + push GitHub → deploy trên VM Google (phiên mới).
- Khi Docker sẵn sàng: `docker compose up -d postgres` rồi `DATABASE_URL="postgresql://b2b:b2b_dev_password@localhost:5433/b2b_tool" npx prisma migrate deploy`.

## Hiện trạng code (cập nhật 2026-09-14 sau 4 phase)

### Đã có
- Product sync (giữ nguyên hành vi): `app/services/product-sync.server.ts` + mapping UI. Helper GraphQL dùng chung đã extract sang `app/services/admin-graphql.server.ts`.
- Schema: thêm `ItemRowStatus`, `NetSuiteItemState`, `AppSetting`, `SyncType.ITEM_SYNC`, unique `PricingGroup.priceListId`.
- NetSuite adapter: mock (fixtures) + SuiteTalk REST OAuth 1.0a TBA (HMAC-SHA256, không thêm lib oauth). Factory `getNetSuiteClient()`.
- Pricing sync, item price/inventory sync, company location assignment, scheduler 15 phút.
- UI: dashboard, pricing, items, customers, history, settings + NavMenu.
- Vitest: SKU resolve, assignment conflict, CSV parser, mock NetSuite, pricing upsert idempotency.
- Scopes trong `shopify.app.toml` theo spec mục 9, **cộng `read_customers`** (cần để đọc email contact B2B). `.env.example` có trong repo (`!.env.example` trong `.gitignore`).

### Việc user cần làm tiếp
1. Bật Docker Desktop và apply migration.
2. Điền Shopify Partner `client_id` / API key/secret, cài app lên 2 store.
3. Điền NetSuite TBA credentials và chuyển `NETSUITE_MODE=rest` khi sandbox sẵn sàng — SuiteQL trong `rest-client.server.ts` có thể cần chỉnh theo record thật.
4. Chọn Shopify location trên Settings trước khi sync inventory.
5. `ENABLE_SCHEDULER=true` khi chạy production.
6. Push GitHub (user tự làm, chưa commit trong phiên này).

## Các quyết định đã chốt (user xác nhận 2026-09-14)

1. **NetSuite:** adapter interface + 2 impl (SuiteTalk REST và Mock fixtures/CSV), chọn qua `NETSUITE_MODE=mock|rest`. Dev chạy mock, có credentials chỉ điền env.
2. **Price & inventory sync: CÓ trong scope** — sync giá base + tồn kho từ NetSuite vào variant/location b2b-site (theo SOW Summary).
3. **Không tự tạo product** trên b2b-site khi không có mapping.
4. **Sync tự động mỗi 15 phút** + Sync now thủ công.
5. **Một currency duy nhất: CAD.**
6. **SKU bị xóa khỏi group NetSuite:** giữ fixed price trên Shopify, đánh dấu ORPHANED + cảnh báo UI.

Chi tiết thiết kế: `docs/SPEC.md` (mới viết). Product sync đã implement: `docs/PRODUCT_SYNC_DESIGN.md`.

## Implementation plan

- **Phase 1 — Nền tảng:** schema mới (`NetSuiteItemState`, `AppSetting` + enum) + migration; NetSuite adapter (types, mock client + fixtures mẫu, SuiteTalk REST client, factory); cập nhật scopes trong `shopify.app.toml`; `.env.example`.
- **Phase 2 — Services:** `pricing-sync.server.ts` (import groups/prices, resolve SKU, catalog/price list create-or-link, upsert fixed prices, ORPHANED handling); `item-sync.server.ts` (import items, sync variant price, sync inventory theo location trong AppSetting); `assignment.server.ts` (import company locations, assign/change/remove/bulk, conflict detection, audit); `scheduler.server.ts` (node-cron 15 phút, guard singleton + ENABLE_SCHEDULER, chống chạy chồng).
- **Phase 3 — UI:** `app.pricing.tsx`, `app.pricing.$id.tsx`, `app.items.tsx`, `app.customers.tsx`, `app.history.tsx`, `app.settings.tsx`; mở rộng dashboard `app._index.tsx`; NavMenu trong `app.tsx`; CSV upload cho pricing + items.
- **Phase 4 — Chất lượng:** Vitest + unit tests (hash/stale logic, SKU resolve, idempotency, assignment conflict, mock NetSuite); `npm run build` + lint pass; validate GraphQL bằng Shopify MCP.

## Log verify

- `npx prisma validate` — pass
- `npx prisma generate` — pass
- `npx prisma migrate dev` — **chưa chạy** (Docker Desktop không available)
- `npm test` — pass (5 files / 17 tests)
- `npx tsc --noEmit` — pass
- `npm run lint` — pass
- `npm run build` — pass (cảnh báo CSS minify Polaris `@media print`, có sẵn từ template)
- GraphQL Admin đã validate qua Shopify MCP (`catalogCreate`, `publicationCreate`, `priceListCreate`, `priceListFixedPricesAdd`, `catalogContextUpdate`, `productVariantsBulkUpdate`, `inventorySetQuantities`, companyLocations, locations, catalogs)

## Log các bước

### 2026-09-14 — Bước 1: Đánh giá tài liệu & hiện trạng
- Đọc SOW + SOW summary + toàn bộ code hiện có.
- Kết luận: tài liệu scope tốt nhưng CHƯA đủ để coding hết — thiếu design docs, thiếu quyết định mục 8 SOW (NetSuite format, latency, currency, delete-price behavior, auto-create product), và 2 bản SOW mâu thuẫn về price/inventory sync.
- Đã gửi câu hỏi cho user để chốt 6 quyết định — user đã trả lời (xem "Các quyết định đã chốt").

### 2026-09-14 — Bước 2: Bổ sung tài liệu thiết kế + plan
- Viết `docs/SPEC.md` (thiết kế kỹ thuật đầy đủ: NetSuite adapter, pricing sync, item sync, assignment, scheduler, UI routes, scopes, tests, env vars).
- Viết `docs/PRODUCT_SYNC_DESIGN.md` (mô tả luồng product sync đã implement).
- Tạo implementation plan 4 phase (xem trên). Launch coding subagent model cursor-grok-4.6-high-fast để thực hiện.

### 2026-09-14 — Phase 1: Nền tảng
- Schema: `ItemRowStatus`, `NetSuiteItemState`, `AppSetting`, `SyncType.ITEM_SYNC`, unique `PricingGroup.priceListId`.
- Migration thủ công: `prisma/migrations/20260914100000_pricing_item_sync/migration.sql` (chưa apply DB).
- NetSuite adapter: `app/services/netsuite/{types.ts,mock-client.server.ts,rest-client.server.ts,index.server.ts}`.
- Fixtures: `netsuite-fixtures/{pricing-groups,group-prices,items}.json` (3 groups, SKU valid/missing/duplicate/invalid).
- `shopify.app.toml` scopes + `.env.example`. Tồn đọng: Docker down nên chưa migrate.

### 2026-09-14 — Phase 2: Services
- Extract `adminGraphql` → `app/services/admin-graphql.server.ts` (product-sync import lại, hành vi giữ nguyên).
- `pricing-sync.server.ts`, `item-sync.server.ts`, `assignment.server.ts`, `scheduler.server.ts`, CSV parser, SKU resolve, settings.
- Scheduler init trong `app/entry.server.tsx`, `node-cron` + `@types/node-cron`.
- Tồn đọng: SuiteQL cần chỉnh khi có sandbox NetSuite; inventory cần `b2b_location_id`.

### 2026-09-14 — Phase 3: UI
- Routes: `app.pricing.tsx`, `app.pricing.$id.tsx`, `app.items.tsx`, `app.customers.tsx`, `app.history.tsx`, `app.settings.tsx`.
- Dashboard mở rộng (connection test NetSuite, item sync, assignment, errors, quick actions). NavMenu đủ links.
- CSV upload multipart FormData.

### 2026-09-14 — Phase 4: Chất lượng
- Vitest + tests trong `tests/`. Build/lint/tsc/test pass. GraphQL validated via Shopify MCP Admin API 2026-07.

### 2026-09-14 — Bước cuối: Verify độc lập (agent chính)
- Chạy lại toàn bộ: `npm test` (17/17 pass), `npx tsc --noEmit` pass, `npm run lint` pass, `npm run build` pass.
- **CHƯA làm được vì Docker Desktop chưa bật:** apply migration. Khi mở phiên mới, chạy:
  `docker compose up -d postgres` rồi `DATABASE_URL="postgresql://b2b:b2b_dev_password@localhost:5433/b2b_tool" npx prisma migrate deploy`.
- **Việc tiếp theo (chờ user):** (1) ~~bật Docker + migrate~~ (XONG — xem bước 2026-09-14 tối); (2) connect Shopify Partner app (điền client_id, API key/secret, cài app lên 2 store — lưu ý app xin thêm scope `read_customers`); (3) push GitHub; (4) phiên mới: deploy VM Google; (5) khi có NetSuite sandbox → `NETSUITE_MODE=rest` + điền TBA credentials + chỉnh SuiteQL trong `rest-client.server.ts` nếu record khác; (6) vào Settings chọn location b2b-site cho inventory sync; (7) production bật `ENABLE_SCHEDULER=true`.

### 2026-09-14 (tối) — Test với Docker + DB thật
- Docker Desktop đã bật. `docker compose up -d postgres` OK (container `b2b-tool-postgres`, port 5433).
- `npx prisma migrate deploy` — migration viết tay `20260914100000_pricing_item_sync` apply thành công.
- `prisma migrate diff` giữa DB thật và `schema.prisma`: **No difference** — migration viết tay khớp 100%.
- Smoke test DB thật + mock NetSuite (script: `.tmp/smoke/smoke-netsuite-import.mts`, chạy bằng `npx tsx`):
  - testConnection mock OK; import 3 pricing groups, 41 dòng giá (4 INVALID_PRICE → SKIPPED đúng thiết kế), 39 items (4 skipped).
  - Chạy lặp lần 2: số bản ghi không đổi → **idempotency OK**.
- Boot production build (`npm run start`, PORT 3057): `/` và `/auth/login` trả HTTP 200, scheduler không chạy khi thiếu `ENABLE_SCHEDULER=true` (đúng thiết kế).
- Không phát hiện bug — không cần sửa code. Phần còn lại (catalog/price list/assignment trên Shopify thật) chỉ test được sau khi connect Partner app + cài lên 2 store.
