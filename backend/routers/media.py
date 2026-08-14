import os
import uuid
import time
import json
import aiohttp
import aiofiles
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from state import MEDIA_DIR, IMAGES_DIR, VIDEOS_DIR

router = APIRouter()

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".avi", ".mkv"}


# ─── Helpers ────────────────────────────────────────────────────────────

def _file_info(filepath: str, base_dir: str, media_type: str) -> dict:
    """Build a file info dict from a filesystem path."""
    stat = os.stat(filepath)
    filename = os.path.basename(filepath)
    rel_path = os.path.relpath(filepath, os.path.dirname(MEDIA_DIR))
    file_id = Path(filename).stem  # UUID part

    info = {
        "id": file_id,
        "type": media_type,
        "filename": filename,
        "path": filepath.replace("\\", "/"),
        "url": f"/media-files/{media_type}s/{filename}",
        "fileSize": stat.st_size,
        "createdAt": datetime.fromtimestamp(stat.st_ctime).isoformat(),
        "status": "ready",
    }

    # Try to get image dimensions
    if media_type == "image":
        try:
            from PIL import Image
            with Image.open(filepath) as img:
                info["dimensions"] = {"width": img.width, "height": img.height}
        except Exception:
            info["dimensions"] = None

    return info


def _get_media_subdir(ext: str) -> tuple[str, str]:
    """Return (directory, media_type) based on file extension."""
    ext_lower = ext.lower()
    if ext_lower in IMAGE_EXTENSIONS:
        return IMAGES_DIR, "image"
    elif ext_lower in VIDEO_EXTENSIONS:
        return VIDEOS_DIR, "video"
    else:
        return IMAGES_DIR, "image"  # default to images


def _guess_extension(content_type: str) -> str:
    """Guess file extension from Content-Type header."""
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
        "image/svg+xml": ".svg",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
    }
    return mapping.get(content_type, ".bin")


# ─── List Images ────────────────────────────────────────────────────────

@router.get("/api/images")
async def list_images():
    """List all images from media/images/ directory."""
    images = []
    if os.path.exists(IMAGES_DIR):
        for filename in sorted(os.listdir(IMAGES_DIR)):
            ext = Path(filename).suffix.lower()
            if ext in IMAGE_EXTENSIONS:
                filepath = os.path.join(IMAGES_DIR, filename)
                images.append(_file_info(filepath, IMAGES_DIR, "image"))
    return {"images": images, "total": len(images)}


# ─── List Videos ────────────────────────────────────────────────────────

@router.get("/api/videos")
async def list_videos():
    """List all videos from media/videos/ directory."""
    videos = []
    if os.path.exists(VIDEOS_DIR):
        for filename in sorted(os.listdir(VIDEOS_DIR)):
            ext = Path(filename).suffix.lower()
            if ext in VIDEO_EXTENSIONS:
                filepath = os.path.join(VIDEOS_DIR, filename)
                info = _file_info(filepath, VIDEOS_DIR, "video")
                info["duration"] = None  # Would need ffprobe for real duration
                videos.append(info)
    return {"videos": videos, "total": len(videos)}


# ─── Serve Media File ──────────────────────────────────────────────────

@router.get("/api/media/file")
async def serve_media_file(path: str = Query(..., description="Relative or absolute path to media file")):
    """Serve a media file by path."""
    # Security: ensure the path is within media directory
    abs_path = os.path.abspath(path)
    media_abs = os.path.abspath(MEDIA_DIR)

    if not abs_path.startswith(media_abs):
        raise HTTPException(status_code=403, detail="Access denied: path outside media directory")
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(abs_path)


# ─── Upload Media ──────────────────────────────────────────────────────

@router.post("/api/media/upload")
async def upload_media(file: UploadFile = File(...)):
    """Upload an image or video file to the appropriate media subfolder."""
    ext = Path(file.filename).suffix
    target_dir, media_type = _get_media_subdir(ext)

    # UUID-based filename to avoid conflicts
    new_filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(target_dir, new_filename)

    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    info = _file_info(filepath, target_dir, media_type)
    return {"success": True, "file": info}


# ─── Download from URL ─────────────────────────────────────────────────

class DownloadUrlRequest(BaseModel):
    url: str
    filename: str | None = None


@router.post("/api/media/download-url")
async def download_from_url(req: DownloadUrlRequest):
    """Download media from an external URL (e.g. FlowKit fife URLs) and save locally."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(req.url, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                if resp.status != 200:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Failed to download: HTTP {resp.status}",
                    )

                content_type = resp.headers.get("Content-Type", "application/octet-stream")
                data = await resp.read()

        # Determine extension
        if req.filename:
            ext = Path(req.filename).suffix or _guess_extension(content_type)
            base_name = Path(req.filename).stem
        else:
            ext = _guess_extension(content_type)
            base_name = str(uuid.uuid4())

        # Ensure unique filename
        new_filename = f"{base_name}_{uuid.uuid4().hex[:8]}{ext}"
        target_dir, media_type = _get_media_subdir(ext)
        filepath = os.path.join(target_dir, new_filename)

        async with aiofiles.open(filepath, "wb") as f:
            await f.write(data)

        info = _file_info(filepath, target_dir, media_type)
        return {"success": True, "file": info}

    except aiohttp.ClientError as e:
        raise HTTPException(status_code=502, detail=f"Download error: {str(e)}")


# ─── Delete Media ──────────────────────────────────────────────────────

@router.delete("/api/media/{media_id}")
async def delete_media(media_id: str):
    """Delete a media file by its ID (UUID filename stem)."""
    # Search in both directories
    for search_dir in [IMAGES_DIR, VIDEOS_DIR]:
        if os.path.exists(search_dir):
            for filename in os.listdir(search_dir):
                stem = Path(filename).stem
                if stem == media_id or stem.startswith(media_id):
                    filepath = os.path.join(search_dir, filename)
                    os.remove(filepath)
                    return {"success": True, "deleted": filename}

    raise HTTPException(status_code=404, detail=f"Media not found: {media_id}")


# ─── Media Stats ───────────────────────────────────────────────────────

@router.get("/api/media/stats")
async def media_stats():
    """Return media statistics."""
    total_images = 0
    total_videos = 0
    total_size = 0

    if os.path.exists(IMAGES_DIR):
        for f in os.listdir(IMAGES_DIR):
            fp = os.path.join(IMAGES_DIR, f)
            if os.path.isfile(fp):
                total_images += 1
                total_size += os.path.getsize(fp)

    if os.path.exists(VIDEOS_DIR):
        for f in os.listdir(VIDEOS_DIR):
            fp = os.path.join(VIDEOS_DIR, f)
            if os.path.isfile(fp):
                total_videos += 1
                total_size += os.path.getsize(fp)

    return {
        "totalImages": total_images,
        "totalVideos": total_videos,
        "totalSize": total_size,
        "totalSizeHuman": _human_size(total_size),
    }


def _human_size(size_bytes: int) -> str:
    """Convert bytes to human-readable string."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


# ─── Pick Folder Dialog ────────────────────────────────────────────────

@router.post("/api/media/pick-folder")
async def pick_folder():
    """Open native folder picker dialog and return selected path."""
    import threading

    result = {"path": None}

    def _pick():
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            folder = filedialog.askdirectory(title="Chọn thư mục lưu trữ")
            root.destroy()
            result["path"] = folder if folder else None
        except Exception:
            result["path"] = None

    # tkinter must run on main-ish thread, use threading + wait
    t = threading.Thread(target=_pick)
    t.start()
    t.join(timeout=120)

    if result["path"]:
        return {"success": True, "folder": result["path"]}
    else:
        return {"success": False, "folder": None, "error": "Không chọn thư mục"}


# ─── Save Media to Custom Folder ──────────────────────────────────────

class SaveToFolderRequest(BaseModel):
    folder: str
    files: list[dict]  # [{url, name, type}]


@router.post("/api/media/save-to-folder")
async def save_to_folder(req: SaveToFolderRequest):
    """Save media files to a user-chosen folder."""
    import shutil

    if not req.folder or not os.path.isdir(req.folder):
        raise HTTPException(status_code=400, detail="Thư mục không tồn tại")

    # Create subfolders
    images_dir = os.path.join(req.folder, "images")
    videos_dir = os.path.join(req.folder, "videos")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(videos_dir, exist_ok=True)

    saved = 0
    errors = []

    for file_info in req.files:
        try:
            url = file_info.get("url", "")
            name = file_info.get("name", f"file_{saved}")
            file_type = file_info.get("type", "image")

            # Determine target dir
            target_dir = videos_dir if file_type == "video" else images_dir

            # If URL is local (starts with /media-files/), copy directly
            if url.startswith("/media-files/") or url.startswith("/api/"):
                # Extract local path
                local_path = None
                if url.startswith("/media-files/"):
                    rel = url.replace("/media-files/", "")
                    local_path = os.path.join(MEDIA_DIR, rel)

                if local_path and os.path.isfile(local_path):
                    ext = Path(local_path).suffix
                    # Clean filename
                    clean_name = name.split("/")[-1]  # Remove folder prefix
                    dest = os.path.join(target_dir, f"{clean_name}{ext}")
                    shutil.copy2(local_path, dest)
                    saved += 1
                else:
                    errors.append(f"File not found: {url}")
            else:
                # External URL - download
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                        if resp.status == 200:
                            data = await resp.read()
                            content_type = resp.headers.get("Content-Type", "")
                            ext = _guess_extension(content_type) if "." not in name.split("/")[-1] else ""
                            clean_name = name.split("/")[-1]
                            dest = os.path.join(target_dir, f"{clean_name}{ext}")
                            async with aiofiles.open(dest, "wb") as f:
                                await f.write(data)
                            saved += 1
                        else:
                            errors.append(f"Download failed: {url} (HTTP {resp.status})")

        except Exception as e:
            errors.append(f"{name}: {str(e)}")

    return {
        "success": True,
        "saved": saved,
        "total": len(req.files),
        "errors": errors,
        "folder": req.folder,
    }

