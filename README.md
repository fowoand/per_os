# Personal OS

Web tài chính cá nhân. Hiện có dashboard, kế hoạch tháng, giao dịch, hũ, nợ, mục tiêu và nhật ký; trạng thái nghiệm thu từng mục ở [.agents/doc/features-list.md](.agents/doc/features-list.md). V001 chưa được chốt hoàn thành.

## Chạy local bằng Docker

Cần Docker Desktop. Docker Compose chạy PostgreSQL chỉ cho test, backend dùng Neon dev và Vite frontend gọi backend local. Tạo `.env.neon.local` từ Neon dev với `DATABASE_URL` và `DATABASE_URL_UNPOOLED`; file này bị Git bỏ qua.

```sh
./dev.sh
```

`./init.sh` dùng `personal_os_test` trong PostgreSQL local, tách khỏi Neon dev:

```sh
./init.sh
```

Mở `http://localhost:4173`. Sau lần khởi tạo đầu tiên, Docker Desktop tự khởi động lại ba container nhờ `restart: unless-stopped`.

Trong **Các khoản nợ**, dư nợ là số còn phải trả, không tự tạo nghĩa vụ tháng. **Mức trả mặc định** sinh kế hoạch từ tháng sau; để trống thì không tự sinh. Với tháng đang xem, vào **Tài chính > Thêm kế hoạch trả nợ** để nhập số dự kiến, hoặc **Thiết lập tháng** để sửa dòng đã có. Ghi giao dịch trả nợ qua dòng kế hoạch để cập nhật trạng thái thanh toán và dư nợ. Khoản nợ vẫn tồn tại khi chưa có dòng trong Kế hoạch tháng.

```sh
docker compose logs -f api
docker compose logs -f web
./dev-down.sh                 # dừng, không xóa dữ liệu
```

Không dùng `docker compose down -v` khi cần giữ dữ liệu test local.

`npm test` tạo và xóa schema riêng trong `TEST_DATABASE_URL`; `./init.sh` trỏ tới DB test local. Server tự chạy migration khi kết nối DB; `./dev.sh` kiểm tra version Neon trước khi mở API. Mở `http://localhost:3000/health` để kiểm tra. Không seed Neon.

Server nghe `0.0.0.0:3000` trong container; frontend dùng Vite proxy `/api`. Điện thoại cùng Wi-Fi có thể truy cập qua IP máy tính khi port bind được mở phù hợp. Chỉ dùng trong mạng tin cậy vì app chưa có xác thực.

## Dữ liệu và deploy

Local API và Preview dùng Neon dev; Production dùng Neon prod. Không đưa app tài chính lên Internet trước khi có xác thực. Khi deploy, cấu hình `DATABASE_URL` trong môi trường server; không lưu URL trong repo.

Sao lưu định kỳ bằng `pg_dump` hoặc công cụ của nhà cung cấp DB, và kiểm tra khôi phục. Cài đặt có xuất/nhập JSON; nhập sẽ tải bản hiện tại xuống trước khi ghi đè. File SQLite cũ `data/personal-os.db` hiện rỗng, được giữ nguyên nhưng không còn được sử dụng.

`./init.sh` chạy test và kiểm tra TypeScript. Xem `AGENTS.md` để tiếp tục theo giai đoạn và `DECISIONS.md` cho quyết định còn mơ hồ.

Sau khi sửa skill trong `.agents/skills`, chạy `./validate-skills.sh`. Script dùng `uv` để cấp PyYAML riêng cho validator, không cài package vào Python hệ thống.

## Vercel dev/prod

Phát triển local trên `dev` với Neon dev cho app và PostgreSQL local cho test. `vercel.json` tắt auto deploy: push không thay đổi Preview hay Production. Chỉ chạy `./deploy.sh dev` hoặc `./deploy.sh prod` khi có yêu cầu deploy riêng; script cần Vercel CLI đã đăng nhập và `jq`. Quy tắc nhánh, database, gate và aliases nằm trong [quy trình phát triển](doc/development_workflow.md).

Backend có API tài chính, mục tiêu, nhật ký và sao lưu. Xác thực và gate V001 vẫn còn thiếu trước khi dùng dữ liệu tài chính qua Internet công khai; Preview có Deployment Protection.
