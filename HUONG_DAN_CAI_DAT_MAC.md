# 🍎 Hướng dẫn Đóng gói & Chạy FlowAgent AI trên macOS

## 1. 💡 Khái niệm: File "EXE" trên Mac là gì?
Trên hệ điều hành **macOS (MacBook, Mac Mini, iMac, Mac Studio)**:
- Không sử dụng định dạng `.exe` (vì `.exe` là định dạng độc quyền của Microsoft Windows).
- macOS sử dụng định dạng gói cài đặt **`.dmg`** (Apple Disk Image) hoặc ứng dụng **`.app`** (macOS Application Bundle) hoặc file nén **`.zip`** chứa `.app`.
- Khi người dùng Mac cài ứng dụng, họ chỉ cần mở file `.dmg` và kéo biểu tượng ứng dụng vào thư mục **Applications**.

---

## 2. 🛠️ Cách Đóng gói (Build) Bản Cài Đặt cho Mac

### Cách 1: Sử dụng GitHub Actions (Khuyên dùng nhất — Miễn phí & Chuẩn 100%)
Do đóng gói cho macOS chuẩn nhất cần môi trường hệ điều hành macOS (đặc biệt là tạo file `.dmg`), dự án đã tích hợp sẵn GitHub Actions trong file [`.github/workflows/build-mac.yml`](file:///.github/workflows/build-mac.yml).

1. Đẩy mã nguồn dự án lên GitHub repository của bạn.
2. Mở GitHub trên trình duyệt -> Vào tab **Actions**.
3. Chọn workflow **"Build FlowAgent AI for macOS"** -> Bấm nút **Run workflow**.
4. GitHub sẽ tự động khởi tạo máy Mac trên đám mây, biên dịch và đóng gói hoàn chỉnh cả 2 phiên bản:
   - **Apple Silicon (`arm64`)**: Dành cho chip M1, M2, M3, M4...
   - **Intel (`x64`)**: Dành cho các dòng Mac chip Intel đời cũ.
5. Sau khi build xong (khoảng 3-5 phút), bạn vào mục **Artifacts** tải file `.dmg` / `.zip` về để phân phối cho khách hàng.

---

### Cách 2: Đóng gói trực tiếp trên máy Mac
Nếu bạn hoặc đồng nghiệp có máy Mac:
1. Mở Terminal tại thư mục dự án `flowagent`.
2. Cấp quyền thực thi cho script:
   ```bash
   chmod +x build_mac.sh
   ./build_mac.sh
   ```
3. Hoặc chạy lệnh npm:
   ```bash
   # Build cho Apple Silicon (M1/M2/M3/M4)
   npm run dist:mac:arm64

   # Build cho Intel Mac
   npm run dist:mac:x64

   # Build Universal (chạy mọi loại Mac)
   npm run dist:mac:universal
   ```
4. File `.dmg` và `.zip` hoàn chỉnh sẽ nằm trong thư mục `release/`.

---

### Cách 3: Đóng gói thử nghiệm từ Windows
Bạn có thể chạy file [`BUILD_MAC_FROM_WINDOWS.bat`](file:///BUILD_MAC_FROM_WINDOWS.bat) hoặc gõ lệnh:
```bash
npm run dist:mac
```

---

## 3. 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy trên Máy Mac (Cho Người Dùng)

### Bước 1: Cài đặt Python trên Mac
FlowAgent AI có backend Python FastAPI tự động. Người dùng Mac chỉ cần:
1. Mở Terminal trên Mac.
2. Chạy file script cài đặt tự động:
   ```bash
   chmod +x setup_python.sh
   ./setup_python.sh
   ```
   *(Script sẽ tự động kiểm tra Python 3 và cài đặt đầy đủ các thư viện `fastapi`, `uvicorn`, `imageio-ffmpeg`, `aiofiles`, v.v.)*

### Bước 2: Cài đặt ứng dụng FlowAgent AI
1. Mở file `FlowAgent AI.dmg`.
2. Kéo icon `FlowAgent AI` thả vào thư mục `Applications`.
3. Mở ứng dụng từ Launchpad hoặc thư mục Applications.

---

## 4. ⚠️ Xử Lý Cảnh Báo Bảo Mật macOS (Gatekeeper)
Vì ứng dụng chưa đăng ký chứng chỉ trả phí hàng năm từ Apple ($99/năm của Apple Developer ID), macOS sẽ hiển thị cảnh báo bảo mật:
> *"FlowAgent AI is damaged and can't be opened"* hoặc *"Không thể mở vì nhà phát triển không được xác minh"*.

**Cách xử lý 1 lần duy nhất trong 3 giây:**
1. Mở ứng dụng **Terminal** trên máy Mac.
2. Dán lệnh sau và nhấn **Enter**:
   ```bash
   xattr -cr /Applications/"FlowAgent AI.app"
   ```
3. Sau đó mở lại ứng dụng bình thường!

---

## 5. 🔌 Cài Đặt FlowKit Extension trên Trình Duyệt Chrome của Mac
1. Mở Chrome trên Mac -> Truy cập `chrome://extensions/`.
2. Bật công tắc **Developer mode** ở góc phải trên.
3. Nhấp **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục `flowkit_extension` để kết nối WebSocket với FlowAgent AI.
