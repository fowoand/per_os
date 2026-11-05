# Personal OS

Web tài chính cá nhân. Giai đoạn 0 có schema PostgreSQL, seed mẫu và server `/health`; chưa có UI hay API tài chính.

## Chạy local

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

Server nghe `0.0.0.0:3000`; điện thoại cùng Wi-Fi có thể truy cập qua IP máy tính. Chỉ dùng trong mạng tin cậy vì app chưa có xác thực. UI/PWA và truy cập điện thoại đầy đủ thuộc giai đoạn 1.

## Dữ liệu và deploy

PostgreSQL có thể chạy local hoặc dùng dịch vụ quản lý như Neon qua Vercel Marketplace. Không đưa app tài chính lên Internet trước khi có xác thực. Khi deploy, cấu hình `DATABASE_URL` (URL có connection pooling nếu nhà cung cấp hỗ trợ) trong môi trường server; không lưu URL trong repo.

Sao lưu định kỳ bằng `pg_dump` hoặc công cụ của nhà cung cấp DB, và kiểm tra khôi phục. Xuất/nhập JSON trong app thuộc giai đoạn 1. File SQLite cũ `data/personal-os.db` hiện rỗng, được giữ nguyên nhưng không còn được sử dụng.

`./init.sh` chạy test và kiểm tra TypeScript. Xem `AGENTS.md` để tiếp tục theo giai đoạn và `DECISIONS.md` cho quyết định còn mơ hồ.

## Vercel dev/prod

Phát triển local trên `dev` với PostgreSQL local. `vercel.json` tắt auto deploy: push không thay đổi Preview hay Production. Chỉ chạy `./deploy.sh dev` hoặc `./deploy.sh prod` khi có yêu cầu deploy riêng; script cần Vercel CLI đã đăng nhập và `jq`. Quy tắc nhánh, database, gate và aliases nằm trong [quy trình phát triển](doc/development_workflow.md).

Hiện web là placeholder, backend chỉ có `/health`. Xác thực và 17 test giai đoạn 1 vẫn là gate trước khi dùng dữ liệu tài chính qua Internet.
