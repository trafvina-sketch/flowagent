#!/bin/bash

# ==============================================================================
# FLOWAGENT AI - Script đóng gói macOS (DMG & ZIP) cho Apple Silicon & Intel
# ==============================================================================

set -e

echo ""
echo "========================================================"
echo "    FlowAgent AI - macOS Package Builder (.dmg / .zip)"
echo "========================================================"
echo ""
echo "Chọn kiến trúc máy Mac muốn đóng gói:"
echo "  [1] Universal (Chạy được cả Apple Silicon M1-M4 & Intel Mac - Khuyên dùng)"
echo "  [2] Apple Silicon (arm64 - M1, M2, M3, M4)"
echo "  [3] Intel Mac (x64)"
echo "  [0] Thoát"
echo ""

read -p "Nhập lựa chọn (0-3): " choice

case $choice in
    1)
        echo ""
        echo "🚀 Đang build phiên bản Universal (M1/M2/M3/M4 & Intel)..."
        npm run build
        npx electron-builder --mac --universal
        ;;
    2)
        echo ""
        echo "🚀 Đang build phiên bản Apple Silicon (arm64)..."
        npm run build
        npx electron-builder --mac --arm64
        ;;
    3)
        echo ""
        echo "🚀 Đang build phiên bản Intel Mac (x64)..."
        npm run build
        npx electron-builder --mac --x64
        ;;
    0)
        echo "Đã thoát."
        exit 0
        ;;
    *)
        echo "Lựa chọn không hợp lệ!"
        exit 1
        ;;
esac

echo ""
echo "========================================================"
echo "  ✅ BUILD MACOS HOÀN TẤT!"
echo "  File kết quả (.dmg, .zip) nằm trong thư mục: release/"
echo "========================================================"
echo ""
