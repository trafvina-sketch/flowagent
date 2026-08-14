# --- Fix for Windows ConnectionResetError in asyncio ---
import sys
if sys.platform == "win32":
    import asyncio
    from functools import wraps
    try:
        from asyncio.proactor_events import _ProactorBasePipeTransport
        _orig = _ProactorBasePipeTransport._call_connection_lost

        @wraps(_orig)
        def _silence(self, *args, **kwargs):
            try:
                return _orig(self, *args, **kwargs)
            except (ConnectionResetError, RuntimeError):
                pass

        _ProactorBasePipeTransport._call_connection_lost = _silence
    except ImportError:
        pass
# -------------------------------------------------------

import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from routers import flowkit, media, project, generate, ai_agent, story_memory, license
from state import MEDIA_DIR, IMAGES_DIR, VIDEOS_DIR

os.makedirs(IMAGES_DIR, exist_ok=True)
os.makedirs(VIDEOS_DIR, exist_ok=True)

# === Detect production mode (frozen exe or built frontend exists) ===
FROZEN = getattr(sys, 'frozen', False)
_bundle_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(_bundle_dir, "static")
HAS_STATIC = os.path.isdir(STATIC_DIR) and os.path.isfile(os.path.join(STATIC_DIR, "index.html"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 50)
    print("  Flow Visual Studio — Backend Starting")
    print("=" * 50)
    if HAS_STATIC:
        print(f"[Boot] Serving frontend from: {STATIC_DIR}")
    else:
        print("[Boot] No static frontend found — API-only mode (use Vite dev server)")
    print("[Boot] Starting FlowAgent background job poller...")
    asyncio.create_task(flowkit.poll_jobs_loop())
    print("[Boot] Ready! Server running on http://0.0.0.0:8100")
    yield
    print("[Shutdown] Flow Visual Studio backend stopped.")


app = FastAPI(
    title="Flow Visual Studio API",
    description="Media gallery backend with Google Flow API integration via Chrome Extension WebSocket bridge",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(flowkit.router)
app.include_router(media.router)
app.include_router(project.router)
app.include_router(generate.router)
app.include_router(ai_agent.router)
app.include_router(story_memory.router)
app.include_router(license.router)

# Serve media files statically
app.mount("/media-files", StaticFiles(directory=MEDIA_DIR), name="media-files")

# Serve voices statically
VOICES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "voices")
if os.path.isdir(VOICES_DIR):
    app.mount("/voices", StaticFiles(directory=VOICES_DIR), name="voices")

# === Serve frontend static files (production mode) ===
if HAS_STATIC:
    # Mount static assets (JS, CSS, images, etc.)
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="frontend-assets")

    # SPA fallback: serve index.html for all non-API, non-asset routes
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve frontend SPA — fallback to index.html for client-side routing."""
        # Try to serve the exact file first
        file_path = os.path.join(STATIC_DIR, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        # Fallback to index.html (SPA routing)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
else:
    # Development mode — just return API info at root
    @app.get("/")
    async def root():
        return {
            "app": "Flow Visual Studio",
            "version": "1.0.0",
            "mode": "development",
            "docs": "/docs",
            "endpoints": {
                "images": "/api/images",
                "videos": "/api/videos",
                "media_stats": "/api/media/stats",
                "project": "/api/project",
                "flowkit_status": "/api/flowkit/status",
                "websocket": "ws://localhost:8100/ws/flowkit",
            },
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8100, reload=not FROZEN)
