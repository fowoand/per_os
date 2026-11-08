# Project state

| Stage | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0: Foundation | Done, 2026-11-05 | PostgreSQL local: `./init.sh` (3 tests, typecheck), `npm run seed`, `npm start` (`/health` returned schema version 1) | Stage 1 business rules |
| 1: Finance | Done locally, 2026-11-08; Preview data gate pending | Migration v9; `./init.sh` với PostgreSQL test cô lập: 131 test, typecheck, UI checker qua; FE build qua. Browser local test hai tháng, export/import JSON và đổi khoản mẫu từ tháng 12. Backup PostgreSQL local đã lưu ngoài repo và thử khôi phục DB tạm; LaunchAgent 03:00 đã đăng ký. Preview thiếu `settings`; luồng thiết lập lần đầu qua xác nhận đã test local, chưa deploy. | Deploy bản sửa, người dùng nhập số dư đầu kỳ và xác nhận; sau đó kiểm tra luồng FE và rà backup Neon trước khi chứa dữ liệu thật |
| 2: Goals and journal | Done locally, 2026-11-08 | API, test và UI mục tiêu/checklist/nhật ký; browser DB test tạo mục tiêu, tick checklist, liên kết nhật ký; lịch tháng hiện ngày có bản ghi. | Xác minh Preview |
| 3: Polish | Done locally; Preview connectivity fixed 2026-11-09 | Thống kê tháng, nợ chi tiết, PWA manifest, gợi ý hũ. Browser local viewport 320/390px không tràn ngang ở Cài đặt/Nhật ký. Preview BE/FE đạt; FE gọi API cùng origin qua web function có bypass secret chỉ ở server. `/api/goals` trả 200, route lồng/query tới đúng API; manifest trả 200 qua CLI; truy cập ẩn danh vẫn chuyển SSO. Chrome có SSO và manifest thực tế chưa kiểm tra được do công cụ tab lỗi. | Refresh Chrome kiểm tra manifest/API; sau đó kiểm tra luồng tài chính khi có dữ liệu Preview |

Update this table at stage gates or when evidence changes. Check current code and rerun relevant checks before relying on old results.

## Environment workflow

- Default development branch: `dev`, local PostgreSQL only. `main` is reviewed release source.
- `vercel.json` disables automatic Git deployments for both linked Vercel projects. A push to either branch does not release code; deploy only on request through `./deploy.sh dev|prod`.
- Preview uses `personal-os-dev-db`; Production uses `personal-os-prod-db`. Both Vercel deployments have protection enabled. See `doc/development_workflow.md` for the gate and aliases.
- BE có API tài chính, mục tiêu, nhật ký và backup; FE có các luồng tương ứng. Gate local Stage 1 đã đạt; ứng dụng chưa có xác thực riêng. Preview Vercel có SSO Deployment Protection.
