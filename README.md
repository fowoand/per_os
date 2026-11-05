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

`npm test` tạo và xóa schema riêng trong `TEST_DATABASE_URL`; tài khoản test cần quyền `CREATE` trên database đó. Server tự chạy migration khi khởi động. Mở `http://localhost:3000/health` để kiểm tra. `npm run seed` chỉ nạp dữ liệu mẫu khi bạn chủ động chạy; chạy lại không nhân bản dữ liệu.

Server nghe `0.0.0.0:3000`; điện thoại cùng Wi-Fi có thể truy cập qua IP máy tính. Chỉ dùng trong mạng tin cậy vì app chưa có xác thực. UI/PWA và truy cập điện thoại đầy đủ thuộc giai đoạn 1.

## Dữ liệu và deploy

PostgreSQL có thể chạy local hoặc dùng dịch vụ quản lý như Neon qua Vercel Marketplace. Không đưa app tài chính lên Internet trước khi có xác thực. Khi deploy, cấu hình `DATABASE_URL` (URL có connection pooling nếu nhà cung cấp hỗ trợ) trong môi trường server; không lưu URL trong repo.

Sao lưu định kỳ bằng `pg_dump` hoặc công cụ của nhà cung cấp DB, và kiểm tra khôi phục. Xuất/nhập JSON trong app thuộc giai đoạn 1. File SQLite cũ `data/personal-os.db` hiện rỗng, được giữ nguyên nhưng không còn được sử dụng.

`./init.sh` chạy test và kiểm tra TypeScript. Xem `AGENTS.md` để tiếp tục theo giai đoạn và `DECISIONS.md` cho quyết định còn mơ hồ.

## Vercel dev/prod

Hai project Vercel trong team `huangans-projects`: `personal-os-api` (Fastify) và `personal-os-web` (Vite). Cả hai đã kết nối GitHub `fowoand/per_os`, Production Branch là `main`, Root Directory để trống để CLI deploy từ từng thư mục app. `vercel.json` tắt auto deploy từ Git: push không tác động môi trường nào. Không commit `.env*`, `.vercel/` hoặc dữ liệu local.

Neon `personal-os-dev-db` chỉ gắn Preview; `personal-os-prod-db` chỉ gắn Production. Mỗi database cấp `DATABASE_URL` cho `personal-os-api`. Migration có đánh số chạy khi backend nhận request DB đầu tiên; không chạy seed trên Vercel. `VITE_APP_ENV` của web là `dev`/`prod`; `VITE_API_BASE_URL` trỏ đến backend đúng môi trường. Biến `VITE_` là công khai trong client, chỉ dùng cho URL và nhãn.

Phát triển trên nhánh `dev` với PostgreSQL local: chạy `npm start` cho API, `npm run dev -w @personal-os/web` cho web. Kiểm tra `./init.sh` với database test riêng và `npm run build -w @personal-os/web`. Sau khi commit, chạy `./deploy.sh dev` để test lại, deploy Preview và cập nhật alias `personal-os-api-dev.vercel.app`, `personal-os-web-dev.vercel.app`. Script cần Vercel CLI đăng nhập và `jq`.

Khi Preview đã đạt tiêu chí, đưa commit đã duyệt sang `main`; chỉ từ `main` mới chạy `./deploy.sh prod`. Script test trước, deploy bản Production chưa chuyển alias, kiểm tra BE/FE rồi mới promote. Production aliases: `personal-os-api-ruby.vercel.app` và `personal-os-web-fawn.vercel.app`. Script bỏ qua thay đổi skill/harness ngoài app khi kiểm tra source sạch; không tự push. Hiện web là placeholder, backend chỉ có `/health`; xác thực và 17 test giai đoạn 1 vẫn là gate trước khi dùng dữ liệu tài chính qua Internet.
