"""
Generate Router — API endpoints for AI media generation via FlowKit
"""
import os
import base64
import aiofiles
import asyncio
from fastapi import APIRouter, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional
from flow_service import flow_service, get_all_jobs, get_job_by_id
from .project import _load_project

router = APIRouter()


def _append_art_style_suffix(prompt: str, art_style: str) -> str:
    """Cleanly appends the art style suffix to the end of the prompt."""
    if not art_style:
        return prompt
    
    prompt_str = (prompt or "").strip()
    style_str = art_style.strip()
    
    if not prompt_str:
        return style_str
        
    # Check if the prompt already contains the art style to avoid duplicate appending
    check_snippet = style_str[:20].lower() if len(style_str) >= 20 else style_str.lower()
    if check_snippet and check_snippet in prompt_str.lower():
        print(f"[Generate Suffix] Suffix already detected in prompt. Skipping double append.")
        return prompt_str
        
    # Append cleanly: check ending punctuation
    if prompt_str.endswith(".") or prompt_str.endswith("!") or prompt_str.endswith("?"):
        if style_str.startswith(","):
            return f"{prompt_str[:-1].strip()}{style_str}"
        else:
            return f"{prompt_str} {style_str}"
    else:
        if style_str.startswith(",") or style_str.startswith("."):
            return f"{prompt_str}{style_str}"
        else:
            return f"{prompt_str}, {style_str}"


async def _call_with_retry(func, *args, max_retries=4, delay=5, **kwargs):
    """Auto-retries an API call with exponential backoff if temporary errors occur (429, 500, Captcha, Timeout)."""
    for attempt in range(max_retries + 1):
        result = await func(*args, **kwargs)
        if result.get("success"):
            return result

        # Extract error message and status code
        err_msg = str(result.get("error", "")).lower()
        
        status_code = None
        if isinstance(result.get("error"), dict):
            err_obj = result.get("error", {})
            status_code = err_obj.get("status") or err_obj.get("httpStatus")
            # Also check nested Google API error: error.data.error.code
            if not status_code:
                nested_err = err_obj.get("data", {})
                if isinstance(nested_err, dict):
                    nested_err_inner = nested_err.get("error", {})
                    if isinstance(nested_err_inner, dict):
                        status_code = nested_err_inner.get("code") or nested_err_inner.get("status")
        if not status_code:
            status_code = result.get("status")

        # Classify temporary errors that should trigger a retry
        is_temporary = False
        if status_code in (429, 500, 503, 408, 403):
            is_temporary = True
        elif any(kw in err_msg for kw in ["429", "500", "too many", "rate limit", "captcha", "timeout", "exhausted", "overloaded", "forbidden", "internal"]):
            is_temporary = True

        if is_temporary and attempt < max_retries:
            wait_time = delay + (attempt * 3)  # 5s, 8s, 11s, 14s (longer for 500 errors)
            print(f"[Auto-Retry] Detected temporary error ('{err_msg[:80]}', status={status_code}). Retrying {attempt + 1}/{max_retries} in {wait_time}s...")
            await asyncio.sleep(wait_time)
        else:
            break
    return result



# ─── Request Models ─────────────────────────────────────────────────

class GenerateImageRequest(BaseModel):
    prompt: str
    project_id: str
    art_style: str = ""
    reference_media_ids: list[str] = []
    aspect_ratio: str = "IMAGE_ASPECT_RATIO_LANDSCAPE"
    model: str = "GEM_PIX_2"


class GenerateVideoRequest(BaseModel):
    prompt: str
    project_id: str
    art_style: str = ""
    start_image_media_id: str = ""
    reference_media_ids: list[str] = []
    video_model: str = "veo_3_1_i2v_lite_low_priority"
    aspect_ratio: str = "VIDEO_ASPECT_RATIO_LANDSCAPE"


# ─── Text-to-Image ──────────────────────────────────────────────────

@router.post("/api/generate/image")
async def generate_image(req: GenerateImageRequest):
    """Generate an image from text prompt using FlowKit → Google Flow API."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    # Load global art style if none is provided, then append to end
    proj = _load_project()
    art_style = req.art_style or proj.get("globalArtStyle") or ""
    full_prompt = _append_art_style_suffix(req.prompt, art_style)

    refs = req.reference_media_ids or None
    print(f"[Generate Image] prompt={full_prompt[:60]}... refs={refs} aspect={req.aspect_ratio}")
    
    result = await _call_with_retry(
        flow_service.request_scene_frame,
        prompt=full_prompt,
        project_id=req.project_id,
        reference_media_ids=refs,
        aspect_ratio=req.aspect_ratio,
        model=req.model,
    )

    if result.get("success") and result.get("url"):
        # Auto-download the generated image to media/images/
        from routers.media import download_from_url, DownloadUrlRequest
        try:
            dl_req = DownloadUrlRequest(url=result["url"], filename=f"gen_{result.get('media_id', 'img')}.png")
            dl_result = await download_from_url(dl_req)
            result["local_file"] = dl_result.get("file")
        except Exception as e:
            print(f"[Generate] Auto-download failed: {e}")

    return result


# ─── Video Generation (T2V auto = T2I + I2V) ────────────────────────

@router.post("/api/generate/video")
async def generate_video(req: GenerateVideoRequest):
    """Generate a video. If no start image provided, auto-generates one first (T2V = T2I + I2V)."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    # Load global art style if none is provided, then append to end
    proj = _load_project()
    art_style = req.art_style or proj.get("globalArtStyle") or ""
    full_prompt = _append_art_style_suffix(req.prompt, art_style)

    start_media_id = req.start_image_media_id or None

    # Generate video (T2V if no start_media_id, I2V otherwise)
    # max_retries=1: Video generation is async on Google's server.
    # Retrying sends a NEW video job while the original is still rendering → duplicates.
    if not start_media_id:
        print(f"[Generate] T2V: Direct Text-to-Video generation...")
        result = await _call_with_retry(
            flow_service.request_scene_video,
            prompt=full_prompt,
            project_id=req.project_id,
            start_image_media_id=None,
            reference_media_ids=req.reference_media_ids or None,
            video_model=req.video_model,
            aspect_ratio=req.aspect_ratio,
            max_retries=1,
        )
    else:
        print(f"[Generate] I2V: Generating video with start_media_id: {start_media_id}")
        result = await _call_with_retry(
            flow_service.request_scene_video,
            prompt=full_prompt,
            project_id=req.project_id,
            start_image_media_id=start_media_id,
            reference_media_ids=req.reference_media_ids or None,
            video_model=req.video_model,
            aspect_ratio=req.aspect_ratio,
            max_retries=1,
        )

    return result


# ─── Upload Reference Image ─────────────────────────────────────────

@router.post("/api/generate/upload-reference")
async def upload_reference(
    file: UploadFile = File(...),
    project_id: str = Form(""),
):
    """Upload a reference image to Google Flow API, returns media_id for reuse."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    content = await file.read()
    b64 = base64.b64encode(content).decode("utf-8")

    result = await flow_service.upload_image(b64, project_id)
    return result


# ─── Upload Start Image (for I2V) ───────────────────────────────────

@router.post("/api/generate/upload-start-image")
async def upload_start_image(
    file: UploadFile = File(...),
    project_id: str = Form(""),
):
    """Upload a starting image for Image-to-Video generation."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    content = await file.read()
    b64 = base64.b64encode(content).decode("utf-8")

    result = await flow_service.upload_image(b64, project_id)
    return result


# ─── I2V with File (upload + generate in one step) ──────────────────

@router.post("/api/generate/i2v-file")
async def generate_i2v_with_file(
    file: UploadFile = File(...),
    prompt: str = Form(""),
    project_id: str = Form(""),
    video_model: str = Form("veo_3_1_i2v_s_fast_ultra_relaxed"),
    aspect_ratio: str = Form("VIDEO_ASPECT_RATIO_LANDSCAPE"),
):
    """Generate I2V video: upload image first to get mediaId, then generate video."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    # Step 1: Upload image to get mediaId
    content = await file.read()
    b64 = base64.b64encode(content).decode("utf-8")

    print(f"[I2V] Step 1: Uploading image ({len(content)} bytes)...")
    upload_result = await flow_service.upload_image(b64, project_id)
    
    if not upload_result.get("success") or not upload_result.get("media_id"):
        print(f"[I2V] Upload failed: {upload_result}")
        return {"success": False, "error": f"Upload image failed: {upload_result.get('error', 'unknown')}"}
    
    media_id = upload_result["media_id"]
    print(f"[I2V] Step 1 OK: media_id = {media_id}")

    # Step 2: Generate video with start image mediaId
    # Load global style and append to end
    proj = _load_project()
    art_style = proj.get("globalArtStyle") or ""
    full_prompt = _append_art_style_suffix(prompt, art_style)

    safe_prompt = full_prompt[:50].encode('ascii', 'replace').decode()
    print(f"[I2V] Step 2: model={video_model}, prompt={safe_prompt}...")
    result = await _call_with_retry(
        flow_service.request_scene_video,
        prompt=full_prompt,
        project_id=project_id,
        start_image_media_id=media_id,
        video_model=video_model,
        aspect_ratio=aspect_ratio,
    )
    
    print(f"[I2V] Step 2 result: success={result.get('success')}")
    return result



# ─── Job Status ──────────────────────────────────────────────────────

@router.get("/api/generate/jobs")
async def list_jobs():
    """List all generation jobs with status."""
    jobs = get_all_jobs(limit=100)
    return {"jobs": jobs, "total": len(jobs)}


@router.get("/api/generate/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get status of a specific job. Used for polling during sequential video creation."""
    job = get_job_by_id(job_id)
    if not job:
        return {"error": "Job not found", "status": "NOT_FOUND"}
    return job


# ─── R2V (Reference to Video) ───────────────────────────────────────

class GenerateR2VRequest(BaseModel):
    prompt: str
    project_id: str
    art_style: str = ""
    reference_media_ids: list[str] = []
    entity_ids: list[str] = []
    video_model: str = "veo_3_1_r2v_fast_landscape_ultra"
    aspect_ratio: str = "VIDEO_ASPECT_RATIO_LANDSCAPE"
    audio_voice_id: str = ""


@router.post("/api/generate/r2v")
async def generate_r2v(req: GenerateR2VRequest):
    """Generate Reference-to-Video from character/reference images."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    # Load global style and append to end
    proj = _load_project()
    art_style = req.art_style or proj.get("globalArtStyle") or ""
    full_prompt = _append_art_style_suffix(req.prompt, art_style)

    result = await flow_service.request_r2v_video(
        prompt=full_prompt,
        project_id=req.project_id,
        reference_media_ids=req.reference_media_ids,
        entity_ids=req.entity_ids,
        video_model=req.video_model,
        aspect_ratio=req.aspect_ratio,
        audio_voice_id=req.audio_voice_id or None,
    )
    return result


# ─── Audio Generation (TTS) ─────────────────────────────────────────

class GenerateAudioRequest(BaseModel):
    dialog: str
    voice: str
    speaker_name: str = "Speaker 1"
    project_id: str = ""
    personality: str = ""


@router.post("/api/generate/audio")
async def generate_audio_endpoint(req: GenerateAudioRequest):
    """Generate TTS audio preview."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    result = await flow_service.generate_audio(
        dialog=req.dialog,
        voice=req.voice,
        speaker_name=req.speaker_name,
        project_id=req.project_id,
        personality=req.personality,
    )
    return result


# ─── Upload Video ────────────────────────────────────────────────────

@router.post("/api/generate/upload-video")
async def upload_video_endpoint(
    file: UploadFile = File(...),
    project_id: str = Form(""),
):
    """Upload a video file to Google Flow API, returns media_id."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    content = await file.read()
    b64 = base64.b64encode(content).decode("utf-8")
    mime_type = file.content_type or "video/mp4"
    result = await flow_service.upload_video(b64, project_id, file.filename or "video.mp4", mime_type)
    return result


# ─── Create Entity (Character) ──────────────────────────────────────

class CreateEntityRequest(BaseModel):
    display_name: str = "Untitled Character"
    project_id: str = ""


@router.post("/api/generate/create-entity")
async def create_entity(req: CreateEntityRequest):
    """Create a CHARACTER entity for R2V."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    result = await flow_service.create_entity(req.display_name, req.project_id)
    return result


@router.post("/api/generate/create-character")
async def create_character(
    files: list[UploadFile] = File(...),
    display_name: str = Form("Character"),
    project_id: str = Form(""),
    voice: str = Form(None),
):
    """Create character entity + upload images + add to entity. Returns entity_id."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    image_b64_list = []
    for f in files:
        content = await f.read()
        image_b64_list.append(base64.b64encode(content).decode("utf-8"))

    result = await flow_service.create_character_with_images(
        display_name=display_name,
        image_b64_list=image_b64_list,
        project_id=project_id,
        voice=voice,
    )
    return result


# ─── Merge Videos ────────────────────────────────────────────────────

class MergeVideosRequest(BaseModel):
    video_urls: list[str]  # ordered list of video URLs to merge
    transition: str = "none"  # "none" = fast concat, "fade"/"wipeleft" etc
    transition_duration: float = 0.5


@router.post("/api/generate/merge-videos")
async def merge_videos_endpoint(req: MergeVideosRequest):
    """Download videos from URLs, merge them in order, return merged file URL."""
    import subprocess
    import tempfile
    import shutil
    import time
    import httpx

    if len(req.video_urls) < 2:
        return {"success": False, "error": "Cần ít nhất 2 video để nối"}

    # Try to find ffmpeg
    ffmpeg_path = "ffmpeg"
    try:
        import imageio_ffmpeg
        ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        pass  # fallback to system ffmpeg

    # Check if ffmpeg is available
    try:
        subprocess.run([ffmpeg_path, "-version"], capture_output=True)
    except FileNotFoundError:
        return {"success": False, "error": "Không tìm thấy công cụ FFmpeg trên máy tính. Vui lòng nhấp chạy file 'Cài đặt Python (Flow Studio).bat' để cài đặt thư viện 'imageio-ffmpeg' tự động."}

    from state import MEDIA_DIR

    tmp_dir = tempfile.mkdtemp(prefix="fvs_merge_")
    try:
        # Download/copy all videos
        downloaded = []
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            for i, url in enumerate(req.video_urls):
                vid_path = os.path.join(tmp_dir, f"vid_{i:03d}.mp4")
                try:
                    # Check if local path (starts with /media-files/)
                    if url.startswith("/media-files/"):
                        local_rel = url.replace("/media-files/", "", 1)
                        local_path = os.path.join(MEDIA_DIR, local_rel)
                        if os.path.isfile(local_path):
                            shutil.copy2(local_path, vid_path)
                            downloaded.append(vid_path)
                            continue
                    # External URL — download
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        print(f"[merge] Skip video {i}: HTTP {resp.status_code}")
                        continue
                    with open(vid_path, "wb") as f:
                        f.write(resp.content)
                    downloaded.append(vid_path)
                except Exception as e:
                    print(f"[merge] Skip video {i}: {e}")


        if len(downloaded) < 2:
            return {"success": False, "error": f"Chỉ tải được {len(downloaded)} video, cần ≥2"}

        # Output path
        from state import VIDEOS_DIR
        ts = int(time.time())
        out_filename = f"merged_{ts}.mp4"
        out_path = os.path.join(VIDEOS_DIR, out_filename)

        if req.transition == "none":
            # Fast concat (stream copy)
            list_file = os.path.join(tmp_dir, "list.txt")
            with open(list_file, "w", encoding="utf-8") as f:
                for vp in downloaded:
                    safe = vp.replace("'", "'\\''").replace("\\", "/")
                    f.write(f"file '{safe}'\n")

            cmd = [ffmpeg_path, "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", "-y", out_path]
            ret = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

            if ret.returncode != 0 or not os.path.isfile(out_path):
                # Fallback: re-encode then concat
                norm_files = []
                for i, vp in enumerate(downloaded):
                    np = os.path.join(tmp_dir, f"n{i}.mp4")
                    vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"
                    cmd_n = [ffmpeg_path, "-y", "-i", vp, "-vf", vf,
                             "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
                             "-c:a", "aac", "-ar", "48000", "-ac", "2",
                             "-pix_fmt", "yuv420p", np]
                    subprocess.run(cmd_n, capture_output=True)
                    norm_files.append(np)

                list_file2 = os.path.join(tmp_dir, "list2.txt")
                with open(list_file2, "w", encoding="utf-8") as f:
                    for vp in norm_files:
                        safe = vp.replace("'", "'\\''").replace("\\", "/")
                        f.write(f"file '{safe}'\n")

                cmd2 = [ffmpeg_path, "-f", "concat", "-safe", "0", "-i", list_file2,
                        "-c", "copy", "-movflags", "+faststart", "-y", out_path]
                ret2 = subprocess.run(cmd2, capture_output=True, text=True, encoding="utf-8", errors="replace")
                if ret2.returncode != 0:
                    return {"success": False, "error": f"FFmpeg error: {(ret2.stderr or '')[-300:]}"}

        else:
            # With transition (xfade) — re-encode all first
            norm_files = []
            durations = []
            for i, vp in enumerate(downloaded):
                np = os.path.join(tmp_dir, f"n{i}.mp4")
                vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"
                cmd_n = [ffmpeg_path, "-y", "-i", vp, "-vf", vf,
                         "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
                         "-c:a", "aac", "-ar", "48000", "-ac", "2",
                         "-pix_fmt", "yuv420p", np]
                subprocess.run(cmd_n, capture_output=True)
                norm_files.append(np)
                # Get duration
                try:
                    probe = ffmpeg_path.replace("ffmpeg", "ffprobe")
                    dur_cmd = [probe, "-v", "error", "-show_entries", "format=duration",
                               "-of", "default=noprint_wrappers=1:nokey=1", np]
                    dur_ret = subprocess.run(dur_cmd, capture_output=True, text=True)
                    durations.append(float(dur_ret.stdout.strip()))
                except Exception:
                    durations.append(5.0)

            trans = req.transition if req.transition in ("fade", "wipeleft", "dissolve", "fadeblack", "zoomin", "slideleft") else "fade"
            td = max(0.2, min(2.0, req.transition_duration))

            if len(norm_files) == 2:
                offset = max(0, durations[0] - td)
                fc = (f"[0:v][1:v]xfade=transition={trans}:duration={td}:offset={offset}[v];"
                      f"[0:a][1:a]acrossfade=d={td}[a]")
                cmd = [ffmpeg_path, "-y", "-i", norm_files[0], "-i", norm_files[1],
                       "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
                       "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
                       "-c:a", "aac", out_path]
            else:
                # Multi-video xfade chain
                filter_parts = []
                audio_parts = []
                cur_dur = durations[0]
                for i in range(len(norm_files) - 1):
                    offset = max(0, cur_dur - td)
                    src_v = f"[v{i}]" if i > 0 else "[0:v]"
                    src_a = f"[a{i}]" if i > 0 else "[0:a]"
                    filter_parts.append(f"{src_v}[{i+1}:v]xfade=transition={trans}:duration={td}:offset={offset}[v{i+1}]")
                    audio_parts.append(f"{src_a}[{i+1}:a]acrossfade=d={td}[a{i+1}]")
                    cur_dur = cur_dur + durations[i+1] - td

                fc = ";".join(filter_parts + audio_parts)
                n = len(norm_files)
                cmd = [ffmpeg_path, "-y"]
                for nf in norm_files:
                    cmd.extend(["-i", nf])
                cmd.extend(["-filter_complex", fc,
                           "-map", f"[v{n-1}]", "-map", f"[a{n-1}]",
                           "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
                           "-c:a", "aac", out_path])

            ret = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if ret.returncode != 0:
                return {"success": False, "error": f"FFmpeg xfade error: {(ret.stderr or '')[-300:]}"}

        if not os.path.isfile(out_path):
            return {"success": False, "error": "Merged file not created"}

        file_size = os.path.getsize(out_path)
        merged_url = f"/media-files/videos/{out_filename}"

        return {
            "success": True,
            "url": merged_url,
            "filename": out_filename,
            "file_size": file_size,
            "video_count": len(downloaded),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ─── Upscale Video ──────────────────────────────────────────────────

class UpscaleVideoRequest(BaseModel):
    media_id: str               # UUID of the original video
    project_id: str
    resolution: str = "1080p"   # "1080p" or "4K"
    aspect_ratio: str = "VIDEO_ASPECT_RATIO_LANDSCAPE"


@router.post("/api/generate/upscale-video")
async def upscale_video(req: UpscaleVideoRequest):
    """Start video upscale to 1080p or 4K. Returns job_id for status polling."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    print(f"[Upscale Video] media={req.media_id[:30]}... resolution={req.resolution}")

    result = await _call_with_retry(
        flow_service.upscale_video,
        media_id=req.media_id,
        project_id=req.project_id,
        resolution=req.resolution,
        aspect_ratio=req.aspect_ratio,
    )
    return result


class UpscaleVideoStatusRequest(BaseModel):
    media_id: str               # UUID of the original video (NOT upsampled name)
    project_id: str
    resolution: str = "1080p"   # "1080p" or "4K"


@router.post("/api/generate/upscale-video/status")
async def upscale_video_status(req: UpscaleVideoStatusRequest):
    """Poll upscale video status. Returns {status: 'processing'|'done'|'failed', url?}"""
    if not flow_service.active_ws:
        return {"status": "error", "error": "FlowKit extension not connected"}

    result = await flow_service.check_upscale_status(
        media_id=req.media_id,
        project_id=req.project_id,
        resolution=req.resolution,
    )

    # Auto-download if done
    if result.get("status") == "done" and result.get("url"):
        from routers.media import download_from_url, DownloadUrlRequest
        try:
            suffix = "_4K" if req.resolution.lower() == "4k" else "_1080p"
            dl_req = DownloadUrlRequest(
                url=result["url"],
                filename=f"upscale_{req.media_id[:8]}{suffix}.mp4",
            )
            dl_result = await download_from_url(dl_req)
            result["local_file"] = dl_result.get("file")
        except Exception as e:
            print(f"[Upscale] Auto-download failed: {e}")

    # Update job status in DB if done or failed
    if result.get("status") in ("done", "failed"):
        try:
            import sqlite3
            from flow_service import DB_PATH, update_job_status
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute('SELECT id FROM flow_jobs WHERE media_id=? AND type="upscale_video" ORDER BY created_at DESC LIMIT 1', (req.media_id,))
            row = c.fetchone()
            conn.close()
            if row:
                job_id = row[0]
                db_status = "DONE" if result.get("status") == "done" else "FAILED"
                db_url = result.get("local_file") or result.get("url")
                update_job_status(job_id, db_status, url=db_url)
                print(f"[Upscale Video DB] Updated job {job_id[:8]} to {db_status} with url={db_url}")
        except Exception as db_err:
            print(f"[Upscale Video DB] Error updating job: {db_err}")

    return result


# ─── Upscale Image ──────────────────────────────────────────────────

class UpscaleImageRequest(BaseModel):
    media_id: str               # media name/ID of the image
    project_id: str
    quality: str = "2K"         # "2K" or "4K"


@router.post("/api/generate/upscale-image")
async def upscale_image(req: UpscaleImageRequest):
    """Upscale an image to 2K or 4K resolution. Returns URL of upscaled image."""
    if not flow_service.active_ws:
        return {"success": False, "error": "FlowKit extension not connected"}

    print(f"[Upscale Image] media={req.media_id[:30]}... quality={req.quality}")

    result = await _call_with_retry(
        flow_service.upscale_image,
        media_id=req.media_id,
        project_id=req.project_id,
        quality=req.quality,
    )

    # Auto-download if we got a URL
    if result.get("success") and result.get("url"):
        from routers.media import download_from_url, DownloadUrlRequest
        try:
            dl_req = DownloadUrlRequest(
                url=result["url"],
                filename=f"upscale_{req.media_id[:8]}_{req.quality}.png",
            )
            dl_result = await download_from_url(dl_req)
            result["local_file"] = dl_result.get("file")
        except Exception as e:
            print(f"[Upscale Image] Auto-download failed: {e}")

    return result

