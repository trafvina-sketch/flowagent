#!/bin/bash

# ==============================================================================
# FLOWAGENT AI - Cài đặt môi trường Python cho macOS (Apple Silicon & Intel)
# ==============================================================================

set -e

echo ""
echo "========================================================"
echo "    FLOWAGENT AI - Cài đặt Python cho macOS"
echo "========================================================"
echo ""

# 1. Kiểm tra Python 3
echo "[1/4] Kiểm tra Python trên máy Mac..."

PYTHON_CMD=""

if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif [ -x "/opt/homebrew/bin/python3" ]; then
    PYTHON_CMD="/opt/homebrew/bin/python3"
elif [ -x "/usr/local/bin/python3" ]; then
    PYTHON_CMD="/usr/local/bin/python3"
fi

if [ -n "$PYTHON_CMD" ]; then
    PY_VER=$($PYTHON_CMD -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')
    echo "  ✅ Đã tìm thấy: Python $PY_VER ($PYTHON_CMD)"
else
    echo "  ⚠️ Chưa tìm thấy Python 3!"
    echo "  👉 Bạn có thể cài đặt bằng Homebrew: brew install python3"
    echo "  👉 Hoặc tải bản cài macOS (.pkg) tại: https://www.python.org/downloads/macos/"
    echo ""
    
    if command -v brew &>/dev/null; then
        read -p "  Bạn có muốn tự động cài Python 3 qua Homebrew không? (y/N): " choice
        if [[ "$choice" =~ ^[Yy]$ ]]; then
            brew install python3
            PYTHON_CMD="python3"
        else
            echo "Vui lòng cài Python 3 rồi chạy lại script này."
            exit 1
        fi
    else
        echo "Vui lòng cài Python 3 rồi chạy lại script này."
        exit 1
    fi
fi

# 2. Kiểm tra pip
echo ""
echo "[2/4] Kiểm tra pip..."
$PYTHON_CMD -m ensurepip --upgrade 2>/dev/null || true
$PYTHON_CMD -m pip install --upgrade pip --quiet

# 3. Cài đặt các thư viện cần thiết cho FlowAgent
echo ""
echo "[3/4] Cài đặt các thư viện Python cho FlowAgent Backend..."

PACKAGES=(
    "fastapi"
    "uvicorn[standard]"
    "python-multipart"
    "aiofiles"
    "aiohttp"
    "httpx"
    "Pillow"
    "pywebview"
    "imageio-ffmpeg"
)

for pkg in "${PACKAGES[@]}"; do
    printf "  📦 Đang cài đặt %s... " "$pkg"
    $PYTHON_CMD -m pip install "$pkg" --quiet
    echo "✅"
done

# 4. Hoàn tất
echo ""
echo "========================================================"
echo "  ✅ CÀI ĐẶT HOÀN TẤT TRÊN MAC!"
echo "========================================================"
echo "  Bây giờ bạn có thể mở ứng dụng FlowAgent AI trên Mac."
echo "  Nếu macOS cảnh báo Gatekeeper (App is damaged/unidentified):"
echo "  Mở Terminal và chạy lệnh:"
echo "    xattr -cr /Applications/\"FlowAgent AI.app\""
echo "========================================================"
echo ""
