const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execSync, spawn } = require('child_process');

let mainWindow;
let backendProcess = null;
let streamflowProcess = null;

// ===== FLOWAGENT BACKEND CONFIG =====
const BACKEND_PORT = 8100;

function getBackendDir() {
  if (app.isPackaged) {
    // Production: backend is in resources/backend/
    return path.join(process.resourcesPath, 'backend');
  } else {
    // Dev: backend is in ./backend/ relative to project root
    return path.join(__dirname, '..', 'backend');
  }
}

function killProcessOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const findCmd = `netstat -ano | findstr :${port} | findstr LISTENING`;
      const result = execSync(findCmd, { encoding: 'utf8', timeout: 5000 });
      const lines = result.trim().split('\n');
      for (const line of lines) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== '0') {
          try { execSync(`taskkill /F /PID ${pid}`, { timeout: 3000 }); } catch (e) {}
        }
      }
    } else {
      // macOS & Linux
      try {
        execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'ignore', timeout: 5000 });
      } catch (e) {}
    }
  } catch (e) {
    // No process on port — ok
  }
}

function startBackend() {
  const backendDir = getBackendDir();
  const serverPath = path.join(backendDir, 'server.py');
  
  if (!fs.existsSync(serverPath)) {
    console.log('[FlowAgent Backend] server.py not found at:', serverPath);
    return;
  }

  // Kill any existing process on backend port
  killProcessOnPort(BACKEND_PORT);

  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    FLOWAGENT_EXE_DIR: backendDir,
  };

  async function launchUvicorn(pythonCmd) {
    const depFlagPath = path.join(backendDir, '.dependencies_installed');
    if (!fs.existsSync(depFlagPath)) {
      console.log(`[FlowAgent Backend] Installing Python dependencies using ${pythonCmd}...`);
      const { exec } = require('child_process');
      const requirementsPath = path.join(backendDir, 'requirements.txt');
      exec(`"${pythonCmd}" -m pip install -r "${requirementsPath}"`, { cwd: backendDir }, (error) => {
        if (error) {
          console.error('[FlowAgent Backend] Failed to install pip requirements:', error.message);
        } else {
          console.log('[FlowAgent Backend] Python dependencies installed successfully');
          fs.writeFileSync(depFlagPath, 'installed');
        }
        spawnUvicorn(pythonCmd);
      });
    } else {
      spawnUvicorn(pythonCmd);
    }
  }

  function spawnUvicorn(pythonCmd) {
    console.log(`[FlowAgent Backend] Spawning uvicorn server with ${pythonCmd}...`);
    backendProcess = spawn(pythonCmd, [
      '-m', 'uvicorn', 'server:app',
      '--host', '0.0.0.0',
      '--port', String(BACKEND_PORT),
    ], {
      cwd: backendDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    backendProcess.stdout.on('data', (data) => {
      console.log('[FlowAgent Backend]', data.toString().trim());
    });

    backendProcess.stderr.on('data', (data) => {
      console.log('[FlowAgent Backend ERR]', data.toString().trim());
    });

    backendProcess.on('exit', (code) => {
      console.log(`[FlowAgent Backend] Process exited with code ${code}`);
      backendProcess = null;
    });
  }

  // Detect which python command is available
  const { exec } = require('child_process');
  exec('py --version', (errPy) => {
    if (!errPy && process.platform === 'win32') {
      launchUvicorn('py');
    } else {
      exec('python3 --version', (errPython3) => {
        if (!errPython3) {
          launchUvicorn('python3');
        } else {
          exec('python --version', (errPython) => {
            if (!errPython) {
              launchUvicorn('python');
            } else {
              // Check common local installation paths
              const userProfile = process.env.USERPROFILE || os.homedir();
              const possiblePaths = process.platform === 'win32' ? [
                path.join(userProfile, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
                path.join(userProfile, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
                path.join(userProfile, 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'python.exe'),
                path.join(process.env.SystemDrive || 'C:', 'Program Files', 'Python312', 'python.exe'),
                path.join(process.env.SystemDrive || 'C:', 'Program Files', 'Python311', 'python.exe'),
                path.join(process.env.SystemDrive || 'C:', 'Program Files', 'Python310', 'python.exe'),
                path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'python.exe'),
              ] : [
                '/opt/homebrew/bin/python3', // Apple Silicon Mac (M1/M2/M3/M4)
                '/usr/local/bin/python3',   // Intel Mac / Homebrew
                '/usr/bin/python3',         // macOS built-in
                path.join(os.homedir(), '.pyenv/shims/python3'),
                '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
                '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
                '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3',
              ];

              let foundPath = null;
              for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                  foundPath = p;
                  break;
                }
              }

              if (foundPath) {
                console.log('[FlowAgent Backend] Found Python at local path:', foundPath);
                launchUvicorn(foundPath);
              } else {
                console.error('[FlowAgent Backend] ERROR: Python is not installed or not in PATH!');
                const { dialog } = require('electron');
                dialog.showErrorBox(
                  'Không tìm thấy Python',
                  process.platform === 'darwin'
                    ? 'Để sử dụng FlowAgent AI trên macOS, bạn cần cài đặt Python 3.10+.\n\n' +
                      'Cách nhanh nhất: Mở Terminal và gõ: brew install python3\n\n' +
                      'Hoặc tải bộ cài đặt macOS (.pkg) từ python.org'
                    : 'Để sử dụng hệ thống tự động FlowAgent, bạn bắt buộc phải cài đặt Python 3.10+ trên máy tính.\n\n' +
                      'Vui lòng tải Python từ python.org, chạy trình cài đặt và nhớ tích chọn "Add Python to PATH" trước khi nhấn Install.'
                );
              }
            }
          });
        }
      });
    }
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log('[FlowAgent Backend] Stopping backend...');
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${backendProcess.pid}`, { timeout: 5000 });
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch (e) {
      console.log('[FlowAgent Backend] Kill error:', e.message);
    }
    backendProcess = null;
  }
}

// ===== STREAMFLOW SERVER CONFIG =====
const STREAMFLOW_PORT = 7575;

function getStreamFlowDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'streamflow');
  } else {
    return path.join(__dirname, '..', 'streamflow');
  }
}

function startStreamFlow() {
  const streamflowDir = getStreamFlowDir();
  const appPath = path.join(streamflowDir, 'app.js');
  
  if (!fs.existsSync(appPath)) {
    console.log('[StreamFlow] app.js not found at:', appPath);
    return;
  }

  // Kill any existing process on StreamFlow port
  killProcessOnPort(STREAMFLOW_PORT);

  console.log('[StreamFlow] Starting server at:', streamflowDir);
  
  const env = {
    ...process.env,
    PORT: String(STREAMFLOW_PORT),
    NODE_ENV: 'development',
  };

  // Check if node_modules exists
  const nodeModulesPath = path.join(streamflowDir, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('[StreamFlow] Installing dependencies asynchronously...');
    const { exec } = require('child_process');
    exec('npm install', { cwd: streamflowDir }, (error) => {
      if (error) {
        console.error('[StreamFlow] Failed to install dependencies:', error.message);
        return;
      }
      console.log('[StreamFlow] Dependencies installed successfully');
      ensureStreamflowSecretAndSpawn(appPath, streamflowDir, env);
    });
  } else {
    ensureStreamflowSecretAndSpawn(appPath, streamflowDir, env);
  }
}

function ensureStreamflowSecretAndSpawn(appPath, streamflowDir, env) {
  // Generate secret if .env doesn't have SESSION_SECRET
  const envPath = path.join(streamflowDir, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    if (!envContent.includes('SESSION_SECRET')) {
      const secret = crypto.randomBytes(32).toString('hex');
      fs.appendFileSync(envPath, `\nSESSION_SECRET=${secret}\n`, 'utf8');
      console.log('[StreamFlow] Generated SESSION_SECRET');
    }
  }

  streamflowProcess = spawn('node', [appPath], {
    cwd: streamflowDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  streamflowProcess.stdout.on('data', (data) => {
    console.log('[StreamFlow]', data.toString().trim());
  });

  streamflowProcess.stderr.on('data', (data) => {
    console.log('[StreamFlow ERR]', data.toString().trim());
  });

  streamflowProcess.on('error', (err) => {
    console.error('[StreamFlow] Failed to start:', err.message);
  });

  streamflowProcess.on('exit', (code) => {
    console.log(`[StreamFlow] Process exited with code ${code}`);
    streamflowProcess = null;
  });
}

function stopStreamFlow() {
  if (streamflowProcess) {
    console.log('[StreamFlow] Stopping server...');
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${streamflowProcess.pid}`, { timeout: 5000 });
      } else {
        streamflowProcess.kill('SIGTERM');
      }
    } catch (e) {
      console.log('[StreamFlow] Kill error:', e.message);
    }
    streamflowProcess = null;
  }
}

// ===== LICENSE CONFIG =====
const LICENSE_API_BASE = 'https://qgcixqkkkgjenlvyagja.supabase.co/functions/v1';
const PRODUCT_CODE = 'FlowAgent';
const APP_DATA_DIR = path.join(app.getPath('userData'), 'flow-agent');
const LICENSE_FILE = path.join(APP_DATA_DIR, 'license.json');
const OFFLINE_CACHE_MAX_MS = 24 * 60 * 60 * 1000; // Offline cache max 24 hours
const RECHECK_INTERVAL_MS = 5 * 60 * 1000; // Re-check every 5 minutes while running

let recheckTimer = null;

// ===== DEVICE ID =====
function getDeviceId() {
  const parts = [];
  
  if (process.platform === 'win32') {
    // Windows Machine GUID
    try {
      const guid = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8' });
      const match = guid.match(/MachineGuid\s+REG_SZ\s+(.+)/);
      if (match) parts.push(match[1].trim());
    } catch (e) {}
    
    // System UUID
    try {
      const uuid = execSync('wmic csproduct get uuid', { encoding: 'utf8' });
      const lines = uuid.split('\n').map(l => l.trim()).filter(l => l && !l.includes('UUID'));
      if (lines[0]) parts.push(lines[0]);
    } catch (e) {}
  } else if (process.platform === 'darwin') {
    // macOS Platform UUID
    try {
      const uuid = execSync("ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/ { split($0, line, \"\\\"\"); print line[4]; }'", { encoding: 'utf8' });
      if (uuid && uuid.trim()) parts.push(uuid.trim());
    } catch (e) {}

    // Fallback: system_profiler
    if (parts.length === 0) {
      try {
        const sp = execSync("system_profiler SPHardwareDataType | grep 'Hardware UUID'", { encoding: 'utf8' });
        const match = sp.match(/Hardware UUID:\s+(.+)/);
        if (match && match[1]) parts.push(match[1].trim());
      } catch (e) {}
    }
  } else {
    // Linux machine-id
    try {
      if (fs.existsSync('/etc/machine-id')) {
        parts.push(fs.readFileSync('/etc/machine-id', 'utf8').trim());
      }
    } catch (e) {}
  }
  
  // Fallback
  parts.push(os.hostname());
  parts.push(os.platform());
  parts.push(os.arch());
  
  const raw = parts.join('|') + '|sieu_clone_salt_v1';
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getDeviceName() {
  return `${os.hostname()} (${os.platform()} ${os.arch()})`;
}

// ===== LICENSE STORAGE =====
function ensureDataDir() {
  if (!fs.existsSync(APP_DATA_DIR)) {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
  }
}

function saveLicense(data) {
  ensureDataDir();
  const payload = {
    ...data,
    cached_at: Date.now(),
  };
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function loadLicense() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null;
    const raw = fs.readFileSync(LICENSE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function clearLicense() {
  try {
    if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
  } catch (e) {}
}

// ===== LICENSE API =====
// Always validate online first. Cache is ONLY for offline fallback.
async function validateLicenseOnline(licenseKey) {
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();
  
  try {
    const response = await fetch(`${LICENSE_API_BASE}/validate-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        license_key: licenseKey,
        device_id: deviceId,
        device_name: deviceName,
      }),
    });
    
    const data = await response.json();
    
    if (data.valid) {
      // Check product match (supports "FlowAgent", "flowagent", "Flow Agent", "flow-agent")
      const product = data.license?.product || '';
      const normalize = (str) => str.toLowerCase().replace(/[\s\-_]+/g, '');
      if (normalize(product) !== normalize(PRODUCT_CODE)) {
        // Wrong product - clear cache and reject
        clearLicense();
        return {
          valid: false,
          error: `License thuộc sản phẩm "${product}", không phải "${PRODUCT_CODE}"`,
        };
      }
      
      saveLicense({
        license_key: licenseKey,
        valid: true,
        license: data.license,
        device_id: deviceId,
      });
      
      return { valid: true, license: data.license };
    } else {
      // Server says invalid/revoked/expired - CLEAR cache immediately
      clearLicense();
      return { valid: false, error: data.error || 'License không hợp lệ' };
    }
  } catch (err) {
    // Network error ONLY - use cache as fallback (max 24h)
    const cached = loadLicense();
    if (cached && cached.license_key === licenseKey && cached.valid) {
      const cacheAge = Date.now() - (cached.cached_at || 0);
      if (cacheAge < OFFLINE_CACHE_MAX_MS) {
        return { valid: true, license: cached.license, fromCache: true };
      }
      // Cache too old even for offline - reject
      clearLicense();
      return { valid: false, error: 'Cache đã hết hạn. Cần kết nối mạng để xác thực lại.' };
    }
    return { valid: false, error: `Lỗi kết nối: ${err.message}` };
  }
}

// Quick status check (no device activation)  
async function checkLicenseStatusOnline(licenseKey) {
  try {
    const response = await fetch(`${LICENSE_API_BASE}/check-license-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey }),
    });
    const data = await response.json();
    
    if (!data.valid) {
      // License revoked/expired - clear cache and kill app
      clearLicense();
      if (mainWindow) {
        mainWindow.webContents.send('license:revoked', data.error || 'License đã bị thu hồi');
      }
    }
    return data;
  } catch (err) {
    // Network error during re-check - don't kick user out, just log
    console.log('License re-check failed (network):', err.message);
    return null; // null = network error, don't act on it
  }
}

// Periodic re-check: validates license every 5 minutes while app is running
function startPeriodicRecheck() {
  if (recheckTimer) clearInterval(recheckTimer);
  
  recheckTimer = setInterval(async () => {
    const cached = loadLicense();
    if (!cached || !cached.license_key) return;
    
    console.log('[License] Periodic re-check...');
    const result = await checkLicenseStatusOnline(cached.license_key);
    
    if (result && !result.valid) {
      console.log('[License] Key revoked/expired during session!');
      // Cache already cleared by checkLicenseStatusOnline
      // Frontend will handle the 'license:revoked' event
    }
  }, RECHECK_INTERVAL_MS);
}

function stopPeriodicRecheck() {
  if (recheckTimer) {
    clearInterval(recheckTimer);
    recheckTimer = null;
  }
}

// ===== IPC HANDLERS =====
function setupIpcHandlers() {
  // User manually enters key → always validate online
  ipcMain.handle('license:validate', async (event, licenseKey) => {
    const result = await validateLicenseOnline(licenseKey);
    if (result.valid) startPeriodicRecheck();
    return result;
  });
  
  // App startup → ALWAYS try online first, cache is ONLY offline fallback
  ipcMain.handle('license:check-cached', async () => {
    const cached = loadLicense();
    if (!cached || !cached.license_key) return { valid: false, needsInput: true };
    
    // ALWAYS validate online, even if cache exists
    const result = await validateLicenseOnline(cached.license_key);
    if (result.valid) startPeriodicRecheck();
    return result;
  });
  
  ipcMain.handle('license:clear', async () => {
    stopPeriodicRecheck();
    clearLicense();
    return { success: true };
  });
  
  ipcMain.handle('license:get-device-id', () => {
    return getDeviceId();
  });

  // ===== FILE DOWNLOAD SUPPORT =====
  // Pick a folder for saving media files
  ipcMain.handle('media:pick-folder', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Chọn thư mục lưu media',
      defaultPath: path.join(os.homedir(), 'Downloads'),
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // Download a file from URL and save to specified path
  ipcMain.handle('media:download-file', async (event, { url, savePath }) => {
    try {
      const http = url.startsWith('https') ? require('https') : require('http');
      return await new Promise((resolve, reject) => {
        // Ensure parent directory exists
        const dir = path.dirname(savePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const file = fs.createWriteStream(savePath);
        http.get(url, (response) => {
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            const redirectHttp = redirectUrl.startsWith('https') ? require('https') : require('http');
            redirectHttp.get(redirectUrl, (res2) => {
              res2.pipe(file);
              file.on('finish', () => { file.close(); resolve({ success: true }); });
            }).on('error', (e) => { fs.unlinkSync(savePath); reject(e); });
            return;
          }
          response.pipe(file);
          file.on('finish', () => { file.close(); resolve({ success: true }); });
        }).on('error', (e) => {
          fs.unlinkSync(savePath);
          reject(e);
        });
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// ===== WINDOW CREATION =====
function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../public/icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'FlowAgent AI - Automation & Content System',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#09090e',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show window smoothly when ready
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Fallback timer: Force show after 800ms to guarantee window is never stuck hidden/black
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('[Electron] Force showing main window via fallback timer');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 800);

  // In production, load the built files
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    // mainWindow.webContents.openDevTools();
  } else {
    // In dev, connect to Vite dev server
    mainWindow.loadURL('http://localhost:3000');
    // mainWindow.webContents.openDevTools();
  }

  // Handle load failure
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Electron] Page load failed:', errorCode, errorDescription);
    if (mainWindow) mainWindow.show();
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle file downloads (from FlowAgent media, Lyric Video exports, etc.)
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const suggestedFilename = item.getFilename() || 'download';
    
    // Show save dialog so user can choose location
    const { dialog } = require('electron');
    const savePath = dialog.showSaveDialogSync(mainWindow, {
      defaultPath: path.join(require('os').homedir(), 'Downloads', suggestedFilename),
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Video', extensions: ['mp4', 'webm', 'avi', 'mkv'] },
        { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      ],
    });

    if (savePath) {
      item.setSavePath(savePath);
    } else {
      item.cancel();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopPeriodicRecheck();
  });
}

app.whenReady().then(async () => {
  setupIpcHandlers();
  
  // Create window immediately so user sees loading screen and avoids black screen
  createWindow();

  // Clear storage and start services asynchronously in background
  setTimeout(async () => {
    try {
      const { session } = require('electron');
      await session.defaultSession.clearStorageData({
        storages: ['serviceworkers', 'cachestorage']
      });
      console.log('[Electron] Cleared service workers and cache storage to prevent crashes');
    } catch (err) {
      console.error('[Electron] Failed to clear storage:', err.message);
    }

    startBackend(); // Auto-start FlowAgent backend
    startStreamFlow(); // Auto-start StreamFlow server
  }, 100);
});

app.on('window-all-closed', () => {
  stopPeriodicRecheck();
  stopBackend(); // Kill FlowAgent backend
  stopStreamFlow(); // Kill StreamFlow server
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
