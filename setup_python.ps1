$ErrorActionPreference = "Continue"
$baseDir = $env:MYDIR
if (-not $baseDir) { $baseDir = (Get-Location).Path }

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   FLOWAGENT AI - Cài đặt Python cho Flow Studio     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Bước 1: Kiểm tra Python ──
Write-Host "[1/4] Kiểm tra Python..." -ForegroundColor Yellow

$pythonCmd = $null
$pythonVersion = $null

# Thử 'py' launcher
try {
    $ver = & py --version 2>&1
    if ($ver -match "Python (\d+\.\d+\.\d+)") {
        $pythonCmd = "py"
        $pythonVersion = $Matches[1]
    }
} catch {}

# Thử 'python'
if (-not $pythonCmd) {
    try {
        $ver = & python --version 2>&1
        if ($ver -match "Python (\d+\.\d+\.\d+)") {
            $pythonCmd = "python"
            $pythonVersion = $Matches[1]
        }
    } catch {}
}

# Thử 'python3'
if (-not $pythonCmd) {
    try {
        $ver = & python3 --version 2>&1
        if ($ver -match "Python (\d+\.\d+\.\d+)") {
            $pythonCmd = "python3"
            $pythonVersion = $Matches[1]
        }
    } catch {}
}

if ($pythonCmd) {
    Write-Host "  ✅ Đã tìm thấy: Python $pythonVersion (lệnh: $pythonCmd)" -ForegroundColor Green
} else {
    Write-Host "  ❌ Chưa cài Python! Đang tải về..." -ForegroundColor Red
    Write-Host ""
    
    # ── Tải Python installer ──
    Write-Host "[2/4] Tải Python 3.12 từ python.org..." -ForegroundColor Yellow
    
    $pythonUrl = "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe"
    $installerPath = Join-Path $env:TEMP "python-3.12.7-amd64.exe"
    
    # Hybrid download: try curl (most robust), BITS, then Invoke-WebRequest, then WebClient
    $downloadSuccess = $false

    # Method 1: curl.exe (built-in Windows 10/11, highly reliable with SSL/TLS)
    if (-not $downloadSuccess) {
        try {
            Write-Host "  ⏳ Đang tải bằng curl..." -ForegroundColor Gray
            & curl.exe -L -o $installerPath $pythonUrl 2>&1
            if ($LASTEXITCODE -eq 0 -and (Test-Path $installerPath)) {
                $downloadSuccess = $true
                Write-Host "  ✅ Tải xong bằng curl" -ForegroundColor Green
            }
        } catch {
            Write-Host "  ⚠️ Tải bằng curl thất bại, đang chuyển qua phương thức khác..." -ForegroundColor Yellow
        }
    }

    # Method 2: Start-BitsTransfer (Windows BITS service)
    if (-not $downloadSuccess) {
        try {
            Write-Host "  ⏳ Đang tải bằng BITS..." -ForegroundColor Gray
            Start-BitsTransfer -Source $pythonUrl -Destination $installerPath -ErrorAction Stop
            if (Test-Path $installerPath) {
                $downloadSuccess = $true
                Write-Host "  ✅ Tải xong bằng BITS" -ForegroundColor Green
            }
        } catch {
            Write-Host "  ⚠️ Tải bằng BITS thất bại, đang chuyển qua phương thức khác..." -ForegroundColor Yellow
        }
    }

    # Method 3: Invoke-WebRequest
    if (-not $downloadSuccess) {
        try {
            Write-Host "  ⏳ Đang tải bằng Invoke-WebRequest..." -ForegroundColor Gray
            Invoke-WebRequest -Uri $pythonUrl -OutFile $installerPath -UseBasicParsing -ErrorAction Stop
            if (Test-Path $installerPath) {
                $downloadSuccess = $true
                Write-Host "  ✅ Tải xong bằng Invoke-WebRequest" -ForegroundColor Green
            }
        } catch {
            Write-Host "  ⚠️ Tải bằng Invoke-WebRequest thất bại, đang chuyển qua phương thức khác..." -ForegroundColor Yellow
        }
    }

    # Method 4: System.Net.WebClient
    if (-not $downloadSuccess) {
        try {
            Write-Host "  ⏳ Đang tải bằng WebClient..." -ForegroundColor Gray
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $wc = New-Object System.Net.WebClient
            $wc.DownloadFile($pythonUrl, $installerPath)
            if (Test-Path $installerPath) {
                $downloadSuccess = $true
                Write-Host "  ✅ Tải xong bằng WebClient" -ForegroundColor Green
            }
        } catch {
            Write-Host "  ❌ Tải bằng tất cả các phương thức đều thất bại: $_" -ForegroundColor Red
        }
    }

    if (-not $downloadSuccess) {
        Write-Host ""
        Write-Host "  👉 Không thể tải xuống tự động do tường lửa hoặc lỗi mạng!" -ForegroundColor Red
        Write-Host "  👉 Vui lòng tải thủ công tại: https://www.python.org/downloads/" -ForegroundColor Yellow
        Write-Host "  👉 NHỚ TICK 'Add Python to PATH' khi cài đặt!" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Nhấn Enter để thoát"
        exit 1
    }
    
    # ── Cài đặt Python (tự động, thêm vào PATH) ──
    Write-Host "[3/4] Cài đặt Python (tự động)..." -ForegroundColor Yellow
    Write-Host "  ⏳ Đang cài, vui lòng đợi 1-2 phút..." -ForegroundColor Gray
    
    $installArgs = "/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_test=0"
    $proc = Start-Process -FilePath $installerPath -ArgumentList $installArgs -Wait -PassThru
    
    if ($proc.ExitCode -eq 0) {
        Write-Host "  ✅ Cài đặt Python thành công!" -ForegroundColor Green
        
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        
        # Tìm lại python
        try { 
            $ver = & py --version 2>&1
            if ($ver -match "Python") { $pythonCmd = "py" }
        } catch {}
        
        if (-not $pythonCmd) {
            try {
                $ver = & python --version 2>&1
                if ($ver -match "Python") { $pythonCmd = "python" }
            } catch {}
        }
        
        if (-not $pythonCmd) {
            # Tìm trong AppData
            $localPython = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($localPython) {
                $pythonCmd = $localPython.FullName
                Write-Host "  📍 Python tại: $pythonCmd" -ForegroundColor Gray
            }
        }
        
        if (-not $pythonCmd) {
            Write-Host "  ⚠️ Cài xong nhưng chưa nhận PATH. Vui lòng KHỞI ĐỘNG LẠI MÁY TÍNH rồi chạy lại file này." -ForegroundColor Yellow
            Read-Host "Nhấn Enter để thoát"
            exit 0
        }
    } else {
        Write-Host "  ❌ Cài đặt thất bại (mã lỗi: $($proc.ExitCode))" -ForegroundColor Red
        Write-Host "  👉 Tải thủ công: https://www.python.org/downloads/" -ForegroundColor Yellow
        Write-Host "  👉 NHỚ TICK 'Add Python to PATH'!" -ForegroundColor Yellow
        Read-Host "Nhấn Enter để thoát"
        exit 1
    }
    
    # Dọn installer
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
}

# ── Bước 4: Cài dependencies ──
Write-Host ""
Write-Host "[4/4] Cài đặt thư viện Python cho Flow Studio..." -ForegroundColor Yellow

$packages = @("fastapi", "uvicorn[standard]", "python-multipart", "aiofiles", "aiohttp", "httpx", "Pillow", "pywebview", "imageio-ffmpeg")

foreach ($pkg in $packages) {
    Write-Host "  📦 Cài: $pkg" -ForegroundColor Gray -NoNewline
    $result = & $pythonCmd -m pip install $pkg --quiet 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " ✅" -ForegroundColor Green
    } else {
        Write-Host " ⚠️" -ForegroundColor Yellow
    }
}

# ── Xong ──
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║          ✅ CÀI ĐẶT HOÀN TẤT!                      ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║  Bây giờ bạn có thể mở FlowAgent AI                  ║" -ForegroundColor Green
Write-Host "║  và sử dụng Flow Studio (tạo ảnh/video AI).        ║" -ForegroundColor Green
Write-Host "║                                                      ║" -ForegroundColor Green
Write-Host "║  ⚠️ Nhớ cài FlowKit Extension trên Chrome           ║" -ForegroundColor Green
Write-Host "║  để kết nối với Flow API.                            ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# Verify
Write-Host "📋 Kiểm tra cuối:" -ForegroundColor Cyan
& $pythonCmd --version
& $pythonCmd -m pip --version
Write-Host ""
