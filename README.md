# Personal OS

Web tài chính cá nhân. Hiện có dashboard, kế hoạch tháng, giao dịch, hũ, nợ, mục tiêu và nhật ký; trạng thái nghiệm thu từng mục ở [.agents/doc/features-list.md](.agents/doc/features-list.md). V001 chưa được chốt hoàn thành.

## Chạy local bằng Docker

Cần Docker Desktop. Docker Compose chạy PostgreSQL, backend và Vite frontend; volume PostgreSQL giữ dữ liệu qua các lần restart.

```sh
./dev.sh
docker compose exec api npm run seed # chỉ chạy lần đầu, hoặc khi muốn nạp fixture
```

Compose tạo sẵn `personal_os_test` trong PostgreSQL local để chạy gate tách khỏi dữ liệu app:

```sh
DATABASE_URL='postgresql://postgres:local-only@127.0.0.1:5432/personal_os' \
TEST_DATABASE_URL='postgresql://postgres:local-only@127.0.0.1:5432/personal_os_test' \
./init.sh
```

Mở `http://localhost:4173`. Sau lần khởi tạo đầu tiên, Docker Desktop tự khởi động lại ba container nhờ `restart: unless-stopped`.

```sh
docker compose logs -f api
docker compose logs -f web
./dev-down.sh                 # dừng, không xóa dữ liệu
```

Reset dữ liệu local chỉ khi chủ động xóa volume: `docker compose down -v`.

## Chạy local thủ công

Cần Node.js 20.19+, npm và PostgreSQL. Tạo hai database riêng: một cho app, một cho test. Ví dụ có thể chạy PostgreSQL bằng Docker:

```sh
docker run -d --name personal-os-postgres -e POSTGRES_PASSWORD=local-only -e POSTGRES_DB=personal_os -p 127.0.0.1:5432:5432 postgres:17
docker exec personal-os-postgres createdb -U postgres personal_os_test
```

Tạo database test bằng `psql` hoặc công cụ quản trị PostgreSQL. Đặt URL kết nối qua môi trường, không commit mật khẩu:

```sh
export DATABASE_URL='postgresql://postgres:local-only@127.0.0.1:5432/personal_os'
export TEST_DATABASE_URL='postgresql://postgres:local-only@127.0.0.1:5432/personal_os_test'
npm ci
npm test
npm run check
npm start
```

`npm test` tạo và xóa schema riêng trong `TEST_DATABASE_URL`; tài khoản test cần quyền `CREATE` trên database đó. Server tự chạy migration khi có request DB đầu tiên. Mở `http://localhost:3000/health` để kiểm tra. `npm run seed` chỉ nạp dữ liệu mẫu khi bạn chủ động chạy; chạy lại không nhân bản dữ liệu.

Server nghe `0.0.0.0:3000` trong container; frontend dùng Vite proxy `/api`. Điện thoại cùng Wi-Fi có thể truy cập qua IP máy tính khi port bind được mở phù hợp. Chỉ dùng trong mạng tin cậy vì app chưa có xác thực.

## Dữ liệu và deploy

PostgreSQL có thể chạy local hoặc dùng dịch vụ quản lý như Neon qua Vercel Marketplace. Không đưa app tài chính lên Internet trước khi có xác thực. Khi deploy, cấu hình `DATABASE_URL` (URL có connection pooling nếu nhà cung cấp hỗ trợ) trong môi trường server; không lưu URL trong repo.

Sao lưu định kỳ bằng `pg_dump` hoặc công cụ của nhà cung cấp DB, và kiểm tra khôi phục. Cài đặt có xuất/nhập JSON; nhập sẽ tải bản hiện tại xuống trước khi ghi đè. File SQLite cũ `data/personal-os.db` hiện rỗng, được giữ nguyên nhưng không còn được sử dụng.

`./init.sh` chạy test và kiểm tra TypeScript. Xem `AGENTS.md` để tiếp tục theo giai đoạn và `DECISIONS.md` cho quyết định còn mơ hồ.

Sau khi sửa skill trong `.agents/skills`, chạy `./validate-skills.sh`. Script dùng `uv` để cấp PyYAML riêng cho validator, không cài package vào Python hệ thống.

## Vercel dev/prod

Phát triển local trên `dev` với PostgreSQL local. `vercel.json` tắt auto deploy: push không thay đổi Preview hay Production. Chỉ chạy `./deploy.sh dev` hoặc `./deploy.sh prod` khi có yêu cầu deploy riêng; script cần Vercel CLI đã đăng nhập và `jq`. Quy tắc nhánh, database, gate và aliases nằm trong [quy trình phát triển](doc/development_workflow.md).

Backend có API tài chính, mục tiêu, nhật ký và sao lưu. Xác thực và gate V001 vẫn còn thiếu trước khi dùng dữ liệu tài chính qua Internet công khai; Preview có Deployment Protection.
