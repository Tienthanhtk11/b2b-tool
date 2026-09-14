# Product Sync Design — 72hours.ca → b2b-site

> Tài liệu mô tả luồng Product Information Sync **đã được implement** trong
> `app/services/product-sync.server.ts`. Thiết kế tổng thể: `docs/SPEC.md`.

## Phạm vi dữ liệu

Sync: title, descriptionHtml, tags, SEO (title/description), toàn bộ image gallery (URL + alt + thứ tự).
KHÔNG sync: giá, tồn kho, SKU trên target (SKU chỉ dùng làm matching key), status, metafields.

## Data model

- `ProductMapping`: 1 source product ↔ 0..1 target product. Khóa liên kết lâu dài là **Shopify GID**, không phải SKU/URL. Trạng thái: `NEEDS_MAPPING → READY → SYNCING → SYNCED / FAILED`.
- `VariantMapping`: map từng variant theo SKU tại thời điểm confirm.
- `WebhookEvent`: dedup theo `X-Shopify-Webhook-Id` (unique PK); nếu xử lý lỗi thì xóa record để Shopify retry được.

## Luồng webhook (`webhooks.products-update.tsx`)

1. `authenticate.webhook` → chỉ xử lý khi `shop === SOURCE_SHOP_DOMAIN`.
2. Dedup bằng insert `WebhookEvent` (bắt P2002 → bỏ qua event trùng).
3. `pullFromSource`: đọc lại product đầy đủ qua Admin GraphQL (webhook payload chỉ là trigger), tính `contentHash` (SHA-256 của title/handle/description/tags/seo/images/variants đã chuẩn hóa), lưu `sourceUpdatedAt`.
4. Bỏ qua nếu event cũ hơn bản đã lưu (stale) hoặc hash không đổi.
5. Nếu `NEEDS_MAPPING` → thử `suggestMapping` (SKU match, chỉ nhận khi kết quả duy nhất và tất cả SKU cùng trỏ về 1 target product).
6. Nếu `READY`/`SYNCED` → `pushToTarget`.

## Push to target

- `productUpdate` (title, descriptionHtml, tags, seo) trên b2b-site.
- Media: so sánh URL đã normalize (bỏ query string) theo thứ tự; nếu khác → xóa toàn bộ media IMAGE cũ (`productDeleteMedia`) rồi tạo lại từ source URL (`productCreateMedia`) để giữ đúng thứ tự + alt.
- Mỗi lần push tạo `SyncRun` (type `PRODUCT_SYNC`) và cập nhật trạng thái mapping + `lastError`.

## Quy tắc mapping

- Gợi ý tự động chỉ theo **SKU chính xác, duy nhất**; SKU thiếu/trùng → giữ `NEEDS_MAPPING` + lý do trong `lastError`.
- Confirm thủ công qua product picker hoặc dán Admin URL; ghi `AuditLog` (`MAPPING_CONFIRMED`).
- Không tự tạo product mới trên b2b-site (quyết định #3, SPEC mục 2).

## Thao tác thủ công (Mapping UI)

Pull from 72hours.ca / Push to b2b-site / Sync now (pull + push nếu hash đổi hoặc đang FAILED) / Retry / Import all source products.
