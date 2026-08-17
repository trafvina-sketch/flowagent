@echo off
title FlowAgent AI - Push to GitHub
color 0A

echo.
echo ======================================================
echo   FlowAgent AI - Push to GitHub Repository
echo ======================================================
echo.
echo Repository: https://github.com/trafvina-sketch/flowagent.git
echo.

git branch -M main
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ======================================================
    echo   [OK] PUSH TO GITHUB SUCCESSFUL!
    echo ======================================================
    echo.
) else (
    echo.
    echo [ERROR] Git push failed. Please check the error message above.
    echo.
)

pause
