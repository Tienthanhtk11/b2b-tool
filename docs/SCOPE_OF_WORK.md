# Scope of Work — BMG B2B Product & Group Pricing Integration

> Trạng thái: **Draft để trao đổi và phê duyệt phạm vi**  
> Dự án: **BMG Commerce Labs — B2B Tool**  
> Nền tảng: Shopify Plus, NetSuite và B2B Tool

## 1. Mô tả bài toán hiện tại

BMG đang quản lý dữ liệu sản phẩm và giá B2B trên nhiều hệ thống:

- Shopify store **72hours.ca** là nguồn cập nhật nội dung sản phẩm.
- Shopify store **b2b-site** là kênh bán hàng B2B cần sử dụng dữ liệu sản phẩm từ 72hours.ca.
- **NetSuite** là nơi đội vận hành quản lý group pricing và giá của từng SKU trong mỗi nhóm.
- Customer B2B đã tồn tại trên b2b-site cần được cấu hình vào đúng pricing group để nhìn thấy đúng giá khi đăng nhập.

Nếu vận hành thủ công, đội ngũ phải sao chép nội dung sản phẩm giữa hai Shopify store, nhập lại bảng giá từ NetSuite và cấu hình catalog cho từng khách hàng. Quy trình này tốn thời gian, dễ sai SKU, sai giá, thiếu hình ảnh và khó kiểm tra lịch sử cập nhật.

B2B Tool sẽ kết nối các hệ thống thành hai luồng đồng bộ và một luồng cấu hình khách hàng:

```text
72hours.ca ── Product content ──▶ B2B Tool ──▶ b2b-site

NetSuite ── Pricing groups + item prices ──▶ B2B Tool
                                                   │
Admin config customer vào pricing group ───────────┤
                                                   ▼
                                  Shopify B2B Catalog + Price List
                                                   │
                                                   ▼
                           Giá đúng theo group trên storefront/checkout
```

Mỗi hệ thống giữ một vai trò nguồn dữ liệu chuẩn:

| Dữ liệu | Nguồn chuẩn |
|---|---|
| Nội dung sản phẩm | 72hours.ca |
| Group pricing và giá theo SKU | NetSuite |
| Customer, Company và Company Location | b2b-site |
| Mapping, cấu hình group, trạng thái sync và audit log | B2B Tool |

## 2. Mục tiêu dự án

1. Tự động đồng bộ thông tin sản phẩm từ 72hours.ca sang b2b-site.
2. Cung cấp UI để tìm, gợi ý và xác nhận mapping sản phẩm/variant giữa hai store.
3. Đồng bộ pricing group và giá theo SKU từ NetSuite sang Shopify B2B Catalog/Price List trên b2b-site.
4. Cung cấp UI để theo dõi, chạy lại và xử lý lỗi pricing sync.
5. Cho phép admin cấu hình customer/company location vào một pricing group.
6. Bảo đảm khách B2B đăng nhập nhìn thấy đúng giá của group trên product page, cart và checkout.

## 3. Phạm vi công việc

### 3.1 Product Information Sync: 72hours.ca → b2b-site

B2B Tool tự động đồng bộ thông tin sản phẩm khi dữ liệu trên 72hours.ca thay đổi.

#### Dữ liệu đồng bộ

- Product title.
- SKU.
- Product description, bao gồm nội dung HTML.
- Featured image.
- Product image gallery và thứ tự ảnh.
- Image alt text.
- SEO title và SEO description.
- Product tags.

Giá và tồn kho không thuộc Product Information Sync. Giá B2B được quản lý bởi NetSuite Group Pricing Sync.

#### Cơ chế xử lý

- Sử dụng Shopify `products/update` webhook làm trigger chính.
- App đọc lại dữ liệu đầy đủ từ 72hours.ca sau khi nhận webhook.
- Product và variant được liên kết bằng mapping đã được xác nhận trong app.
- SKU được sử dụng để tìm và gợi ý mapping ban đầu.
- SKU thiếu, trùng hoặc không tìm thấy không được tự động map để tránh cập nhật nhầm.
- Lưu source `updatedAt`, content hash, thời gian sync và kết quả xử lý.
- Chống xử lý webhook trùng và không cho phiên bản cũ ghi đè phiên bản mới.
- Có các thao tác thủ công: Pull from 72hours.ca, Push to b2b-site, Sync now và Retry.

#### Quy tắc nguồn dữ liệu

72hours.ca là source of truth cho các trường sản phẩm trong phạm vi trên. Thay đổi trực tiếp các trường này trên b2b-site có thể bị ghi đè trong lần đồng bộ tiếp theo.

### 3.2 Product Mapping UI

App cung cấp màn hình để đội vận hành quản lý liên kết sản phẩm giữa hai Shopify store.

#### Danh sách mapping

- Product 72hours.ca: title, ảnh, SKU và Shopify ID.
- Product b2b-site: title, ảnh, SKU và Shopify ID.
- Match method: SKU suggestion hoặc manual.
- Trạng thái: `NEEDS_MAPPING`, `READY`, `SYNCING`, `SYNCED`, `FAILED`.
- Source updated time và last synced time.
- Chi tiết lỗi gần nhất.

#### Thao tác

- Tự động gợi ý mapping theo SKU chính xác.
- Chỉ gợi ý tự động khi kết quả là duy nhất.
- Tìm và chọn sản phẩm b2b-site bằng product picker.
- Cho phép dán Shopify Admin product URL để hỗ trợ tìm sản phẩm.
- Confirm, change hoặc remove mapping.
- Preview các trường khác nhau trước khi Push.
- Pull from source, Push to target, Sync now và Retry.
- Filter sản phẩm chưa map, sync lỗi hoặc source vừa thay đổi.

Sau khi được xác nhận, mapping sử dụng Shopify product/variant ID. SKU và URL không được dùng làm khóa liên kết lâu dài.

### 3.3 NetSuite Group Pricing Sync

Đội vận hành tiếp tục tạo và cập nhật giá theo group trong NetSuite. B2B Tool đọc dữ liệu và cập nhật sang b2b-site.

#### Dữ liệu đồng bộ

- NetSuite pricing group/price level được chọn cho b2b-site.
- NetSuite item/variant identifier và SKU.
- Giá cố định của từng item trong mỗi pricing group.
- Currency của bảng giá.
- Thời gian cập nhật và trạng thái active nếu NetSuite cung cấp.

#### Mapping dữ liệu

```text
NetSuite item SKU        ↔ Shopify variant SKU
NetSuite pricing group   ↔ Shopify B2B Catalog + Price List
Customer pricing group   ↔ Shopify Company Location + Catalog
```

Một pricing group có thể được sử dụng cho nhiều customer. Không tạo bảng giá riêng cho từng customer nếu họ sử dụng chung chính sách giá.

#### Cơ chế xử lý

- Kết nối NetSuite qua API được cấp cho dự án.
- Import danh sách pricing group và giá theo SKU.
- Tạo mới hoặc liên kết pricing group với Shopify B2B Catalog/Price List.
- Upsert fixed prices vào Shopify Price List.
- Không cập nhật giá khi SKU bị thiếu, trùng hoặc chưa mapping.
- Không xóa giá cũ nếu dữ liệu nguồn chưa được xác minh là một thao tác xóa hợp lệ.
- Lưu thời gian sync, số bản ghi thành công/bỏ qua/thất bại và chi tiết lỗi.
- Hỗ trợ Sync now và Retry.
- Lịch đồng bộ tự động hoặc trigger từ NetSuite sẽ được chốt sau khi kiểm tra API và yêu cầu độ trễ.

#### Quy tắc nguồn dữ liệu

NetSuite là source of truth cho group pricing. Fixed price do integration quản lý trên Shopify có thể bị ghi đè trong lần sync tiếp theo nếu được chỉnh thủ công.

### 3.4 Group Pricing Sync UI

App cung cấp khu vực quản lý pricing integration.

#### Pricing group list

- Tên và ID của NetSuite pricing group.
- Shopify Catalog và Price List tương ứng.
- Currency.
- Số lượng SKU có giá.
- Last synced time.
- Trạng thái: `UNMAPPED`, `READY`, `SYNCING`, `SYNCED`, `PARTIAL`, `FAILED`.

#### Pricing group detail

- Danh sách SKU và giá NetSuite.
- Shopify variant đã mapping.
- Giá hiện tại trên Shopify Price List.
- Preview giá sẽ thêm, thay đổi hoặc bỏ qua.
- Cảnh báo missing SKU, duplicate SKU và invalid price.
- Filter theo trạng thái từng dòng.
- Sync group, Sync all groups và Retry failed rows.

#### Catalog mapping

- Tạo Shopify Catalog/Price List cho NetSuite group chưa mapping.
- Hoặc chọn Catalog/Price List hiện có.
- Cho phép thay đổi mapping với bước xác nhận ảnh hưởng.
- Không cho hai NetSuite group cùng quản lý một Shopify Price List nếu chưa có xác nhận đặc biệt.

#### Sync history

- Thời gian bắt đầu/kết thúc.
- Trigger: manual hoặc automatic.
- Số dòng thành công, bỏ qua và thất bại.
- Chi tiết lỗi NetSuite hoặc Shopify API.
- Người chạy thao tác thủ công.

### 3.5 Customer Group Assignment UI

App cung cấp màn hình để cấu hình customer B2B hiện có vào pricing group.

#### Đơn vị được gán group

Pricing group được gán cho **Shopify Company Location**, không chỉ gán vào Customer record. Customer/Company Contact nhận giá theo Company Location mà họ có quyền mua hàng.

#### Danh sách customer/company

- Customer/Company Contact.
- Company và Company Location.
- Email.
- Pricing group hiện tại.
- Shopify Catalog tương ứng.
- Ngày cập nhật và người cập nhật.
- Trạng thái: `ASSIGNED`, `UNASSIGNED`, `CONFLICT`, `FAILED`.

#### Thao tác

- Search theo customer email, company hoặc location.
- Filter customer chưa có pricing group.
- Chọn pricing group từ danh sách đã sync từ NetSuite.
- Preview Catalog sẽ được gán và Catalog cũ sẽ được tháo.
- Assign, change hoặc remove group.
- Bulk assign nhiều Company Location vào cùng một group.
- Xem lịch sử thay đổi group.
- Retry khi Shopify catalog assignment thất bại.

#### Quy tắc gán group

- Mỗi Company Location chỉ có một pricing group chính do B2B Tool quản lý.
- Khi đổi group, app tháo Catalog pricing cũ do app quản lý và gán Catalog mới.
- Catalog không do app quản lý không được tự động xóa hoặc thay đổi.
- Nếu phát hiện nhiều pricing Catalog có thể gây xung đột, app dừng thao tác và yêu cầu admin xử lý.
- Customer chưa được gán group không được nhìn thấy nhầm giá của group khác.

### 3.6 Dashboard & Operations

Dashboard tổng hợp gồm:

- Trạng thái kết nối 72hours.ca, b2b-site và NetSuite.
- Số sản phẩm đã map/chưa map/sync lỗi.
- Trạng thái Product Sync gần nhất.
- Số pricing group đã map/chưa map/sync lỗi.
- Trạng thái Pricing Sync gần nhất.
- Số Company Location đã gán/chưa gán group.
- Danh sách lỗi cần xử lý.
- Quick actions: Sync products, Sync pricing và Review assignments.

## 4. Kết quả bàn giao

- Shopify embedded admin app cho đội vận hành.
- Product synchronization service giữa 72hours.ca và b2b-site.
- Product Mapping UI.
- NetSuite Group Pricing integration service.
- Group Pricing Sync UI và Catalog mapping.
- Customer Group Assignment UI.
- Shopify B2B Catalog/Price List integration.
- Dashboard, mapping database, queue/retry và audit log.
- Cấu hình môi trường development/staging/production.
- Tài liệu vận hành và hướng dẫn xử lý lỗi phổ biến.
- Bộ test cho các luồng product sync, pricing sync và catalog assignment quan trọng.

## 5. Ngoài phạm vi MVP

- Đồng bộ customer/company từ NetSuite.
- Đồng bộ đơn hàng Shopify về NetSuite.
- Đồng bộ tồn kho.
- Đồng bộ dữ liệu từ b2b-site ngược về 72hours.ca hoặc NetSuite.
- Promotion, discount code hoặc automatic discount riêng.
- Quantity price breaks/volume pricing, trừ khi được bổ sung rõ vào NetSuite scope.
- Tax rule, credit limit và payment terms từ NetSuite.
- Giá ngoại lệ riêng cho một customer ngoài pricing group.
- Tự động hợp nhất hoặc sửa dữ liệu SKU trùng.
- Tự động xóa product trên b2b-site khi product nguồn bị xóa.
- Data cleansing cho dữ liệu lịch sử trong NetSuite hoặc Shopify.

Nếu một customer cần giá riêng, MVP yêu cầu tạo dedicated pricing group trong NetSuite hoặc xử lý theo quy trình ngoại lệ ngoài hệ thống.

## 6. Tiêu chí nghiệm thu cấp dự án

### Product Sync

- Thay đổi sản phẩm trên 72hours.ca tự động cập nhật đúng sản phẩm đã mapping trên b2b-site.
- SKU thiếu hoặc trùng không làm app cập nhật nhầm product/variant.
- Title, SKU, description, ảnh, SEO và tags khớp sau khi sync hoàn tất.
- Admin có thể tạo/sửa mapping, preview thay đổi, Sync now và Retry từ UI.

### Group Pricing Sync

- Pricing group và giá theo SKU từ NetSuite được cập nhật đúng vào Shopify Price List.
- Admin có thể map NetSuite group với Shopify Catalog/Price List.
- UI hiển thị rõ dòng giá thành công, bỏ qua và thất bại.
- Sync lặp lại không tạo Catalog, Price List hoặc fixed price trùng.

### Customer Group Assignment

- Admin có thể tìm customer/company location và gán vào một pricing group.
- Khi đổi group, Company Location nhận đúng Catalog mới và Catalog cũ do app quản lý được tháo an toàn.
- Customer B2B đăng nhập thấy đúng giá trên product page, cart và checkout.
- Customer chưa có group không nhìn thấy giá của group khác.
- Admin xem được người thay đổi, thời gian và lịch sử assignment.

### Operations

- Dashboard hiển thị đúng trạng thái kết nối và các lỗi cần xử lý.
- Retry không tạo dữ liệu hoặc mapping trùng.
- Admin xem được product sync history, pricing sync history và audit log.

## 7. Dependencies từ BMG

- Quyền truy cập development store của 72hours.ca và b2b-site Shopify Plus.
- Quyền API/scopes cần thiết cho app trên hai store.
- NetSuite sandbox và production API credentials theo phương thức bảo mật được thống nhất.
- NetSuite REST Web Services/SuiteTalk được bật và integration role có quyền tối thiểu cần thiết.
- Danh sách pricing group chính thức.
- Danh sách customer/company location và group ban đầu cần gán.
- Currency và quy tắc làm tròn giá.
- Quy ước SKU duy nhất giữa NetSuite, 72hours.ca và b2b-site.
- Người phụ trách nghiệp vụ xác nhận product mapping, catalog, giá và dữ liệu test.

## 8. Các quyết định cần chốt trước khi estimate chính thức

1. Product đã tồn tại sẵn ở b2b-site hay app được phép tạo product mới khi không tìm thấy mapping?
2. SKU được phép thay đổi từ 72hours.ca hay chỉ dùng làm external matching key?
3. Khi ảnh bị xóa trên 72hours.ca, app có được xóa ảnh tương ứng trên b2b-site không?
4. NetSuite cung cấp pricing group bằng record chuẩn, saved search hay custom record?
5. Yêu cầu độ trễ của pricing sync: gần thời gian thực, mỗi 15 phút, mỗi giờ hay chạy theo yêu cầu?
6. Một Company Location chỉ có một pricing group hay có trường hợp cần nhiều group?
7. Currency được quản lý theo pricing group hay toàn bộ b2b-site chỉ dùng một currency?
8. Khi giá của một SKU bị xóa khỏi group trong NetSuite, fixed price tương ứng trên Shopify sẽ bị xóa hay giữ lại và cảnh báo?
9. Customer/company location đã tồn tại đầy đủ trên b2b-site chưa, hay cần một lần initial data setup?

## 9. Giả định để định nghĩa MVP

- 72hours.ca và b2b-site đều sử dụng Shopify Plus và có thể cài B2B Tool.
- 72hours.ca là nguồn chuẩn cho product content.
- NetSuite là nguồn chuẩn duy nhất cho B2B group pricing.
- Customer, Company và Company Location đã tồn tại hoặc được tạo ngoài phạm vi dự án này.
- SKU giữa các hệ thống có thể được chuẩn hóa thành giá trị duy nhất.
- Pricing áp dụng theo group, không theo bảng giá thủ công riêng cho từng customer.
- Admin chịu trách nhiệm gán Company Location vào pricing group.
- Shopify native B2B Catalog/Price List được sử dụng để giá đúng ở cả storefront và checkout.
- Timeline và chi phí chỉ được estimate sau khi các quyết định ở mục 8 và khả năng truy cập NetSuite sandbox được xác nhận.

## 10. Tài liệu thiết kế liên quan

- `docs/PRODUCT_SYNC_DESIGN.md`
- `docs/SPEC.md`
