import os
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from state import PROJECT_FILE

router = APIRouter()

DEFAULT_PROJECT = {
    "flowkitProjectId": "",
    "globalArtStyle": "",
    "imageModel": "GEM_PIX_2",
    "videoModel": "veo_3_1_i2v_lite_low_priority",
    "imageAspectRatio": "IMAGE_ASPECT_RATIO_LANDSCAPE",
    "videoAspectRatio": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "customConfig": {},
}


def _load_project() -> dict:
    """Load project.json or return defaults."""
    if os.path.exists(PROJECT_FILE):
        try:
            with open(PROJECT_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Merge with defaults so new keys are always present
            merged = {**DEFAULT_PROJECT, **data}
            return merged
        except Exception:
            return dict(DEFAULT_PROJECT)
    return dict(DEFAULT_PROJECT)


def _save_project(data: dict):
    """Save project settings to project.json."""
    with open(PROJECT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


class ProjectSettings(BaseModel):
    flowkitProjectId: str | None = None
    globalArtStyle: str | None = None
    imageModel: str | None = None
    videoModel: str | None = None
    imageAspectRatio: str | None = None
    videoAspectRatio: str | None = None
    customConfig: dict | None = None


@router.get("/api/project")
async def get_project():
    """Load project settings."""
    return _load_project()


@router.post("/api/project")
async def save_project(settings: ProjectSettings):
    """Save project settings (partial update — only provided fields are updated)."""
    current = _load_project()

    # Only update fields that are explicitly provided (not None)
    update_data = settings.model_dump(exclude_none=True)
    current.update(update_data)

    _save_project(current)
    return {"success": True, "project": current}
