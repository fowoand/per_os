# Danh sách tính năng V001

Nguồn nghiệm thu: [spec gốc](../../doc/spec_init_001.md). Mốc **V001 hoàn tất ở local ngày 2026-11-08**; Preview đã deploy, luồng dữ liệu Preview còn chờ kiểm chứng. Bằng chứng trong [state](../state.md); chưa coi test hoặc build là bằng chứng luồng trình duyệt Preview.

## Tài chính

- **Đã có:** tạo tháng từ template, version số tiền, sửa một tháng/từ tháng này, dừng template, bỏ qua dòng; API và test trong `apps/server/src/routes/months.ts`, `config.ts`.
- **Đã có:** tick, trả một phần, bỏ tick; CRUD giao dịch, tìm/lọc qua API; chốt/mở lại tháng, tính khả dụng, tiết kiệm, ngân sách hũ, nghĩa vụ; core và API có test.
- **Đã có:** dashboard, nguồn thu, hũ, nợ cơ bản và trả nợ từng tháng, Dự kiến chi từ hũ Linh động; seed thủ công, migration đến v9.
- **Đã có:** UI tìm/lọc nội dung, tháng, ngày, hũ; chi tiết hũ; hoàn tác ghi nhanh; cảnh báo ngân sách; cài đặt số dư đầu kỳ; chuyển/rút tiết kiệm; thêm, dừng và đổi số tiền khoản mẫu từ tháng chọn; tổng kết tháng.
- **Đã có:** nợ chi tiết (lãi suất, lịch sử), biểu đồ và thống kê nhiều tháng, so sánh kế hoạch/thực tế. Browser DB test đã đổi số tiền khoản mẫu từ tháng 12, tháng 11 giữ nguyên.

## Mục tiêu và nhật ký

- **Đã có:** mục tiêu dài/ngắn hạn, mục tiêu cha/con, checklist, trạng thái và tiến độ theo checklist; API, test và UI. Trình duyệt DB test đã tạo mục tiêu, tick checklist và mở nhật ký liên kết.
- **Đã có:** nhật ký nhiều bản ghi mỗi ngày, tag, liên kết mục tiêu, timeline, lịch tháng đánh dấu ngày có bản ghi, tìm kiếm và tổng kết tuần/tháng. Browser DB test kiểm tra lịch 30 ngày và ngày có bản ghi.

## Trải nghiệm và dữ liệu

- **Đã có:** UI tiếng Việt cho Dashboard, Tài chính tháng, Giao dịch, Cài đặt; form nhập tắt, trạng thái tải/lỗi/rỗng và layout responsive cơ bản.
- **Đã có:** gợi ý hũ theo nội dung tương tự, manifest PWA, xuất/nhập JSON có xác nhận và tải bản hiện tại trước ghi đè, nhắc xuất sau 7 ngày.
- **Đã có:** backup PostgreSQL local lúc 03:00 bằng LaunchAgent, `pg_dump` lưu ngoài repo; một bản đã thử `pg_restore` vào DB tạm. Lịch chạy tự động thực tế lần đầu chưa đến; Preview không seed và cần rà chính sách backup Neon trước khi chứa dữ liệu thật. Manifest PWA có, chưa kiểm tra cài đặt trên thiết bị.
- **Gate local:** 17 ca mục 11 được phủ bằng core/API/DB; 130 test qua với PostgreSQL test cô lập. Hai tháng liên tiếp, export/import JSON, sửa khoản mẫu và mục tiêu–nhật ký đã kiểm tra trên trình duyệt test. PC và viewport 320/390px đã kiểm tra; điện thoại thật tùy chọn.

## Mốc phát hành

1. Gate local V001 đã đạt; cả hai alias Preview chuyển hướng SSO khi truy cập ẩn danh, Neon dev gắn đúng môi trường Preview.
2. Đã commit/push `dev` và deploy Preview BE/FE. FE gọi API qua web origin để tránh SSO chặn CORS preflight; API read route lồng/query và manifest trả đúng qua CLI. Chrome có SSO chưa kiểm tra lại. Neon dev chưa có `settings`/hũ, nên chưa xác minh luồng tài chính trên Preview. Không seed hoặc ghi đè dữ liệu Preview. Production ngoài mốc này.

## Ngoài V001 local

Đăng nhập, đồng bộ ngân hàng/SMS, AI phân loại, chatbot, đầu tư, nhiều tài khoản hoặc tiền tệ, đồng bộ cloud. Truy cập Internet cần xác thực và kiểm soát quyền riêng trước khi deploy.
