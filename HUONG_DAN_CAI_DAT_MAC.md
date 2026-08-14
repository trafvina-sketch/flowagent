# 🍎 HƯỚNG DẪN CÀI ĐẶT & SỬ DỤNG FLOWAGENT AI TRÊN MACOS (M1/M2/M3/M4 & INTEL)

Tài liệu này hướng dẫn chi tiết từng bước cho người dùng máy Mac (MacBook, Mac Mini, iMac, Mac Studio) cài đặt và sử dụng phần mềm **FlowAgent AI**.

---

## 📌 MỤC LỤC
1. [Bước 1: Cài đặt ứng dụng FlowAgent AI (.dmg)](#bước-1-cài-đặt-ứng-dụng-flowagent-ai-dmg)
2. [Bước 2: Xử lý cảnh báo bảo mật macOS (Gatekeeper)](#bước-2-xử-lý-cảnh-báo-bảo-mật-macos-gatekeeper---quan-trọng)
3. [Bước 3: Cài đặt môi trường Python Backend](#bước-3-cài-đặt-môi-trường-python-backend-cho-flow-studio)
4. [Bước 4: Cài đặt FlowKit Extension trên Google Chrome](#bước-4-cài-đặt-flowkit-extension-trên-trình-duyệt-chrome)
5. [Khắc phục các lỗi thường gặp](#khắc-phục-các-lỗi-thường-gặp)

---

## 🚀 Bước 1: Cài đặt ứng dụng FlowAgent AI (.dmg)

1. Tải về file cài đặt có đuôi **`.dmg`** (ví dụ: `FlowAgent AI-1.0.0-arm64.dmg` cho chip M1-M4 hoặc `FlowAgent AI-1.0.0.dmg` cho chip Intel).
2. **Nhấp đúp chuột** vào file `.dmg` để mở.
3. Trong cửa sổ vừa hiện ra, dùng chuột **kéo icon FlowAgent AI** thả vào thư mục **Applications (Ứng dụng)**.
4. Đợi quá trình sao chép hoàn tất (mất khoảng 10-20 giây).

---

## ⚠️ Bước 2: Xử lý cảnh báo bảo mật macOS (Gatekeeper - QUAN TRỌNG)

> **Lý do:** Do ứng dụng là phần mềm nội bộ/chuyên dụng chưa đăng ký chứng chỉ thương mại hàng năm của Apple ($99/năm), cơ chế Gatekeeper của macOS sẽ hiện cảnh báo khi bạn mở lần đầu:
> * *"FlowAgent AI is damaged and can't be opened. You should move it to the Trash"* 
> * Hoặc *"Không thể mở vì nhà phát triển không được xác minh"*.

### 👉 Cách mở khóa trong 3 giây (Làm 1 lần duy nhất):

1. Mở ứng dụng **Terminal** trên Mac (Bấm tổ hợp phím `Command + Space`, gõ `Terminal` rồi nhấn `Enter`).
2. Dán dòng lệnh sau vào cửa sổ Terminal và nhấn `Enter`:
   ```bash
   xattr -cr /Applications/"FlowAgent AI.app"
   ```
3. *(Nếu hệ thống yêu cầu quyền quản trị, chạy thêm lệnh: `sudo xattr -rd com.apple.quarantine /Applications/"FlowAgent AI.app"` và nhập mật khẩu mở máy Mac)*.
4. **Xong!** Bây giờ bạn có thể mở ứng dụng `FlowAgent AI` trực tiếp từ Launchpad hoặc thư mục Applications một cách mượt mà.

---

## 🐍 Bước 3: Cài đặt môi trường Python Backend (cho Flow Studio)

FlowAgent AI tích hợp hệ thống xử lý video/âm thanh và sinh ảnh tự động thông qua Python Backend. Bạn chỉ cần cài đặt môi trường 1 lần:

### Cách A: Cài đặt tự động bằng Script (Khuyên dùng)
1. Mở ứng dụng **Terminal**.
2. Kéo file **`setup_python.sh`** thả vào cửa sổ Terminal rồi nhấn **`Enter`**.
3. Script sẽ tự động:
   * Kiểm tra Python 3 trên máy Mac.
   * Cài đặt các thư viện lõi: `fastapi`, `uvicorn`, `imageio-ffmpeg`, `aiofiles`, `httpx`, `Pillow`...

### Cách B: Cài đặt thủ công qua Homebrew / Terminal
Nếu bạn quen dùng dòng lệnh Terminal:
```bash
# 1. Cài đặt Python 3 (nếu máy chưa có)
brew install python3

# 2. Cài đặt các thư viện cần thiết cho FlowAgent
pip3 install fastapi "uvicorn[standard]" python-multipart aiofiles aiohttp httpx Pillow pywebview imageio-ffmpeg
```

---

## 🔌 Bước 4: Cài đặt FlowKit Extension trên Trình duyệt Chrome

Để FlowAgent AI đồng bộ và điều khiển tác vụ tự động trên tài khoản Flow / Google:

1. Mở trình duyệt **Google Chrome** trên máy Mac.
2. Truy cập vào địa chỉ: `chrome://extensions/`
3. Bật công tắc **Developer mode (Chế độ dành cho nhà phát triển)** ở góc trên bên phải.
4. Nhấp nút **Load unpacked (Tải tiện ích đã giải nén)** ở góc trái.
5. Chọn thư mục **`flowkit_extension`** đi kèm với bộ cài đặt.
6. Extension sẽ kết nối với FlowAgent AI thông qua cổng nội bộ `ws://localhost:8100/ws/flowkit`.

---

## 🛠️ Khắc phục các lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
| :--- | :--- | :--- |
| **"App is damaged..."** | Cơ chế Gatekeeper cách ly file tải từ Internet | Mở Terminal chạy: `xattr -cr /Applications/"FlowAgent AI.app"` |
| **Báo thiếu Python khi mở app** | Chưa cài Python 3 hoặc chưa có trong PATH | Cài đặt Python 3 qua [python.org/downloads/macos](https://www.python.org/downloads/macos/) hoặc lệnh `brew install python3` |
| **Lỗi ghép nối video (FFmpeg)** | Chưa cài gói `imageio-ffmpeg` | Mở Terminal chạy: `pip3 install imageio-ffmpeg` |
| **Không kết nối được Extension** | Cổng 8100 bị chặn hoặc chưa bật backend | Tắt app và mở lại, ứng dụng sẽ tự động kích hoạt backend và giải phóng cổng |

---
Chúc bạn có những trải nghiệm sáng tạo nội dung AI tuyệt vời cùng **FlowAgent AI** trên macOS!
