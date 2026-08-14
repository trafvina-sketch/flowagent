"""FlowAgent Studio — Desktop App Launcher
Entry point for PyInstaller bundled desktop application.
Uses pywebview to create a native Windows window.
"""
import multiprocessing
import sys
import os
import threading
import time
import socket

# === PyInstaller freeze support (MUST be first) ===
multiprocessing.freeze_support()

# === Resolve base paths ===
FROZEN = getattr(sys, 'frozen', False)

if FROZEN:
    # Running as compiled exe — _MEIPASS is the temp extraction dir
    BUNDLE_DIR = sys._MEIPASS
    # Set CWD to the directory containing the exe (for media/, db, etc.)
    EXE_DIR = os.path.dirname(sys.executable)
    os.chdir(EXE_DIR)
    # Inject bundle dir into path so Python can find modules
    if BUNDLE_DIR not in sys.path:
        sys.path.insert(0, BUNDLE_DIR)
    # FIX: windowed mode (console=False) sets stdout/stderr to None
    # which crashes uvicorn's logging. Redirect to devnull.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w')
else:
    # Running as normal script (development)
    BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
    EXE_DIR = BUNDLE_DIR

# Set environment for child modules
os.environ['FLOWAGENT_FROZEN'] = '1' if FROZEN else '0'
os.environ['FLOWAGENT_EXE_DIR'] = EXE_DIR
os.environ['FLOWAGENT_BUNDLE_DIR'] = BUNDLE_DIR


def is_port_in_use(port: int) -> bool:
    """Check if a port is already in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def wait_for_server(port: int, timeout: float = 15.0) -> bool:
    """Wait until the server is ready on the given port."""
    start = time.time()
    while time.time() - start < timeout:
        if is_port_in_use(port):
            return True
        time.sleep(0.3)
    return False


def run_server():
    """Start FastAPI backend in a background thread."""
    try:
        import uvicorn
        # Import app from server module
        from server import app
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=8100,
            log_level="warning",
            # NEVER use reload in frozen mode
            reload=False,
            workers=1,
        )
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        print(f"[Launcher] SERVER CRASH: {e}")
        # Write to error.log next to exe
        try:
            with open(os.path.join(EXE_DIR, "error.log"), "w", encoding="utf-8") as f:
                f.write(f"FlowAgent Server Error\n{'='*50}\n{err_msg}\n")
        except:
            pass


def main():
    """Main entry point — start server + open native window."""
    PORT = 8100
    URL = f"http://127.0.0.1:{PORT}"

    # Check if another instance is already running
    if is_port_in_use(PORT):
        print(f"[Launcher] Port {PORT} already in use — opening window only...")
    else:
        # Start FastAPI in background thread
        print("[Launcher] Starting backend server...")
        server_thread = threading.Thread(target=run_server, daemon=True)
        server_thread.start()

        # Wait for server to be ready
        if not wait_for_server(PORT):
            print("[Launcher] ERROR: Server failed to start within 15s!")
            try:
                import webview
                webview.create_window(
                    "FlowAgent Studio — Error",
                    html="<h2 style='color:red;text-align:center;margin-top:100px;font-family:sans-serif'>Server khởi động thất bại.<br>Vui lòng kiểm tra logs.</h2>",
                    width=500, height=300,
                )
                webview.start()
            except Exception:
                pass
            return

        print(f"[Launcher] Server ready at {URL}")

    # Open native desktop window
    import webview

    window = webview.create_window(
        "FlowAgent Studio",
        URL,
        width=1440,
        height=900,
        min_size=(1024, 700),
        text_select=True,
        confirm_close=False,
    )

    print("[Launcher] Opening FlowAgent Studio window...")
    webview.start(
        gui='edgechromium',  # Use Edge WebView2 on Windows (modern, fast)
        debug=not FROZEN,    # Enable DevTools in dev mode only
    )
    print("[Launcher] Window closed. Exiting...")


if __name__ == '__main__':
    main()
