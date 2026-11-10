# Personal OS – Spec phát triển cho AI Agent

Phiên bản: 1.2 · Mục tiêu V001: đầy đủ tính năng ở mục 5–9 và giai đoạn hoàn thiện ở mục 12, web cá nhân chạy local, một người dùng, chưa đăng nhập. PostgreSQL có thể chạy local hoặc trên dịch vụ quản lý khi deploy sau này.

## 0. Cách dùng tài liệu này

Đây là spec để AI agent triển khai. V001 bao gồm toàn bộ tính năng đã mô tả; các giai đoạn ở mục 12 là thứ tự triển khai và gate kiểm chứng trong cùng phiên bản, không phải các phiên bản phát hành riêng. Agent không làm sang giai đoạn sau khi giai đoạn trước chưa qua hết tiêu chí hoàn thành. Mọi quy tắc nghiệp vụ ở mục 5–6 là bắt buộc và phải có test tự động. Công thức tài chính chưa rõ phải hỏi người dùng trước khi chọn; chỉ ghi quyết định đã chốt vào `DECISIONS.md`. Không tự thêm tính năng ngoài spec.

## 1. Mục tiêu và luồng sử dụng cốt lõi

Ví dụ tháng 11/2026 đã có sẵn kế hoạch lương, hỗ trợ mẹ và trả nợ; hạn mức ba hũ chi tiêu để trống cho người dùng đặt. Chuyển tiền vào tiết kiệm là thao tác chủ động.

1. Mỗi ngày ghi nhanh một khoản chi, chọn hũ. Số tiền còn lại của hũ đó và tổng tiền khả dụng giảm ngay.
2. Khi nhận lương hoặc trả khoản cố định, xác nhận trên dòng kế hoạch để tạo giao dịch liên kết.
3. Sang tháng sau, kế hoạch được tạo tự động từ cấu hình, người dùng không phải nhập lại gì.
4. Cuối tháng xem thống kê và chốt tháng.

Triết lý: thiết lập ít, ghi nhanh, số liệu đáng tin, dùng ổn định nhiều năm.

## 2. Quyết định kỹ thuật (đã chốt)

| Hạng mục | Quyết định |
| --- | --- |
| Ngôn ngữ | TypeScript toàn bộ |
| Frontend | React + Vite, CSS đơn giản (Tailwind được phép), ưu tiên PC/laptop; mobile responsive cơ bản |
| Backend | Node.js + Fastify (hoặc Express), chạy local bằng `npm start` |
| Lưu trữ | PostgreSQL qua `pg`; kết nối bằng `DATABASE_URL`. Khi deploy Vercel, dùng PostgreSQL được quản lý (ví dụ Neon qua Marketplace) |
| Truy cập điện thoại | Server lắng nghe `0.0.0.0`, điện thoại vào qua Wi-Fi nhà bằng IP máy tính. Thêm manifest PWA để cài lên màn hình chính |
| Test | Vitest cho engine và API |
| Tiền tệ | Số nguyên VND (`INTEGER`), không dùng số thực |
| Thời gian | Lưu ngày dạng `YYYY-MM-DD` và tháng dạng `YYYY-MM`, theo giờ local `Asia/Ho_Chi_Minh`. Giao dịch thuộc tháng theo ngày người dùng chọn |
| Xác thực | Giai đoạn local chưa có; chỉ dùng trong mạng tin cậy. Phải thêm xác thực trước khi truy cập qua Internet |

Yêu cầu kiến trúc: tách một package `core` (logic thuần, không phụ thuộc DB hay HTTP) chứa engine tạo tháng, tick thanh toán, tính số dư. `core` nhận dữ liệu qua interface repository để test được bằng in-memory. API và UI chỉ gọi `core`.

Cấu trúc repo gợi ý:

```
/packages/core      # engine + types + tests
/apps/server        # Fastify + PostgreSQL + migrations
/apps/web           # React UI
DECISIONS.md  README.md
```

## 3. Mô hình dữ liệu

Mọi bảng có `id`, `created_at`, `updated_at`. Xóa giao dịch dùng soft delete (`deleted_at`) để hoàn tác an toàn.

**jars** – hũ

- `name`, `kind`: `spending` | `saving`
- Hũ chi tiêu phẳng, không dùng `parent_id`; hạn mức nằm trong `jar_month_budgets` theo `(month, jar_id)`.
- `opening_balance` (chỉ với hũ saving), `archived`

**jar_month_budgets** – hạn mức riêng của hũ chi tiêu trong tháng mở; không có dòng nghĩa là chưa đặt. Khi tạo tháng mới, sao chép hạn mức của tháng ngay trước đó; sửa một tháng không đổi tháng khác. Tháng đã chốt không cho sửa.

**recurring\_templates** – khoản mẫu

- `name`, `kind`: `income` | `expense` | `transfer_to_saving` | `debt_payment`
- `jar_id`, `debt_id` (nullable), `frequency`: `monthly` | `once` | `custom`
- `day_of_month`, `start_month`, `end_month` (nullable), `auto_repeat` (bool), `note`

**template\_versions** – phiên bản số tiền theo thời gian

- `template_id`, `amount`, `effective_from` (`YYYY-MM`)
- Khi đổi số tiền "từ tháng này", thêm một version mới. Không bao giờ sửa version cũ. Số tiền hiệu lực của tháng M là version có `effective_from` lớn nhất mà `<= M`.

**month\_plans**

- `month` (`YYYY-MM`, unique), `status`: `open` | `closed`, `closed_at`, `snapshot_json` (số liệu tổng kết lúc chốt)

**planned\_items** – dòng kế hoạch của một tháng

- `month`, `template_id` (nullable nếu là dòng thêm tay), `name`, `kind`, `jar_id`, `debt_id`
- `expected_amount`, `expected_day`, `skipped` (bool), `note`
- `is_overridden` (bool): true nếu người dùng sửa riêng tháng này
- **Unique `(month, template_id)`** để một template chỉ sinh đúng một dòng mỗi tháng

**transactions** – giao dịch thật

- `date`, `amount` (> 0), `type`: `income` | `expense` | `transfer_in` | `transfer_out`
- `jar_id`, `planned_item_id` (nullable), `description`, `note`, `deleted_at`
- `transfer_in`: tiền chuyển từ tài khoản chi tiêu vào hũ saving. `transfer_out`: rút từ hũ saving về tài khoản chi tiêu.

**debts**

- `name`, `current_balance` (nullable: chưa biết thì để trống), `expected_monthly`, `due_day`, `interest_rate` (nullable), `status`: `active` | `paid_off`

**settings**

- `account_opening_balance`, `account_opening_date`, `schema_version`

MVP chỉ có **một tài khoản chi tiêu duy nhất**. Ghi rõ giới hạn này trong UI phần cài đặt.

**Dự kiến chi:** `financial_targets` lưu tên, số tiền dự kiến, thứ tự ưu tiên và giao dịch thực hiện. Mỗi khoản so riêng với số dư hũ Linh động; không phân bổ hoặc tạo nghĩa vụ hàng tháng. Khi thực hiện, ghi `transfer_out` từ hũ và một `expense` trong cùng transaction DB. Hoàn tác cả cặp; không sửa hoặc xóa riêng giao dịch thuộc cặp.

**Sau gate tài chính:** `goals` (`type`: long|short, `parent_goal_id`, `title`, `description`, `start_date`, `due_date`, `status`: todo|doing|done|paused), `milestones`/`checklist_items` (`goal_id`, `title`, `done`), `journal_entries` (`datetime`, `title`, `content`, `tags`), `journal_goal_links`.

## 4. Dữ liệu khởi tạo (seed)

Seed bằng script và dùng làm fixture test.

- Tài khoản: số dư đầu kỳ do người dùng nhập (mặc định 0), ngày bắt đầu 2026-11-01.
- Thu nhập: Lương thực nhận 18.886.350 · ngày 15 · hằng tháng · từ 2026-11.
- Hỗ trợ mẹ 8.000.000 · ngày 15 · hũ Gia đình · không ngày kết thúc.
- Tiền chuyển vào hũ Linh động khi người dùng chủ động ghi, không có khoản chuyển cố định hàng tháng.
- Khoản mẫu trả nợ 2.000.000 (dự kiến) gắn với một khoản nợ cụ thể; cho phép thực trả khác. Ngày kết thúc để trống cho đến khi người dùng nhập. Tên dòng nên chỉ rõ khoản nợ, ví dụ "Trả Later".
- Ba hũ chi tiêu: Gia đình, Học tập & phát triển, Sinh hoạt. Hạn mức cả ba trong tháng 11/2026 để trống cho người dùng tự đặt.
- Hũ saving: Linh động, Quỹ khẩn cấp. Người dùng có thể tạo thêm hũ khi cần.

## 5. Quy tắc nghiệp vụ (bắt buộc)

### 5.1 Tạo tháng tự động

Khi người dùng mở tháng M chưa có `month_plans`, hệ thống tạo `month_plans(status=open)` và sinh `planned_items` cho mọi template thỏa: `start_month <= M`, `end_month` rỗng hoặc `>= M`, `auto_repeat = true`. Số tiền lấy theo version hiệu lực của M.

- Thao tác phải **idempotent**: gọi nhiều lần không tạo trùng (nhờ unique `(month, template_id)`).
- Mọi dòng mới ở trạng thái chưa thanh toán, thực tế bằng 0.
- **Không bao giờ** tự đánh dấu đã thanh toán theo ngày.
- Chỉ cho phép mở tháng từ tháng bắt đầu đến tháng hiện tại + 1.
- Khoản nợ có `status = paid_off` thì template trả nợ không sinh dòng cho các tháng sau.
- `debts.current_balance` là dư nợ, không phải số tiền dự kiến trả mỗi tháng. Chỉ khoản nợ có template trả nợ hiệu lực mới tự sinh dòng tháng. Nợ chưa có template vẫn xuất hiện ở Các khoản nợ; người dùng có thể thêm kế hoạch trả nợ riêng cho tháng đang mở và nhập số tiền dự kiến. Không tự suy ra số tiền trả từ dư nợ.

### 5.2 Sửa kế hoạch

Chỉ có hai phạm vi:

- **Chỉ tháng này:** sửa trực tiếp `planned_item`, đặt `is_overridden = true`. Template và các tháng khác không đổi.
- **Từ tháng này trở đi:** thêm `template_version` mới với `effective_from = M`. Cập nhật các `planned_items` đã sinh của tháng M trở đi nếu tháng đó `open`, chưa có giao dịch và `is_overridden = false`. Tháng `closed` không bao giờ bị đổi.

Kết thúc một khoản định kỳ = đặt `end_month`.

Với nợ, mức trả mặc định trong Các khoản nợ áp dụng từ tháng sau. Dòng trả nợ của tháng đang xem sửa riêng trong Thiết lập tháng/Kế hoạch tháng; dòng thêm tay, chưa có giao dịch có thể xóa khỏi tháng. Dừng mẫu trả nợ không xóa lịch sử hay khoản nợ.

### 5.3 Trạng thái khoản định kỳ

Trạng thái của `planned_item` **tính ra** từ giao dịch liên kết, không lưu cứng:

- `skipped = true` → Bỏ qua tháng này.
- Tổng giao dịch liên kết = 0 → Chưa thanh toán.
- 0 < tổng < `expected_amount` → Thanh toán một phần (hiển thị còn thiếu).
- Tổng >= `expected_amount` → Đã thanh toán.

### 5.4 Tick thanh toán

- Tick "Đã thanh toán": mở hộp xác nhận có sẵn số tiền dự kiến (sửa được) và ngày hôm nay (sửa được). Xác nhận tạo **đúng một** giao dịch liên kết `planned_item_id`, đúng loại theo `kind`:
  - `expense`, `debt_payment` → `expense` vào hũ tương ứng.
  - `transfer_to_saving` → `transfer_in` vào hũ saving, **không tính vào tổng chi tiêu**.
  - `income` → `income`.
- Gọi lại API tick khi đã đủ tiền phải trả về kết quả cũ, không tạo giao dịch mới (dùng idempotency key hoặc kiểm tra trạng thái trong transaction DB).
- Bỏ tick: soft delete giao dịch liên kết sau khi xác nhận (bắt buộc xác nhận nếu số tiền >= 1.000.000đ). Số liệu tính lại tự động.
- Trả một phần: cho phép nhiều giao dịch trên một dòng. Nút tick lần sau mặc định điền số còn thiếu.
- Trả nợ: nếu `debts.current_balance` không rỗng, giảm theo số thực trả; về 0 thì `paid_off` và dừng sinh dòng. Nếu `current_balance` rỗng, tuyệt đối không hiển thị dư nợ hay ngày hết nợ ước tính.
- Khi dư nợ đã biết, từ chối khoản trả lớn hơn dư nợ còn lại. Quy tắc này áp dụng cả khi sửa giao dịch trả nợ.

### 5.5 Giao dịch hằng ngày

- Trường: ngày (mặc định hôm nay), số tiền, loại, hũ, nội dung, ghi chú.
- Thêm, sửa, xóa (soft), tìm theo nội dung, lọc theo hũ/ngày/tháng.
- Giao dịch sinh từ tick thì sửa số tiền/ngày được, nhưng hiển thị rõ "thuộc khoản định kỳ X" và xóa phải qua thao tác bỏ tick.
- Tháng của giao dịch `closed`: từ chối, yêu cầu mở lại tháng.
- Chi vượt hạn mức hũ của tháng đang chọn: hiển thị cảnh báo, **vẫn cho lưu**.

### 5.6 Chốt và mở lại tháng

- Chốt: lưu `snapshot_json`, đặt `closed`. Không tự chuyển tiền dư vào tiết kiệm. Có nút riêng "Chuyển phần dư vào tiết kiệm"; người dùng nhập số tiền và hũ rồi xác nhận để tạo `transfer_in`, không tự tính hay điền mặc định phần dư.
- Mở lại: cho phép, kèm cảnh báo. Mở lại không làm hỏng dữ liệu vì mọi số dư tính từ giao dịch. Số dư các tháng sau tự cập nhật.
- Chưa chốt vẫn cho sang tháng mới bình thường.

## 6. Công thức tài chính

Tất cả số dư **tính từ giao dịch**, không lưu cứng. Tách riêng, không gộp.

### 6.1 Ngân sách dự kiến và phần chưa phân bổ (cho tháng M)

```
Phân bổ cố định = tổng expected_amount của: expense (cố định), debt_payment, transfer_to_saving
Phân bổ thêm theo hũ = tổng max(0, hạn mức hũ tháng M − khoản expense cố định chưa bỏ qua gắn với hũ đó)
Thu nhập dự kiến = tổng expected_amount của income
Chưa phân bổ = Thu nhập dự kiến − Phân bổ cố định − Phân bổ thêm theo hũ
```

Hạn mức Gia đình gồm Hỗ trợ mẹ; chỉ phần vượt khoản cố định của Gia đình làm giảm Chưa phân bổ. Hạn mức trống không làm tăng phân bổ.

### 6.2 Tiền khả dụng thực tế (đến hết ngày hôm nay, cộng dồn nhiều tháng)

```
Khả dụng = account_opening_balance
         + Σ income
         − Σ expense
         − Σ transfer_in
         + Σ transfer_out
```

chỉ tính giao dịch chưa xóa, ngày `>= account_opening_date`. Kèm dòng chú thích cố định: "Chỉ đúng khi đã nhập đủ giao dịch. Có thể khác số dư ngân hàng."

### 6.3 Số dư tiết kiệm

Của mỗi hũ saving: `opening_balance + Σ transfer_in − Σ transfer_out`. Tổng tiết kiệm là tổng các hũ saving.

### 6.4 Thực tế theo tháng

- Tổng chi tiêu thực tế = Σ `expense` trong tháng (không gồm chuyển quỹ).
- Tổng chuyển tiết kiệm = Σ `transfer_in` − Σ `transfer_out` trong tháng.
- Đã dùng của hũ = Σ `expense` của hũ trong tháng. Còn lại = hạn mức tháng − đã dùng khi đã đặt hạn mức.
- Nghĩa vụ còn phải trả = Σ (expected − đã trả) của các dòng chưa thanh toán và không bị bỏ qua. Hiển thị tách khỏi tiền khả dụng, kèm "Khả dụng sau nghĩa vụ" = Khả dụng − nghĩa vụ còn phải trả.
- Nếu thu nhập chưa nhận, dashboard hiển thị "Chưa nhận", không cộng vào số thực tế.

## 7. API (REST, JSON)

```
GET    /api/months/:month                 # tự tạo tháng nếu chưa có (idempotent), trả plan + summary
POST   /api/months/:month/close
POST   /api/months/:month/reopen
GET    /api/months/:month/summary

GET    /api/transactions?month=&jarId=&q=
POST   /api/transactions
PATCH  /api/transactions/:id
DELETE /api/transactions/:id              # soft delete

POST   /api/planned-items/:id/pay         # body: amount, date, idempotencyKey
POST   /api/planned-items/:id/unpay
POST   /api/planned-items/:id/skip
PATCH  /api/planned-items/:id             # body: scope = this_month | from_month

GET/POST/PATCH /api/templates, /api/jars, /api/debts
GET    /api/balances                      # khả dụng, tiết kiệm, theo ngày hôm nay
GET    /api/financial-targets             # hũ Linh động và danh sách dự kiến chi
POST   /api/financial-targets             # tên và số tiền dự kiến
PATCH  /api/financial-targets/:id         # sửa khoản chưa thực hiện
PUT    /api/financial-targets/order       # đổi thứ tự ưu tiên
POST   /api/financial-targets/:id/purchase # rút từ hũ và ghi chi thực tế
POST   /api/financial-targets/:id/undo    # hoàn tác cả cặp giao dịch
GET    /api/export                        # toàn bộ dữ liệu JSON
POST   /api/import                        # yêu cầu confirm=true, ghi đè
```

Mọi thao tác ghi nhiều bảng phải nằm trong một transaction DB. Lỗi trả mã và thông điệp tiếng Việt rõ ràng.

## 8. Giao diện

Ưu tiên PC/laptop, mobile responsive cơ bản. V001 có ba luồng hoạt động đầy đủ: **Tài chính / Mục tiêu / Nhật ký**. Trong quá trình triển khai, chỉ mở luồng khi API tương ứng đã qua gate kiểm chứng. Thanh chọn tháng ở đầu.

### Tab Tài chính

- **Đầu trang, 3 số chính:** Còn có thể chi theo kế hoạch · Tiền khả dụng thực tế · Tổng tiết kiệm. Các số phụ (thu nhập dự kiến/đã nhận, nghĩa vụ còn phải trả) nằm trong phần mở rộng.
- **Khối "Kế hoạch tháng":** danh sách planned items với checkbox, trạng thái, số dự kiến/thực tế, ngày dự kiến. Dòng nợ hiển thị tên khoản nợ để phân biệt với dư nợ ở Cài đặt.
- **Khối "Hũ chi tiêu":** mỗi hũ phẳng một thanh tiến độ (đã dùng/hạn mức tháng). Đổi màu khi vượt.
- **Giao dịch gần đây** và tổng chi tiêu tháng.
- **Nút nổi "+ Ghi chi tiêu"** luôn thấy được, hành động nổi bật nhất.

### Form ghi nhanh

- Mở là focus sẵn ô số tiền. Ngày mặc định hôm nay. Hũ nhớ lần dùng gần nhất.
- Ô nhập tắt: gõ `35k cafe` hoặc `35.000 cà phê` → phân tích số tiền (`k` = nghìn, `tr` = triệu) và nội dung, đề xuất hũ dựa trên lần gần nhất có nội dung tương tự (so khớp từ khóa đơn giản, không AI). Người dùng luôn xác nhận được trước khi lưu.
- Lưu xong form đóng lại và có toast "Hoàn tác" trong vài giây.

### Các màn khác

Lịch sử các tháng, chi tiết một hũ (danh sách giao dịch), Cài đặt (số dư đầu kỳ, quản lý hũ/template/nợ, sao lưu), trang tổng kết tháng với nút Chốt tháng.

Định dạng tiền: `18.886.350đ`. Ngày: `dd/mm/yyyy`. Toàn bộ nhãn tiếng Việt.

## 9. Sao lưu và khôi phục

- Nút xuất JSON toàn bộ (kèm `schema_version`) và nhập lại, có hộp xác nhận ghi đè và tự động sao lưu bản hiện tại trước khi nhập.
- Sao lưu PostgreSQL định kỳ ở nơi lưu riêng bằng công cụ của nhà cung cấp hoặc `pg_dump`; kiểm tra khôi phục trước khi dùng thật. Không sao chép file DB từ server.
- Hiển thị nhắc nhở nếu quá 7 ngày chưa xuất JSON thủ công.
- Migration có đánh số, chạy tự động khi khởi động, không làm mất dữ liệu.
- Không lưu thông tin ngân hàng hay mật khẩu.

## 10. Phi chức năng

- Mọi thao tác ghi dưới 200ms trên máy cá nhân.
- PostgreSQL có thể chạy local hoặc trên dịch vụ quản lý. Môi trường phát triển hiện dùng Neon dev cho app local và Preview, PostgreSQL local chỉ cho test; chi tiết ở `doc/development_workflow.md`.
- Mã nguồn có `README.md` hướng dẫn cài, chạy, truy cập từ điện thoại, sao lưu.
- Ngoài phạm vi giai đoạn local (không làm): đăng nhập, đồng bộ ngân hàng, đọc SMS, AI phân loại, chatbot, đầu tư/crypto, thông báo phức tạp, đồng bộ cloud, gamification, nhiều tài khoản/nhiều tiền tệ. Deploy công khai cần thiết kế xác thực riêng.

## 11. Bộ test bắt buộc

Viết test trước hoặc cùng lúc với engine. Mỗi tình huống là một test độc lập trên `core`.

1. Lương nhận trễ: tháng đã có kế hoạch, thu nhập thực tế vẫn 0, khả dụng không cộng lương.
2. Chuyển mẹ 7 triệu thay vì 8 triệu: ghi 7.000.000, trạng thái "một phần", còn thiếu 1.000.000.
3. Trả nợ 1,5 triệu: ghi 1.500.000, không ghi 2.000.000.
4. Không dùng hết hạn mức hũ trong tháng: phần dư không tạo giao dịch tiết kiệm.
5. Đổi hỗ trợ mẹ 8 → 9 triệu từ 2027-01: tháng 11 và 12/2026 giữ 8 triệu, tháng 1/2027 là 9 triệu.
6. Tick rồi tick lại: chỉ có một giao dịch. Bỏ tick: giao dịch bị xóa mềm, số liệu quay về cũ.
7. Quên nhập chi tiêu: không có chỗ nào khẳng định số dư app bằng số dư ngân hàng.
8. Thêm giao dịch vào tháng đã chốt: bị từ chối. Sau khi mở lại: được ghi và báo cáo tháng đó cập nhật.
9. Mở tháng mới nhiều lần (kể cả gọi đồng thời): mỗi template chỉ sinh đúng một dòng.
10. Rút tiền tiết kiệm: số dư hũ giảm, khả dụng tăng, **không** tính vào thu nhập.

Test bổ sung:

11. Chuyển tiết kiệm 3 triệu: tăng số dư tiết kiệm, giảm khả dụng, không nằm trong tổng chi tiêu.
12. Template có `end_month` 2027-01: tháng 2/2027 không sinh dòng.
13. Sửa giao dịch tháng 11 sau khi mở lại: số dư khả dụng tháng 12 tự thay đổi theo.
14. Giao dịch lúc 23:50 ngày 30/11 theo giờ Việt Nam thuộc tháng 11.
15. Hũ phẳng: đã dùng chỉ gồm giao dịch gắn với hũ; hạn mức tháng này không sửa tháng khác. Hạn mức Gia đình không tính trùng Hỗ trợ mẹ.
16. Nợ chưa biết dư nợ: API và UI không trả/hiển thị dư nợ còn lại.
17. Import dữ liệu: dữ liệu export rồi import lại cho kết quả giống hệt.

## 12. Lộ trình và tiêu chí hoàn thành

### Giai đoạn 0 – Nền tảng

Khởi tạo repo, `core` với types, migration PostgreSQL, seed, test chạy được. Hoàn thành khi `npm test` và `npm start` chạy với `DATABASE_URL` và `TEST_DATABASE_URL` hợp lệ.

### Giai đoạn 1 – Tài chính cốt lõi

Engine tạo tháng, template versions, tick/unpay/skip, giao dịch CRUD, tính số dư, tiết kiệm, nợ cơ bản, lịch sử tháng, chốt/mở lại tháng, UI mục 8, sao lưu mục 9. **Hoàn thành khi:** 17 test ở mục 11 đều qua; quản lý được hai tháng liên tiếp mà không nhập lại khoản cố định và không bị tính trùng; luồng ghi giao dịch chạy trên trình duyệt PC và bố cục mobile không vỡ.

Sau khi đạt gate tài chính, tiếp tục các giai đoạn sau trong V001. Trải nghiệm dùng thật một tháng là bằng chứng vận hành trước khi xem V001 ổn định, không chặn việc triển khai tính năng.

### Giai đoạn 2 – Mục tiêu, công việc, nhật ký

Mục tiêu dài hạn và ngắn hạn, milestone/checklist (đây cũng là nơi quản lý công việc, không tạo tab todo riêng), nhật ký nhiều bản ghi mỗi ngày, tag, liên kết nhật ký với mục tiêu, timeline, lịch tháng, tìm kiếm, tổng kết tuần/tháng. Tiến độ mục tiêu tính từ checklist thật, không streak, không điểm năng suất. **Hoàn thành khi:** tạo được mục tiêu, tick checklist, mở mục tiêu thấy được nhật ký liên quan.

### Giai đoạn 3 – Hoàn thiện V001

Biểu đồ theo tháng, so sánh ngân sách và thực tế, thống kê nhiều tháng, quản lý nợ chi tiết (lãi suất, lịch sử), tối ưu mobile, gợi ý đoán hũ tốt hơn.

**Gate hoàn thành V001:** Tất cả chức năng ở mục 5–9 và giai đoạn 2–3 hoạt động; 17 test mục 11 qua; kiểm chứng hai tháng liên tiếp, luồng ghi giao dịch trên PC và responsive mobile cơ bản, xuất/nhập JSON khôi phục đúng dữ liệu, và luồng mục tiêu–nhật ký được kiểm tra trên trình duyệt. Báo cáo riêng bằng chứng test, API và trình duyệt; điện thoại thật là kiểm chứng tùy chọn. Chưa có xác thực thì chỉ vận hành trên mạng tin cậy; không phát hành Internet.

## 13. Quy tắc làm việc cho AI agent

1. Làm theo giai đoạn. Cuối mỗi giai đoạn báo cáo: những gì đã làm, test nào qua, điều gì chưa làm.
2. Mọi quy tắc ở mục 5 và 6 phải có test trước khi viết UI cho tính năng đó.
3. Không tự thêm tính năng ngoài spec. Muốn thêm, ghi đề xuất vào `DECISIONS.md` để người dùng duyệt.
4. Không lưu số dư tính ra vào DB. Chỉ lưu giao dịch và cấu hình.
5. Không dùng số thực cho tiền. Không dùng thư viện trả phí hay gọi dịch vụ ngoài.
6. Mọi thao tác ghi nhiều bước phải nằm trong DB transaction.
7. Giữ code đơn giản, ưu tiên dễ đọc và dễ sửa hơn là tối ưu sớm.
8. Không bao giờ xóa dữ liệu người dùng khi migration. Nếu cần đổi cấu trúc, viết migration có thể chạy lặp an toàn.
9. Khi spec mơ hồ ở một công thức tài chính, dừng và hỏi người dùng thay vì đoán.
