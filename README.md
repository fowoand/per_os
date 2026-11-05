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

Hai project Vercel trong team `huangans-projects`: `personal-os-api` (deploy từ `apps/server`) và `personal-os-web` (deploy từ `apps/web`). Nhánh `dev` dành cho Preview, nhánh `main` dành cho Production. Hiện deploy bằng CLI từ từng thư mục app; Git push chưa kích hoạt deploy vì tài khoản Vercel chưa kết nối GitHub. Không commit `.env*`, `.vercel/` hoặc dữ liệu local.

Neon `personal-os-dev-db` chỉ gắn Preview; `personal-os-prod-db` chỉ gắn Production. Mỗi database cấp `DATABASE_URL` cho `personal-os-api`. Migration có đánh số chạy khi backend nhận request DB đầu tiên; không chạy seed trên Vercel. `VITE_APP_ENV` của web là `dev`/`prod`; `VITE_API_BASE_URL` trỏ đến backend đúng môi trường. Biến `VITE_` là công khai trong client, chỉ dùng cho URL và nhãn.

Sau khi kiểm tra code, deploy Preview bằng `vercel deploy --environment preview --scope huangans-projects --yes` trong `apps/server` rồi `apps/web`. Gán lại alias `personal-os-api-dev.vercel.app` và `personal-os-web-dev.vercel.app` cho URL Preview mới bằng `vercel alias set <deployment-url> <alias> --scope huangans-projects`. Sau khi kiểm tra Preview, deploy Production bằng `vercel deploy --prod --scope huangans-projects --yes` trong từng thư mục. Production aliases: `personal-os-api-ruby.vercel.app` và `personal-os-web-fawn.vercel.app`. `vercel curl <url>/health` kiểm tra API có Deployment Protection.

Để bật deploy tự động theo push, kết nối GitHub trong tài khoản Vercel rồi kết nối repo `fowoand/per_os` cho cả hai project. Khi đó đặt Root Directory lần lượt `apps/server`, `apps/web` và Production Branch `main`; push `dev` tạo Preview, push `main` tạo Production.

Local: chạy `npm start` cho API, `npm run dev -w @personal-os/web` cho web. Trước khi push, chạy `./init.sh` với database test riêng và `npm run build -w @personal-os/web`. Kiểm tra Preview trước khi nhập thay đổi vào `main`. Hiện web là placeholder, backend chỉ có `/health`; xác thực và 17 test giai đoạn 1 vẫn là gate trước khi dùng dữ liệu tài chính qua Internet.
