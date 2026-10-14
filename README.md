# PhishLens

PhishLens là dự án thử nghiệm cộng đồng gồm tiện ích Chrome/Edge, website hướng dẫn và tra cứu, API nhận báo cáo cùng dashboard kiểm duyệt. Extension phân tích URL khi người dùng bấm biểu tượng; không đọc nội dung trang, biểu mẫu, mật khẩu, OTP, cookie hay lịch sử duyệt web. Kết quả giải thích dấu hiệu tham khảo, không đảm bảo phát hiện mọi website lừa đảo.

> **Cần biết tải phần nào lên đâu?** Xem [Bản đồ triển khai](DEPLOYMENT.md): kết nối repository gốc với Vercel, chạy migration/cấu hình Auth trong Supabase, và tải ZIP extension lên Chrome Web Store. Website không được tải lên Supabase.

## Phân tích AI tùy chọn

Nút **Nhờ AI phân tích thêm** chỉ chạy sau xác nhận riêng. Extension gửi hostname chuẩn hóa và mã dấu hiệu; không gửi URL đầy đủ, đường dẫn, query, fragment hay nội dung trang. API tra cảnh báo đã xác minh phía server rồi mới gọi Gemini generateContent API. AI chỉ giải thích; mức cục bộ và trạng thái cảnh báo vẫn là nguồn quyết định. Xem [chính sách riêng tư](web/privacy.html) và [hướng dẫn triển khai](DEPLOYMENT.md) để cấu hình `GEMINI_API_KEY` (chỉ ở server) cùng `GEMINI_MODEL` trên Vercel.

API mới: `POST /api/analyze` với `{ "hostname": "example.com", "signalCodes": ["http"] }`. Không gửi URL hoặc trường khác. Lời giải thích không được lưu vào Supabase. Với Gemini API free tier, Google có thể dùng prompt/phản hồi để cải thiện sản phẩm; xem điều khoản Google trước khi bật cho người dùng thật.

## Điểm rủi ro PhishLens và kiểm tra thủ công

Popup hiển thị điểm rủi ro theo quy tắc 0–100, không phải phần trăm xác suất website lừa đảo. Điểm được cộng minh bạch theo tín hiệu: giả thương hiệu/ký tự gây nhầm lẫn/địa chỉ IP/dấu @ +25; danh sách mẫu +30; HTTP/cổng lạ/rút gọn +12; tên miền dài/nhiều cấp/gạch nối/đường dẫn mã hóa/từ khóa +5 mỗi dấu hiệu; tổng tối đa 100. Dải điểm: 0–24 ít dấu hiệu được phát hiện, 25–59 cần kiểm tra thêm, 60–100 nhiều dấu hiệu đáng ngờ. Điểm thấp không có nghĩa website an toàn.

Điểm 0–100 là **điểm rủi ro PhishLens**, không phải điểm ScamAdviser, xác suất lừa đảo hay phần trăm an toàn. Điểm được cộng minh bạch theo tín hiệu: giả thương hiệu/ký tự gây nhầm lẫn/địa chỉ IP/dấu @ +25; danh sách mẫu +30; HTTP/cổng lạ/rút gọn +12; tên miền dài/nhiều cấp/gạch nối/đường dẫn mã hóa/từ khóa +5 mỗi dấu hiệu; tổng tối đa 100. Điểm thấp không có nghĩa website an toàn.

Điểm 0–100 là điểm rủi ro PhishLens dựa trên các tín hiệu URL minh bạch; đây không phải xác suất lừa đảo, điểm ScamAdviser hay kết luận website an toàn. Extension không tự gửi URL tới dịch vụ bên thứ ba. Các liên kết Scam.vn và ScamAdviser chỉ mở trang kiểm tra để bạn tự nhập tên miền; PhishLens không nhận kết quả. Không cần API key hoặc biến môi trường cho tính năng này. Xem [hướng dẫn triển khai](DEPLOYMENT.md).


## Cấu trúc

- `web/`: website công khai, cẩm nang, tra cứu, biểu mẫu gửi báo cáo, dashboard và chính sách riêng tư.
- `api/`: Vercel Functions cho API, quản trị và dọn báo cáo quá hạn.
- `src/api-handlers.js`: xử lý nghiệp vụ có thể kiểm thử độc lập.
- `supabase/migrations/`: bảng, RLS, RPC kiểm duyệt và dữ liệu Demo mẫu.
- `src/analyzer.js`: quy tắc phân tích URL của extension.
- `scripts/build-extension.mjs`: đóng gói extension với quyền host chỉ tới site Vercel đã chọn.
- `DEPLOYMENT.md`: hướng dẫn triển khai theo từng dịch vụ và đầu ra cần tải lên.

## Chuẩn bị Supabase

1. Có thể dùng dự án Supabase hiện tại; với thử nghiệm và production tách biệt, tạo hai project.
2. Chạy `supabase/migrations/202610130001_initial.sql` trong SQL Editor của dự án.
3. Tạo tài khoản Auth cho từng quản trị viên được phép. Đặt mật khẩu mạnh và bật xác minh email nếu phù hợp.
4. Không bật public signup nếu nhóm không cần tài khoản tự đăng ký. Chỉ email trong `ADMIN_EMAILS` được dùng dashboard.
5. Không mở quyền đọc/ghi `reports` hoặc `verified_alerts` cho `anon` hay `authenticated`; migration chủ động bật RLS và chỉ cấp bảng cho `service_role`.

## Chạy local

Cài Node.js 22.13 trở lên, sau đó:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Điền các giá trị của Supabase thử nghiệm vào `.env`. Dùng service role key chỉ trong môi trường server riêng; không đưa key này vào website hoặc extension. `ADMIN_EMAILS` là danh sách email phân tách bằng dấu phẩy.

```powershell
npm.cmd run dev
```

Mở địa chỉ local do Vercel CLI hiển thị. Website và Functions cùng origin. API báo lỗi cấu hình nếu thiếu biến môi trường. Cài extension local: mở `chrome://extensions` hoặc `edge://extensions`, bật Developer mode, chọn **Load unpacked** và trỏ tới thư mục dự án. Manifest local chỉ cho phép gọi API tại localhost.

## Deploy lên Vercel

1. Import repository từ thư mục gốc. `vercel.json` cấu hình website `web/`, bảo mật response headers và cron; API nằm trong `api/`.
2. Trong **Project Settings → Environment Variables**, thêm `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, `CRON_SECRET`. Không commit `.env` hoặc secrets.
3. Deploy và kiểm tra `/`, `/privacy.html`, `/admin.html`, `/api/health`, gửi báo cáo thử, kiểm duyệt và tra cứu. Dùng dữ liệu thử nghiệm, không đưa dữ liệu người dùng thật vào preview.
4. Sau khi site production có URL `https://<ten-site>.vercel.app`, kiểm tra trang chính sách riêng tư, địa chỉ email liên hệ và các URL nguồn, rồi deploy lại.
5. Dùng cùng một URL site cố định cho website và API. Nếu đổi domain sau này, cần đóng gói và phát hành extension với quyền host mới.

Dashboard sử dụng Supabase Auth. Tài khoản phải vừa tồn tại trong Supabase Auth vừa có email nằm trong `ADMIN_EMAILS`. Khóa service role chỉ được Vercel Functions sử dụng. RLS chặn người chưa đăng nhập đọc/sửa báo cáo; public lookup chỉ trả cảnh báo đã xác minh và trạng thái tổng quát khi đang có báo cáo chờ.

## Luồng báo cáo và riêng tư

- Khi gửi từ extension, popup hiển thị nguyên URL đầy đủ, gồm query và fragment, loại nghi ngờ, tên site nhận và cảnh báo query có thể chứa mã phiên/dữ liệu riêng tư. Chỉ sau nút xác nhận mới gửi; hủy thì không gọi API.
- Website cũng có hộp xem lại URL và nội dung trước khi gửi. Báo cáo gồm URL đầy đủ, loại, mô tả tùy chọn và nguồn gửi. Không đính kèm mật khẩu, OTP, cookie hay nội dung trang.
- Báo cáo mới chưa phải kết luận. Để chọn **Đã xác minh**, quản trị viên phải điền tóm tắt công khai và nguồn HTTPS đã đối chiếu. Lookup công khai hiển thị hostname, loại báo cáo, tóm tắt và liên kết nguồn; URL gốc, query/fragment, mô tả và ghi chú quản trị vẫn riêng tư.
- Báo cáo gốc được dọn sau 12 tháng bằng scheduled function. Cảnh báo công khai đã xác minh có thể tồn tại dưới dạng hostname và nội dung tóm tắt đã biên tập.

## Tra cứu email

Website có nút mở trang chính thức Have I Been Pwned (HIBP) trong tab mới. Người dùng tự nhập email tại HIBP; PhishLens không có ô nhập email cho chức năng này, không gọi API HIBP, không nhận email/kết quả và không lưu trạng thái tra cứu. Phần hướng dẫn trên PhishLens nêu cách xử lý nếu HIBP liệt kê rò rỉ và giới hạn của kết quả: đây không phải kiểm tra quyền truy cập Gmail. HIBP yêu cầu API key cho tìm kiếm email qua API và gói Pro/High RPM cho email k-anonymity, vì vậy MVP dùng liên kết thủ công tới nguồn chính thức.

## Cẩm nang tình huống

Trang chủ có bốn tình huống tổng hợp để minh họa cách giả danh ngân hàng và lấy OTP, tuyển cộng tác viên, giả danh cơ quan để dụ cài ứng dụng, và mời đầu tư trực tuyến. Chúng được ghi nhãn “Tình huống minh họa”, không mô tả một nạn nhân/vụ việc cụ thể. Mỗi câu chuyện trỏ tới khuyến cáo chính thức của Ngân hàng Nhà nước, NCSC/Bộ TT&amp;TT hoặc Bộ Công an; lời kể và các minh họa SVG do PhishLens biên soạn riêng. Sửa nội dung trong `web/stories.js`, hình minh họa nằm ở `web/images/`.

Repo extension công khai của [ChongLuaDao](https://github.com/7zones/chongluadao-extension) được tham khảo ở mức ý tưởng về giải thích cảnh báo và quy trình báo cáo/kiểm duyệt. Đây không phải mã giao diện website và PhishLens không sao chép mã, nội dung hay nhận diện của dự án đó.

Nguồn bài cẩm nang:

- [Ngân hàng Nhà nước — bảo vệ thông tin tài khoản và OTP](https://www.sbv.gov.vn/vi/web/sbv_portal/w/sbv592485)
- [NCSC — cảnh báo mạo danh sàn thương mại điện tử tuyển cộng tác viên](https://mic.gov.vn/canh-giac-thu-doan-mao-danh-san-tmdt-lua-dao-tuyen-cong-tac-vien-197154459.htm)
- [Bộ Công an — cảnh báo ứng dụng VNeID giả mạo](https://bocongan.gov.vn/bai-viet/canh-bao-thu-doan-lua-dao-cai-ung-dung-vneid-gia-mao-d104-t45880)
- [Bộ Công an — cảnh báo dụ dỗ đầu tư tài chính trực tuyến](https://bocongan.gov.vn/bai-viet/canh-bao-thu-doan-du-do-tham-gia-dau-tu-tai-chinh-san-chung-khoan-tien-ao-tren-khong-gian-mang-d104-t44828)

## Đóng gói extension cho Chrome Web Store

Sau khi biết site Vercel production:

```powershell
npm.cmd run build:extension -- --site-url=https://<ten-site>.vercel.app
```

Script tạo `dist/extension/` để cài thử và `dist/phishlens-extension.zip` để tải lên Chrome Web Store. Manifest bản phát hành chỉ khai báo host permission cho origin Vercel truyền vào; extension không cần quyền đọc mọi trang. Kiểm tra ZIP cài được trên Chrome và Edge trước khi tải lên. Trong Chrome Web Store Developer Dashboard, tạo mục mới, tải ZIP, điền mô tả/ảnh chụp, khai báo quyền và dữ liệu, thêm URL chính sách riêng tư, rồi gửi xét duyệt. Bản này chưa tự động xuất bản và không chứa khóa backend.

## API

- `GET /api/health`: health check.
- `GET /api/lookup?url=<URL-hoặc-host>`: một trong ba trạng thái **Đã được xác minh**, **Đang xem xét**, **Chưa có dữ liệu**. Không trạng thái nào có nghĩa “an toàn”.
- `POST /api/reports`: nhận `{ url, type, description?, source?, website? }`; URL HTTP(S) tối đa 2.048 ký tự, mô tả tối đa 1.000. Hỗ trợ honeypot; giới hạn tốc độ cần cấu hình trên Vercel Firewall.
- `POST /api/admin/login`, `POST /api/admin/refresh`, `POST /api/admin/logout`: phiên Supabase Auth.
- `GET /api/admin/reports`: danh sách có tìm kiếm, lọc và phân trang.
- `PATCH /api/admin/reports/:id`: đổi trạng thái qua RPC giao dịch; chỉ admin.

## Kiểm thử

```powershell
npm.cmd test
npm.cmd run build:extension -- --site-url=https://phishlens-demo.vercel.app
```

Test API dùng Supabase giả lập để kiểm tra xác thực đầu vào, giữ nguyên URL đầy đủ, ba trạng thái tra cứu, quyền admin và chuyển trạng thái; không cần secret thật. Kiểm tra giao diện website: nút HIBP mở đúng nguồn ở tab mới, không có trường email/POST gửi email, còn tra cứu URL và quy trình báo cáo nội bộ hoạt động. Kiểm thử Deploy Preview xuyên suốt cần một dự án Supabase thử nghiệm: gửi báo cáo từ extension, mở dashboard, xác minh, rồi tra cứu hostname ở website. Bài kiểm thử cục bộ không thay thế bước preview thật.

## Mẫu và giới hạn

`login-verify-example.test` và các quy tắc/tên thương hiệu trong `src/analyzer.js` là dữ liệu demo nhỏ do dự án khai báo, không phải threat feed hay danh sách cảnh báo toàn diện. Có thể thêm thương hiệu/domain mẫu tại các hằng `SAMPLE_BRANDS`, `SHORTENER_DOMAINS`, `SAMPLE_SUSPICIOUS_DOMAINS`; cập nhật test tương ứng. Không đưa hostname thật vào danh sách cảnh báo nếu chưa có nguồn và quy trình xác minh phù hợp.

PhishLens không quét trang, không xác minh danh tính chủ website, không tự chặn điều hướng và có thể cảnh báo sai hoặc bỏ sót. HTTPS mã hóa kết nối nhưng không chứng minh website thuộc tổ chức mà trang tự nhận. Dữ liệu cộng đồng do admin xác minh và nội dung demo cần được phân biệt rõ.

Khảo sát nhóm 120 người dùng để giải thích thiết kế: 54 người (45%) chưa biết dấu hiệu liên kết đáng ngờ; 94 (78,3%) chưa tự tin đánh giá tên miền; 86 (71,7%) chưa rõ HTTPS có chứng minh website an toàn không. Có 46 người muốn được nhắc không chia sẻ mật khẩu/OTP, 44 muốn xác minh qua kênh chính thức, 40 muốn tra cứu uy tín tên miền. Đây là ý kiến tự báo cáo và nhu cầu, không phải bằng chứng về độ chính xác của PhishLens.
