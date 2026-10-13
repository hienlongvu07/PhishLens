# Bản đồ triển khai PhishLens

PhishLens là một monorepo. Hãy kết nối **cả repository** với Netlify để Functions có thể dùng mã dùng chung trong `src/`; Netlify chỉ public website trong `web/`. Supabase không nhận source website hay extension.

## Phần nào đi đâu?

| Thành phần | Nơi cấu hình/tải lên | Nội dung cần dùng |
| --- | --- | --- |
| Website và API | Netlify | Kết nối repository gốc. `netlify.toml` đã đặt publish directory là `web/` và Functions ở `netlify/functions/`. Build command để trống. |
| Cơ sở dữ liệu và đăng nhập quản trị | Supabase | Tạo project, chạy migration trong `supabase/migrations/202610130001_initial.sql` bằng SQL Editor và tạo tài khoản Auth cho quản trị viên. |
| Bí mật backend | Netlify Environment variables | Đặt `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS` trong Site configuration. Không commit `.env`; không đặt service role key trong `web/` hoặc extension. |
| Tiện ích Chrome/Edge | Chrome Web Store; Edge Add-ons nếu phát hành Edge riêng | Tạo gói ZIP bằng lệnh dưới đây rồi tải ZIP lên trang quản lý nhà phát triển của cửa hàng. Không tải extension lên Supabase hoặc thư mục publish của Netlify. |

## Lần triển khai đầu

1. **Supabase:** tạo project thử nghiệm; chạy file migration nêu trên. Tạo tài khoản Auth cho quản trị viên và ghi lại URL cùng các key cần cấu hình.
2. **Netlify:** kết nối repository Git ở thư mục gốc. Giữ build command trống; `netlify.toml` định tuyến website và Functions. Thêm bốn biến môi trường ở bảng trên. Dùng project Supabase thử nghiệm cho Deploy Preview.
3. **Kiểm tra web/API:** mở Deploy Preview và kiểm tra `/`, `/privacy.html`, `/admin.html`, `/api/health`; thử báo cáo, đăng nhập quản trị, kiểm duyệt và tra cứu.
4. **Đóng gói extension:** dùng origin HTTPS cố định của site Netlify. Ví dụ:

   ```powershell
   npm.cmd run build:extension -- --site-url=https://phishlens-demo.netlify.app
   ```

   Lệnh tạo `dist/extension/` để cài thử bằng Developer mode và `dist/phishlens-extension.zip` để nộp lên Chrome Web Store. ZIP được đóng gói với host permission chỉ tới origin đã truyền vào.
5. **Cửa hàng:** kiểm tra gói bằng Load unpacked trên Chrome/Edge. Sau đó tải ZIP lên Chrome Web Store Developer Dashboard, điền mô tả, ảnh, chính sách riêng tư và khai báo dữ liệu/quyền, rồi gửi xét duyệt. Phát hành Edge riêng thì dùng cửa hàng Edge Add-ons.

## Chạy local

```powershell
npm.cmd install
Copy-Item .env.example .env
# Điền giá trị Supabase thử nghiệm vào .env; không dùng service role key ở client.
npm.cmd run dev
```

Netlify CLI phục vụ website và Functions tại `http://localhost:8888`. Nạp extension local từ thư mục gốc tại `chrome://extensions` hoặc `edge://extensions` sau khi bật Developer mode; bản manifest local chỉ kết nối API localhost.

## Những điều cần nhớ

- Netlify cần **repository gốc**, không chọn `web/` làm Base directory; `web/` là publish directory chứ không chứa source Functions.
- Supabase chỉ lưu dữ liệu và cấu hình Auth. SQL migration được chạy trong Supabase SQL Editor; khóa bí mật backend đặt trong Netlify.
- Nếu đổi domain Netlify, build lại extension với `--site-url` mới và phát hành phiên bản mới để cập nhật quyền host.
- Chỉ kiểm thử bằng dữ liệu mẫu trên preview. Báo cáo thử nghiệm cũng được lưu trong Supabase đã cấu hình.
- Với lệnh build extension, thay URL ví dụ bằng URL HTTPS production trước khi phát hành công khai.
