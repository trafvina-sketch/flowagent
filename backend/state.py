"""Shared server state — import from here, never re-instantiate."""
import os
import sys

# === Path resolution for PyInstaller frozen mode ===
FROZEN = getattr(sys, 'frozen', False)

if FROZEN:
    # When running as compiled exe:
    # - EXE_DIR = directory containing FlowAgent.exe (writable, for media/db)
    # - BUNDLE_DIR = sys._MEIPASS (read-only, contains code)
    EXE_DIR = os.environ.get('FLOWAGENT_EXE_DIR', os.path.dirname(sys.executable))
    BUNDLE_DIR = sys._MEIPASS
else:
    # Development mode
    EXE_DIR = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = EXE_DIR

# Directories — media goes next to exe (writable), code stays in bundle
MEDIA_DIR = os.path.join(EXE_DIR, "media")
IMAGES_DIR = os.path.join(MEDIA_DIR, "images")
VIDEOS_DIR = os.path.join(MEDIA_DIR, "videos")
PROJECT_FILE = os.path.join(EXE_DIR, "project.json")

# Database files — also writable, next to exe
DB_DIR = EXE_DIR

# Ensure media directories exist
os.makedirs(IMAGES_DIR, exist_ok=True)
os.makedirs(VIDEOS_DIR, exist_ok=True)

flowkit_state = {
    "flowKey": None,
    "callbackSecret": os.getenv("FLOWKIT_CALLBACK_SECRET", "fvs-secret"),
    "active_ws": None,
}
