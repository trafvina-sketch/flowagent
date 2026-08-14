"""Story Memory — Lưu/Load trạng thái story để tạo tập tiếp theo."""

import json
import os
import time
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

# Store stories in a local JSON file
STORY_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "stories.json")


def _ensure_db():
    """Ensure data directory and file exist."""
    os.makedirs(os.path.dirname(STORY_DB_PATH), exist_ok=True)
    if not os.path.exists(STORY_DB_PATH):
        with open(STORY_DB_PATH, "w", encoding="utf-8") as f:
            json.dump({}, f)


def _load_db() -> dict:
    _ensure_db()
    with open(STORY_DB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_db(data: dict):
    _ensure_db()
    with open(STORY_DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ─── Models ───

class Character(BaseModel):
    name: str
    role: str = ""
    description: str = ""
    design_prompt: str = ""
    media_ids: list[str] = []  # FlowKit media IDs for R2I reference


class Episode(BaseModel):
    ep: int
    title: str = ""
    summary: str = ""
    key_events: list[str] = []
    cliffhanger: str = ""
    scene_count: int = 0
    created_at: str = ""


class StoryMemory(BaseModel):
    project_id: str
    title: str
    characters: list[Character] = []
    episodes: list[Episode] = []
    world_state: dict = {}  # timeline, location, rules...
    style_dna: dict = {}    # art_style, color_palette, mood...
    total_scenes: int = 0
    created_at: str = ""
    updated_at: str = ""


class SaveStoryRequest(BaseModel):
    project_id: str
    title: str
    characters: list[Character] = []
    episode: Optional[Episode] = None
    world_state: dict = {}
    style_dna: dict = {}
    scenes_in_episode: int = 0


class ContinueStoryRequest(BaseModel):
    project_id: str
    ai_endpoint: str = "http://127.0.0.1:8045"
    ai_key: str = ""
    ai_model: str = "gemini-3-flash"
    user_direction: str = ""  # Optional user hint for next episode
    scene_count: int = 5


# ─── Endpoints ───

@router.get("/api/story/list")
async def list_stories():
    """List all saved story projects."""
    db = _load_db()
    stories = []
    for pid, story in db.items():
        stories.append({
            "project_id": pid,
            "title": story.get("title", ""),
            "episodes": len(story.get("episodes", [])),
            "characters": len(story.get("characters", [])),
            "total_scenes": story.get("total_scenes", 0),
            "updated_at": story.get("updated_at", ""),
        })
    return {"success": True, "stories": stories}


@router.get("/api/story/{project_id}")
async def get_story(project_id: str):
    """Get full story memory for a project."""
    db = _load_db()
    if project_id not in db:
        return {"success": False, "error": "Story not found"}
    return {"success": True, "story": db[project_id]}


@router.post("/api/story/save")
async def save_story(req: SaveStoryRequest):
    """Save/update story memory after an episode."""
    db = _load_db()
    now = time.strftime("%Y-%m-%dT%H:%M:%S")

    if req.project_id in db:
        # Update existing
        story = db[req.project_id]
        story["title"] = req.title or story["title"]
        story["updated_at"] = now

        # Merge characters (update existing, add new)
        existing_names = {c["name"] for c in story["characters"]}
        for char in req.characters:
            char_dict = char.model_dump()
            if char.name in existing_names:
                # Update media_ids
                for ec in story["characters"]:
                    if ec["name"] == char.name:
                        ec["media_ids"] = list(set(ec.get("media_ids", []) + char_dict.get("media_ids", [])))
                        ec["design_prompt"] = char_dict.get("design_prompt") or ec.get("design_prompt", "")
                        break
            else:
                story["characters"].append(char_dict)

        # Add new episode
        if req.episode:
            ep_dict = req.episode.model_dump()
            ep_dict["created_at"] = now
            story["episodes"].append(ep_dict)

        # Update world state (merge)
        story["world_state"].update(req.world_state)
        story["style_dna"].update(req.style_dna)
        story["total_scenes"] = story.get("total_scenes", 0) + req.scenes_in_episode

    else:
        # Create new
        story = {
            "project_id": req.project_id,
            "title": req.title,
            "characters": [c.model_dump() for c in req.characters],
            "episodes": [req.episode.model_dump()] if req.episode else [],
            "world_state": req.world_state,
            "style_dna": req.style_dna,
            "total_scenes": req.scenes_in_episode,
            "created_at": now,
            "updated_at": now,
        }

    db[req.project_id] = story
    _save_db(db)

    return {
        "success": True,
        "message": f"Story '{req.title}' saved — {len(story['episodes'])} episodes, {len(story['characters'])} characters",
    }


@router.delete("/api/story/{project_id}")
async def delete_story(project_id: str):
    """Delete a story project."""
    db = _load_db()
    if project_id in db:
        del db[project_id]
        _save_db(db)
        return {"success": True}
    return {"success": False, "error": "Story not found"}


@router.post("/api/story/build-context")
async def build_story_context(req: ContinueStoryRequest):
    """Build context prompt for continuing a story (next episode)."""
    db = _load_db()
    if req.project_id not in db:
        return {"success": False, "error": "Story not found"}

    story = db[req.project_id]
    chars = story.get("characters", [])
    eps = story.get("episodes", [])
    world = story.get("world_state", {})
    style = story.get("style_dna", {})

    # Build context for AI
    context_parts = [
        f"## STORY MEMORY — \"{story['title']}\"",
        f"Tổng: {len(eps)} tập đã tạo, {story.get('total_scenes', 0)} cảnh",
        "",
    ]

    # Characters
    if chars:
        context_parts.append("### NHÂN VẬT (giữ nguyên ngoại hình):")
        for c in chars:
            media_note = f" [mediaIds: {','.join(c.get('media_ids', []))}]" if c.get("media_ids") else ""
            context_parts.append(f"- **{c['name']}** ({c.get('role', '')}): {c.get('description', '')}{media_note}")
            if c.get("design_prompt"):
                context_parts.append(f"  Design: {c['design_prompt'][:100]}...")
        context_parts.append("")

    # Previous episodes
    if eps:
        context_parts.append("### TẬP TRƯỚC:")
        for ep in eps[-5:]:  # Last 5 episodes
            context_parts.append(f"- **Tập {ep['ep']}: {ep.get('title', '')}** — {ep.get('summary', '')}")
            if ep.get("key_events"):
                context_parts.append(f"  Sự kiện: {', '.join(ep['key_events'])}")
            if ep.get("cliffhanger"):
                context_parts.append(f"  Cliffhanger: {ep['cliffhanger']}")
        context_parts.append("")

    # World state
    if world:
        context_parts.append("### THẾ GIỚI:")
        for k, v in world.items():
            context_parts.append(f"- {k}: {v}")
        context_parts.append("")

    # Style
    if style:
        context_parts.append("### PHONG CÁCH (giữ nhất quán):")
        for k, v in style.items():
            context_parts.append(f"- {k}: {v}")
        context_parts.append("")

    # Direction
    next_ep = len(eps) + 1
    context_parts.append(f"### YÊU CẦU: Tạo TẬP {next_ep} ({req.scene_count} cảnh)")
    if req.user_direction:
        context_parts.append(f"Hướng dẫn user: {req.user_direction}")
    context_parts.append("PHẢI tiếp nối từ cliffhanger tập trước. Giữ nguyên nhân vật + phong cách.")
    context_parts.append("Dùng characters[] có sẵn (KHÔNG tạo lại nhân vật nếu đã có mediaIds).")

    # Collect character mediaIds for R2I
    all_media_ids = []
    for c in chars:
        all_media_ids.extend(c.get("media_ids", []))

    return {
        "success": True,
        "context": "\n".join(context_parts),
        "next_episode": next_ep,
        "character_media_ids": list(set(all_media_ids)),
        "characters": chars,
    }
