# Bản đồ triển khai PhishLens

PhishLens là monorepo. Kết nối toàn bộ repository với Vercel từ thư mục gốc. Vercel phục vụ website tĩnh trong `web/` và các API trong `api/`. Supabase chỉ lưu dữ liệu và tài khoản quản trị; không tải source website hay extension lên Supabase.

## Thành phần và nơi cấu hình

| Thành phần | Nơi | Cấu hình |
| --- | --- | --- |
| Website | Vercel | Root Directory là repository root; Output Directory là `web`. `vercel.json` đã khai báo. |
| API và tác vụ định kỳ | Vercel Functions | Các route nằm trong `api/`; cron dọn báo cáo khai báo trong `vercel.json`. |
| Cơ sở dữ liệu và Auth | Supabase | Giữ project hiện có; không cần chạy lại migration khi chuyển hosting. |
| Bí mật backend | Vercel → Project Settings → Environment Variables | Khai báo `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, `CRON_SECRET`. Đánh dấu `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS` và `CRON_SECRET` là nhạy cảm. |
| Extension | Chrome Web Store | Build ZIP riêng với domain Vercel; không tải extension lên Vercel hay Supabase. |

## Deploy lên Vercel

1. Đưa các thay đổi mới nhất lên GitHub/Git repository, rồi tạo project Vercel bằng cách import repository đó. Đặt **Root Directory** là thư mục gốc; Framework Preset chọn **Other** nếu được hỏi. Giữ Install Command mặc định; không cần Build Command cho website tĩnh.
2. Trong **Project Settings → Environment Variables**, thêm năm biến ở bảng trên cho Production và Preview nếu dùng. `SUPABASE_URL` cùng hai API key phải lấy từ cùng project Supabase; `ADMIN_EMAILS` phải trùng email Auth quản trị. `CRON_SECRET` là chuỗi ngẫu nhiên dài, không dùng lại mật khẩu tài khoản.
3. Deploy lại sau khi lưu biến môi trường. Mở `/`, `/privacy.html`, `/admin.html` và `/api/health`. Tiếp đó thử `/api/lookup?url=https%3A%2F%2Flogin-verify-example.test`, gửi báo cáo demo, rồi xem dashboard.
4. Nếu Function lỗi, xem **Vercel → Project → Logs** và lọc function `/api/reports` hoặc `/api/admin/login`. Phần này không cần Supabase Audit Logs.
5. Trên **Vercel → Firewall**, thêm quy tắc rate limit cho API. Hobby chỉ có một quy tắc rate limit cho mỗi project, vì vậy dùng một ngưỡng chung cho `/api/*` (ví dụ 60 request/phút); giới hạn này không tương đương chính xác với các ngưỡng riêng của Netlify. Gói Pro cho phép nhiều quy tắc riêng hơn. Honeypot trong biểu mẫu vẫn là lớp chống bot cơ bản.
6. Xác nhận email liên hệ quyền riêng tư trong `web/privacy.html` còn hoạt động trước khi phát hành chính thức.

## Supabase

Khi chuyển hosting, giữ nguyên cơ sở dữ liệu, migration, tài khoản Auth và các báo cáo đang có. Trong Supabase, không cần đổi URL hay key nếu project vẫn là project cũ. Chỉ chuyển các biến môi trường server sang Vercel; tuyệt đối không đưa service role key vào `web/` hay extension.

## Build và cài extension

Sau khi biết domain Vercel production, build extension để giới hạn host permission đúng domain:

```powershell
npm.cmd install
npm.cmd run build:extension -- --site-url=https://<ten-project>.vercel.app
```

Lệnh tạo `dist/extension/` để cài thử bằng Developer mode và `dist/phishlens-extension.zip` để nộp lên Chrome Web Store. Nếu đổi domain sau này, build và phát hành phiên bản extension mới.

## Chạy local

```powershell
npm.cmd install
Copy-Item .env.example .env.local
# Điền giá trị Supabase thử nghiệm vào .env.local; không commit file này.
npm.cmd run dev
```

Lệnh dev dùng Vercel CLI. Thêm `CRON_SECRET` vào biến môi trường local nếu cần thử route dọn báo cáo. Không gọi route này bằng tay trên production.

## Lưu ý bảo mật và kiểm thử

- Báo cáo gửi lên Supabase thật sẽ nằm trong database thật; dùng URL demo khi thử.
- `GET /api/health` chỉ xác nhận Function phản hồi, không xác nhận Supabase hoạt động. Hãy thử tra cứu và gửi một báo cáo demo.
- Dashboard cần tài khoản Supabase Auth có email nằm trong `ADMIN_EMAILS`.
- Báo cáo chỉ được công khai sau khi quản trị viên xác minh với nguồn HTTPS đáng tin cậy.
- Kết quả “chưa có dữ liệu” không có nghĩa website an toàn.
