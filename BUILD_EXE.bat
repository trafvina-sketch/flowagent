@echo off
chcp 65001 >nul 2>nul
title FlowAgent AI - Build EXE
color 0A

echo.
echo  ========================================
echo    FlowAgent AI - Build EXE Tool
echo  ========================================
echo.
echo  Chon che do build:
echo.
echo    [1]  Quick Update  - Chi build + dong goi EXE
echo    [2]  Full Build    - Cai packages + build + dong goi EXE
echo    [3]  Package Only  - Chi dong goi EXE (da co san dist)
echo    [0]  Thoat
echo.
set /p CHOICE=  Nhap lua chon (0-3): 

if "%CHOICE%"=="0" goto :END
if "%CHOICE%"=="1" goto :QUICK
if "%CHOICE%"=="2" goto :FULL
if "%CHOICE%"=="3" goto :PACKAGE
echo.
echo  [X] Lua chon khong hop le!
pause
exit /b 1

:: ------------------------------------
:FULL
echo.
echo  =========== FULL BUILD ===========
echo.
echo  [1/3] Dang cai dat dependencies...
echo  ---------------------------------
call npm install
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo  [X] LOI: npm install that bai!
    echo     Kiem tra: node --version  ^|  npm --version
    pause
    exit /b 1
)
echo  [OK] Dependencies OK
goto :BUILD_STEP

:: ------------------------------------
:QUICK
echo.
echo  =========== QUICK UPDATE ==========
echo.
goto :BUILD_STEP

:: ------------------------------------
:BUILD_STEP
echo  [BUILD] Dang bien dich web (Vite)...
echo  ---------------------------------
call npm run build
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo  [X] LOI: Vite build that bai!
    echo     Chay "npm run build" de xem loi chi tiet.
    pause
    exit /b 1
)
echo  [OK] Vite Build OK
echo.
goto :PACKAGE

:: ------------------------------------
:PACKAGE
echo  [PACK] Dang dong goi EXE (co the mat 2-5 phut)...
echo  ---------------------------------

:: Kiem tra dist ton tai khong
if not exist "dist\index.html" (
    color 0C
    echo.
    echo  [X] LOI: Thu muc dist chua co!
    echo     Hay chon lai che do [1] Quick Update hoac [2] Full Build.
    pause
    exit /b 1
)

call npx electron-builder --win
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo  [X] LOI: Dong goi EXE that bai!
    echo.
    echo  Nguyen nhan thuong gap:
    echo    - Chua co icon tai public\icon.png
    echo    - electron-builder chua duoc cai (chay Full Build)
    echo    - Thieu quyen ghi file trong thu muc release\
    pause
    exit /b 1
)

:: ------------------------------------
:SUCCESS
color 0B
echo.
echo  ========================================
echo    [OK] BUILD THANH CONG!
echo    File EXE tai thu muc: release\
echo  ========================================
echo.

if exist "release" (
    echo  Dang mo thu muc release...
    explorer "release"
)

:END
echo.
echo  Nhan phim bat ky de dong...
pause >nul
