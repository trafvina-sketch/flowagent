@echo off
chcp 65001 >nul 2>nul
title FlowAgent AI Backend Server
color 0B

echo.
echo  ========================================
echo    FlowAgent AI Backend Server Manager
echo  ========================================
echo.

:: 1. Detect Python
echo  [1/3] Đang kiểm tra Python...
set PYTHON_CMD=
py --version >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PYTHON_CMD=py
    goto :PYTHON_OK
)

python --version >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PYTHON_CMD=python
    goto :PYTHON_OK
)

python3 --version >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PYTHON_CMD=python3
    goto :PYTHON_OK
)

color 0C
echo  [X] LỖI: Không tìm thấy Python trên máy tính của bạn!
echo      Vui lòng tải và cài đặt Python 3.10+ từ: https://www.python.org/downloads/
echo      * QUAN TRỌNG: Nhớ tích chọn "Add Python to PATH" khi cài đặt!
echo.
pause
exit /b 1

:PYTHON_OK
echo  [OK] Đã tìm thấy Python:
%PYTHON_CMD% --version
echo.

:: 2. Check and install dependencies
echo  [2/3] Đang kiểm tra và cài đặt thư viện cần thiết...
cd /d "%~dp0"
if exist "backend" (
    cd backend
)

%PYTHON_CMD% -m pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    color 0E
    echo  [!] CẢNH BÁO: Cài đặt thư viện tự động có thể gặp lỗi.
    echo      Đang thử cài đặt các thư viện cốt lõi...
    %PYTHON_CMD% -m pip install fastapi uvicorn Pillow aiohttp aiofiles python-multipart httpx pywebview
)
echo  [OK] Cài đặt thư viện hoàn tất.
echo.

:: 3. Run FastAPI backend via Uvicorn
echo  [3/3] Đang khởi động máy chủ Backend (Cổng 8100)...
echo  --------------------------------------------------
%PYTHON_CMD% -m uvicorn server:app --host 0.0.0.0 --port 8100

if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo  [X] LỖI: Máy chủ Backend dừng đột ngột hoặc cổng 8100 đã bị chiếm dụng!
    pause
)
