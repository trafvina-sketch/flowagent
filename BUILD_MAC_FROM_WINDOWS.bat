@echo off
chcp 65001 >nul 2>nul
title FlowAgent AI - Build macOS Package
color 0B

echo.
echo  ======================================================
echo    FlowAgent AI - Đóng gói phiên bản macOS
echo  ======================================================
echo.
echo  LƯU Ý QUAN TRỌNG VỀ ĐÓNG GÓI CHO MAC TỪ WINDOWS:
echo.
echo  1. macOS KHÔNG sử dụng file đuôi .exe (chuẩn Windows)
echo     mà dùng file .dmg (Disk Image) hoặc .app (macOS App).
echo.
echo  2. Có 2 cách tốt nhất để tạo file cài đặt cho máy Mac:
echo     [A] Tự động build bằng GitHub Actions (Khuyên dùng - 100%% chuẩn):
echo         - Đẩy code lên GitHub repository
echo         - Vào tab Actions -> chọn "Build FlowAgent AI for macOS" -> Run workflow
echo         - GitHub sẽ cấp máy Mac thật để build file .dmg và cho tải về trực tiếp!
echo.
echo     [B] Chạy build trực tiếp trên máy Mac:
echo         - Copy thư mục source sang máy Mac
echo         - Chạy file: ./build_mac.sh
echo.
echo     [C] Thử đóng gói macOS ZIP / DMG trực tiếp từ Windows:
echo         - Sẽ chạy: npm run dist:mac
echo.
echo  ------------------------------------------------------
echo  Bạn có muốn thử đóng gói macOS ngay trên Windows không?
echo.
echo    [1] Build macOS ngay trên Windows (yêu cầu mạng để tải macOS toolchain)
echo    [2] Thoát
echo.
set /p CHOICE=  Nhập lựa chọn (1-2): 

if "%CHOICE%"=="1" (
    echo.
    echo  Đang build Vite và đóng gói macOS...
    call npm run dist:mac
    echo.
    if %ERRORLEVEL% EQU 0 (
        echo  [OK] Hoàn tất! Kiểm tra thư mục release\
        if exist "release" explorer "release"
    ) else (
        echo  [!] Lưu ý: Để tạo DMG native hoàn hảo nhất, hãy sử dụng GitHub Actions
        echo      hoặc chạy lệnh npm run dist:mac trực tiếp trên máy Mac!
    )
)

echo.
pause
