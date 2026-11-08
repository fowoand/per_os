# Quy cách phát triển Personal OS

[Spec nghiệp vụ](../../doc/spec_init_001.md) là nguồn duy nhất cho công thức, dữ liệu, API, UI và 17 test. [Quy trình môi trường](../../doc/development_workflow.md) quyết định branch, database và deploy. [Trạng thái hiện tại](../state.md) ghi gate đã có bằng chứng.

Codex điều phối; `agy` với `claude-sonnet-4-6` chỉ thực hiện phần code được giao. Mỗi lượt giao một phạm vi rõ, Codex kiểm diff và chạy check. Không coi phản hồi của agent là bằng chứng test. Giữ thay đổi sẵn có và không commit/push/deploy nếu chưa được yêu cầu.

Thứ tự triển khai trong V001:

1. Core thuần cho công thức và trạng thái; 17 test độc lập ở mục 11.
2. PostgreSQL migration có đánh số, persistence transaction, API tài chính và test API.
3. UI tài chính, sao lưu/khôi phục và luồng hai tháng trên trình duyệt PC; kiểm tra responsive mobile cơ bản.
4. Mục tiêu và nhật ký với dữ liệu, API, UI, test và liên kết thật.
5. Thống kê, biểu đồ, nợ chi tiết, tối ưu mobile; nghiệm thu V001.

Mỗi gate cần `./init.sh` sau code change; bổ sung test tập trung. Ghi rõ chỗ chưa thử server, browser hoặc điện thoại. Chỉ cập nhật `../state.md` khi gate thực sự đạt. Công thức tài chính mơ hồ phải hỏi người dùng trước khi code.
