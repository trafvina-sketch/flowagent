@echo off
chcp 65001 >nul 2>&1
title Cài đặt Python cho FlowAgent AI
color 0B

echo.
echo  ================================════════════════════════════
echo    FLOWAGENT AI - TỰ ĐỘNG TẢI & CÀI ĐẶT PYTHON CHO MÁY KHÁCH
echo  ================================════════════════════════════
echo.
echo  Đang khởi chạy tiến trình Powershell để tải và cài đặt Python...
echo  Vui lòng đợi cho đến khi có thông báo hoàn tất.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_python.ps1"

echo.
echo  Tiến trình kết thúc.
pause
