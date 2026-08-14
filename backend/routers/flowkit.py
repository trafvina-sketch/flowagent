import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request
from flow_service import flow_service, get_pending_jobs, update_job_status, get_all_jobs
from state import flowkit_state

router = APIRouter()


@router.websocket("/ws/flowkit")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket bridge: Chrome Extension ↔ FlowVisualStudio server."""
    await websocket.accept()
    flow_service.add_connection(websocket)
    flowkit_state["active_ws"] = flow_service.active_ws
    print(f"[FlowKit] Extension connected via WebSocket. Total connections: {len(flow_service.connections)}")

    # Send callback secret so extension knows how to call us back
    await websocket.send_json({
        "type": "callback_secret",
        "secret": flowkit_state["callbackSecret"],
    })

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "token_captured":
                flowkit_state["flowKey"] = msg.get("flowKey")
                flow_service.flow_key = msg.get("flowKey")
                # Update connection metadata
                if websocket in flow_service.connection_metadata:
                    flow_service.connection_metadata[websocket]["flowKeyPresent"] = True
                print("[FlowKit] Received FlowKey from browser!")
            elif msg.get("type") == "extension_ready":
                # Update connection metadata
                if websocket in flow_service.connection_metadata:
                    flow_service.connection_metadata[websocket]["flowKeyPresent"] = msg.get("flowKeyPresent", False)
                print(f"[FlowKit] Extension ready. FlowKey present: {msg.get('flowKeyPresent')}")
            elif msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif msg.get("type") == "media_urls_refresh":
                print(f"[FlowKit] Received {len(msg.get('urls', []))} media URLs from TRPC")
            else:
                # JSON-RPC response from extension
                flow_service.resolve_request(msg)

    except WebSocketDisconnect:
        print("[FlowKit] Extension disconnected")
    except Exception as e:
        print(f"[FlowKit] WebSocket error: {e}")
    finally:
        flow_service.remove_connection(websocket)
        flowkit_state["active_ws"] = flow_service.active_ws


@router.post("/api/ext/callback")
async def ext_callback(request: Request):
    """HTTP callback endpoint for extension results."""
    data = await request.json()
    print(f"[FlowKit Callback] Received result from extension, id: {data.get('id')}")
    flow_service.resolve_request(data)
    return {"status": "received"}


@router.get("/api/flowkit/status")
async def flowkit_status():
    """Check if FlowKit extension is connected."""
    connected = flow_service.active_ws is not None
    return {
        "connected": connected,
        "flowKeyPresent": flowkit_state.get("flowKey") is not None,
    }


@router.get("/api/flowkit/jobs")
async def list_jobs(limit: int = 50):
    """List all flow jobs."""
    return {"jobs": get_all_jobs(limit)}


@router.get("/api/flowkit/jobs/pending")
async def list_pending_jobs():
    """List pending flow jobs."""
    return {"jobs": get_pending_jobs()}


@router.post("/api/flowkit/clear-cache")
async def flowkit_clear_cache(request: Request):
    """API endpoint to tell the extension to clear cache & reload the project."""
    data = await request.json()
    project_id = data.get("project_id", "")
    success = await flow_service.send_clear_cache_and_reload(project_id)
    return {"success": success}


@router.post("/api/flowkit/reload-tab")
async def flowkit_reload_tab(request: Request):
    """API endpoint to tell the extension to F5 reload the Flow tab (no cache clearing)."""
    data = await request.json()
    project_id = data.get("project_id", "")
    success = await flow_service.send_reload_tab(project_id)
    return {"success": success}


# ─── Background Job Poller ──────────────────────────────────────────────

async def _download_video(url: str, job_id: str):
    """Download completed video to media/videos/ directory."""
    import aiohttp
    import os
    from state import VIDEOS_DIR

    filename = f"gen_video_{job_id[:8]}.mp4"
    filepath = os.path.join(VIDEOS_DIR, filename)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status == 200:
                    content_type = resp.headers.get("content-type", "")
                    if "text/html" in content_type:
                        print(f"[FlowKit] Video download got HTML instead of video, skipping")
                        return False
                    with open(filepath, "wb") as f:
                        async for chunk in resp.content.iter_chunked(8192):
                            f.write(chunk)
                    file_size = os.path.getsize(filepath)
                    if file_size < 1000:
                        print(f"[FlowKit] Downloaded file too small ({file_size} bytes), likely error page")
                        os.remove(filepath)
                        return False
                    print(f"[FlowKit] Video downloaded: {filename} ({file_size} bytes)")
                    return True
                else:
                    print(f"[FlowKit] Video download failed, status: {resp.status}")
    except Exception as e:
        print(f"[FlowKit] Video download error: {e}")
    return False


async def _push_job_status(job, status, error=None):
    """Push job status update to extension via WebSocket."""
    req_id = job.get("request_id")
    ws = None
    if req_id:
        ws = flow_service.request_ws_map.get(req_id)
    if not ws:
        ws = flow_service.active_ws  # Fallback to any active connection
    if ws and req_id:
        try:
            await ws.send_json({
                "type": "job_status_update",
                "jobId": job["id"],
                "requestId": req_id,
                "status": status,
                "error": error,
            })
            print(f"[Poller] Pushed {status} to extension for request {req_id[:8]}")
        except Exception as e:
            print(f"[Poller] Failed to push status: {e}")


def _is_video_url(url_str):
    """Check if a URL string is actually a generated video content URL."""
    if not isinstance(url_str, str) or not url_str.startswith("http"):
        return False
    if "googleapis.com/v1/" in url_str or "googleapis.com/v2/" in url_str:
        return False
    if "batchCheck" in url_str or "batchAsync" in url_str or "batchGenerate" in url_str:
        return False
    if "gstatic.com" in url_str or "aitestkitchen" in url_str:
        return False
    if "flow-content.google" in url_str:
        if "/image/" in url_str:
            return False
        return True
    if ".mp4" in url_str:
        return True
    if "googlevideo.com" in url_str:
        return True
    return False

def _find_video_url(data):
    """Recursively search for video URL in dict/list."""
    if isinstance(data, str):
        return data if _is_video_url(data) else None
    elif isinstance(data, dict):
        for k in ["fifeUrl", "videoUrl", "downloadUrl", "mediaUrl", "servingUrl", "url"]:
            v = data.get(k)
            if isinstance(v, str) and _is_video_url(v):
                return v
        for v in data.values():
            found = _find_video_url(v)
            if found:
                return found
    elif isinstance(data, list):
        for elem in data:
            found = _find_video_url(elem)
            if found:
                return found
    return None


async def poll_jobs_loop():
    """Check pending video jobs. Lifecycle: PENDING → PROCESSING → DONE/FAILED."""
    while True:
        try:
            pending_jobs = get_pending_jobs()
            if pending_jobs and flow_service.active_ws:
                print(f"[Poller] Checking {len(pending_jobs)} pending jobs...")
                for job in pending_jobs:
                    mid = job.get("media_id") or job.get("operation_name")
                    if not mid:
                        continue

                    # If it's a brand new job, wait 10 seconds before the first check
                    if job.get("status") == "PENDING":
                        update_job_status(job["id"], "PROCESSING", media_id=mid)
                        print(f"[Poller] New job {job['id'][:8]} detected. Waiting 10s before first status check...")
                        await asyncio.sleep(10.0)
                    else:
                        # Otherwise, just ensure status is PROCESSING in DB
                        update_job_status(job["id"], "PROCESSING", media_id=mid)

                    print(f"[Poller] Checking job {job['id'][:8]}... op={str(mid)[:22]}...")
                    res = await flow_service.check_media_status(mid)

                    if not res:
                        print(f"[Poller] No response for {str(mid)[:16]}")
                        await asyncio.sleep(2.0)
                        continue

                    status_code = res.get("status")
                    
                    # Handle temporary API errors (like 500, 503, 429)
                    if status_code and status_code in (429, 500, 503, 408, 403):
                        print(f"[Poller] Temporary API error: status={status_code}. Keeping in queue and retrying...")
                        await asyncio.sleep(5.0)
                        continue

                    if status_code != 200:
                        # Fallback: try /v1/flowMedia/ (new Google API endpoint)
                        flowmedia_url = f"https://aisandbox-pa.googleapis.com/v1/flowMedia/{mid}"
                        fm_res = await flow_service._send("api_request", {
                            "url": flowmedia_url,
                            "method": "GET",
                            "headers": {"content-type": "application/json"},
                            "body": None,
                        })
                        fm_status = fm_res.get("status") if isinstance(fm_res, dict) else None
                        fm_data = fm_res.get("data", {}) if isinstance(fm_res, dict) else {}
                        
                        if fm_status == 200 and isinstance(fm_data, dict):
                            fm_gen_status = fm_data.get("mediaMetadata", {}).get("mediaStatus", {}).get("mediaGenerationStatus", "")
                            
                            if "FAILED" in fm_gen_status:
                                update_job_status(job["id"], "FAILED")
                                await _push_job_status(job, "FAILED", error="Video generation failed")
                            elif "SUCCESSFUL" in fm_gen_status:
                                fm_video_url = _find_video_url(fm_data)
                                if fm_video_url:
                                    downloaded = await _download_video(fm_video_url, job["id"])
                                    if downloaded:
                                        local_filename = f"gen_video_{job['id'][:8]}.mp4"
                                        local_url = f"/media-files/videos/{local_filename}"
                                        update_job_status(job["id"], "DONE", media_id=mid, url=local_url)
                                        await _push_job_status(job, "DONE")
                                    else:
                                        update_job_status(job["id"], "DONE", media_id=mid, url=fm_video_url)
                                        await _push_job_status(job, "DONE")
                                else:
                                    update_job_status(job["id"], "DONE", media_id=mid)
                                    await _push_job_status(job, "DONE")
                            # else: still processing, will retry next cycle
                        
                        await asyncio.sleep(2.0)
                        continue

                    data = res.get("data", {})

                    # Check operation status from API
                    op_status = data.get("status", "")
                    op_error = data.get("error", {})
                    error_msg = op_error.get("message", "") if isinstance(op_error, dict) else str(op_error)

                    if "FAILED" in str(op_status):
                        print(f"[Poller] Operation status: {op_status}")
                        print(f"[Poller] Status=FAILED, error='{error_msg}'")
                        
                        # "Not found" or temporary errors like 500, 503, 429 often mean still processing or temporary issues on Google's side
                        is_temp_err = any(kw in error_msg.lower() for kw in [
                            "not found", "internal error", "service unavailable", 
                            "rate limit", "too many requests", "429", "500", "503",
                            "deadline exceeded", "try again", "temporary", "overloaded",
                            "resource exhausted", "busy", "capacity", "quota"
                        ])
                        if is_temp_err:
                            print(f"[Poller] Temporary/Queue error ('{error_msg}') - keeping in queue and will retry...")
                            await asyncio.sleep(5.0)
                            continue
                            
                        # Real failure
                        update_job_status(job["id"], "FAILED", url=error_msg)
                        await _push_job_status(job, "FAILED", error=error_msg)
                        print("[Poller] FAILED")
                        await asyncio.sleep(2.0)
                        continue

                    # Check video data
                    video_data = data.get("video", {})
                    state = video_data.get("state", "")
                    print(f"[Poller] Response keys: {list(data.keys())}")
                    print(f"[Poller] Video state: '{state}', video keys: {list(video_data.keys())}")

                    # --- Case 1: fifeUrl (most reliable) ---
                    fife_url = None
                    gen_video = video_data.get("generatedVideo", {})
                    if gen_video.get("fifeUrl"):
                        fife_url = gen_video["fifeUrl"]
                    if not fife_url and video_data.get("fifeUrl"):
                        fife_url = video_data["fifeUrl"]
                    if not fife_url and data.get("fifeUrl"):
                        fife_url = data["fifeUrl"]

                    if fife_url:
                        print("[Poller] DONE -> downloading video from fifeUrl...")
                        downloaded = await _download_video(fife_url, job["id"])
                        if downloaded:
                            local_filename = f"gen_video_{job['id'][:8]}.mp4"
                            local_url = f"/media-files/videos/{local_filename}"
                            update_job_status(job["id"], "DONE", media_id=mid, url=local_url)
                            await _push_job_status(job, "DONE")
                            print(f"[Poller] DONE -> saved to {local_url}")
                        else:
                            update_job_status(job["id"], "DONE", media_id=mid, url=fife_url)
                            await _push_job_status(job, "DONE")
                            print("[Poller] DONE -> using fifeUrl (download failed)")
                        await asyncio.sleep(2.0)
                        continue

                    # --- Case 2: encodedVideo (base64 inline) ---
                    encoded = video_data.get("encodedVideo")
                    if encoded:
                        import base64 as b64mod
                        import os
                        from state import VIDEOS_DIR
                        video_bytes = b64mod.b64decode(encoded)
                        if len(video_bytes) < 10000:
                            print(f"[Poller] encodedVideo too small ({len(video_bytes)} bytes), not a real video - skipping")
                        else:
                            filename = f"gen_video_{job['id'][:8]}.mp4"
                            filepath = os.path.join(VIDEOS_DIR, filename)
                            with open(filepath, "wb") as f:
                                f.write(video_bytes)
                            update_job_status(job["id"], "DONE", media_id=mid, url=f"/media-files/videos/{filename}")
                            await _push_job_status(job, "DONE")
                            print(f"[Poller] DONE -> saved video from encodedVideo ({len(video_bytes)} bytes)")
                        await asyncio.sleep(2.0)
                        continue

                    if state in ("STATE_FAILED", "FAILED"):
                        update_job_status(job["id"], "FAILED")
                        await _push_job_status(job, "FAILED", error="Video generation failed")
                        print("[Poller] FAILED")
                    else:
                        # --- Case 3: Fallback to /v1/flowMedia/{id} (new API) ---
                        flowmedia_url = f"https://aisandbox-pa.googleapis.com/v1/flowMedia/{mid}"
                        fm_res = await flow_service._send("api_request", {
                            "url": flowmedia_url,
                            "method": "GET",
                            "headers": {"content-type": "application/json"},
                            "body": None,
                        })
                        fm_status = fm_res.get("status") if isinstance(fm_res, dict) else None
                        fm_data = fm_res.get("data", {}) if isinstance(fm_res, dict) else {}
                        
                        if fm_status == 200:
                            fm_video_url = _find_video_url(fm_data)
                            if fm_video_url:
                                downloaded = await _download_video(fm_video_url, job["id"])
                                if downloaded:
                                    local_filename = f"gen_video_{job['id'][:8]}.mp4"
                                    local_url = f"/media-files/videos/{local_filename}"
                                    update_job_status(job["id"], "DONE", media_id=mid, url=local_url)
                                    await _push_job_status(job, "DONE")
                                else:
                                    update_job_status(job["id"], "DONE", media_id=mid, url=fm_video_url)
                                    await _push_job_status(job, "DONE")
                            else:
                                print("[Poller] Still processing...")
                        else:
                            print("[Poller] Still processing...")
                    
                    await asyncio.sleep(2.0)

        except Exception as e:
            import traceback
            print(f"[Poller] Error: {e}")
            traceback.print_exc()
        await asyncio.sleep(15)

