# Spec phát triển V001

V001 là bản local một người dùng, đủ toàn bộ tính năng trong [spec gốc](../../doc/spec_init_001.md) mục 5–9 và giai đoạn 2–3 mục 12. Đây là mục tiêu phiên bản, không phải trạng thái hiện tại. [Features list](features-list.md) là chỉ mục phạm vi; chi tiết và tiêu chí nghiệm thu vẫn theo spec gốc.

## Phạm vi phải chạy được

- Tài chính: tháng tự sinh, template có version, mọi trạng thái thanh toán, giao dịch thật, hũ/ngân sách, tiết kiệm, nợ, chốt/mở tháng, tổng hợp và thống kê.
- Mục tiêu: cây mục tiêu, milestone/checklist, tiến độ tính từ việc đã hoàn thành.
- Nhật ký: nhiều bản ghi trong ngày, tag, tìm kiếm, lịch/timeline, liên kết mục tiêu và tổng kết.
- Sử dụng: UI tiếng Việt responsive, PWA, ghi nhanh, sao lưu/khôi phục JSON an toàn, migration không mất dữ liệu.

## Gate nghiệm thu

1. 17 test tài chính độc lập qua trước UI của các quy tắc đó; API có test lỗi, transaction và idempotency.
2. Hai tháng liên tiếp tính đúng mà không nhập lại khoản mẫu hoặc nhân đôi; số dư sau sửa tháng cũ cập nhật.
3. Ghi giao dịch trên trình duyệt PC; các luồng tài chính, mục tiêu, nhật ký hoạt động thật; viewport mobile không vỡ bố cục.
4. Export rồi import lại cho dữ liệu tương đương; trước ghi đè có bản sao lưu hiện tại và xác nhận rõ.
5. Test/typecheck, server và trình duyệt được báo riêng; điện thoại thật là kiểm tra tùy chọn. V001 chưa gọi là hoàn thành nếu thiếu bằng chứng bắt buộc.

Không triển khai truy cập Internet công khai khi chưa có xác thực. Deploy là yêu cầu riêng.
