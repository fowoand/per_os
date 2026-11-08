# Project state

| Stage | State | Evidence | Next gate |
| --- | --- | --- | --- |
| 0: Foundation | Done, 2026-11-05 | PostgreSQL local: `./init.sh` (3 tests, typecheck), `npm run seed`, `npm start` (`/health` returned schema version 1) | Stage 1 business rules |
| 1: Finance | Done locally, 2026-11-08; Preview data gate pending | Migration v9; `./init.sh` với PostgreSQL test cô lập: 129 test, typecheck, UI checker qua; FE build qua. Browser local test hai tháng, export/import JSON và đổi khoản mẫu từ tháng 12. Backup PostgreSQL local đã lưu ngoài repo và thử khôi phục DB tạm; LaunchAgent 03:00 đã đăng ký. Preview `/api/settings` trả 404, chưa có hũ; không seed theo ràng buộc phát hành. | Chuẩn bị dữ liệu Preview có kiểm soát rồi kiểm tra luồng FE; rà backup Neon trước khi chứa dữ liệu thật |
| 2: Goals and journal | Done locally, 2026-11-08 | API, test và UI mục tiêu/checklist/nhật ký; browser DB test tạo mục tiêu, tick checklist, liên kết nhật ký; lịch tháng hiện ngày có bản ghi. | Xác minh Preview |
| 3: Polish | Done locally, 2026-11-08; Preview deployed | Thống kê tháng, nợ chi tiết, PWA manifest, gợi ý hũ. Browser local viewport 320/390px không tràn ngang ở Cài đặt/Nhật ký. Preview build BE/FE đạt; API `/health` schema v9, FE HTML/bundle tải được, CORS preflight 204; hai alias trả 302 sang Vercel SSO khi truy cập ẩn danh. Chưa kiểm tra trình duyệt Preview có SSO vì DB thiếu dữ liệu nền. | Kiểm tra luồng Preview sau khi có dữ liệu thử và phiên SSO |

Update this table at stage gates or when evidence changes. Check current code and rerun relevant checks before relying on old results.

## Environment workflow

- Default development branch: `dev`, local PostgreSQL only. `main` is reviewed release source.
- `vercel.json` disables automatic Git deployments for both linked Vercel projects. A push to either branch does not release code; deploy only on request through `./deploy.sh dev|prod`.
- Preview uses `personal-os-dev-db`; Production uses `personal-os-prod-db`. Both Vercel deployments have protection enabled. See `doc/development_workflow.md` for the gate and aliases.
- BE có API tài chính, mục tiêu, nhật ký và backup; FE có các luồng tương ứng. Gate local Stage 1 đã đạt; ứng dụng chưa có xác thực riêng. Preview Vercel có SSO Deployment Protection.
