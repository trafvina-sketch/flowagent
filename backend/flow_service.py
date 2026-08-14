import asyncio
import json
import uuid
import time
import sqlite3
import os
import sys

# Fix Windows console encoding for Vietnamese characters
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# DB should be in writable directory (next to exe in frozen mode)
_db_dir = os.environ.get('FLOWAGENT_EXE_DIR', os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_db_dir, "jobs.db")


# ─── SQLite Job Tracking ───────────────────────────────────────────────

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS flow_jobs (
        id TEXT PRIMARY KEY,
        type TEXT,
        prompt TEXT,
        status TEXT,
        operation_name TEXT,
        media_id TEXT,
        url TEXT,
        request_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    # Add request_id column if missing (migration)
    try:
        c.execute('ALTER TABLE flow_jobs ADD COLUMN request_id TEXT')
    except:
        pass
    
    # Mark stale pending/processing jobs from previous sessions as FAILED on startup
    try:
        c.execute("UPDATE flow_jobs SET status='FAILED', url='Stale job cancelled on server restart' WHERE status IN ('PENDING', 'PROCESSING')")
        print("[InitDb] Cleaned up stale PENDING/PROCESSING jobs.")
    except Exception as e:
        print(f"[InitDb] Error cleaning up stale jobs: {e}")
        
    conn.commit()
    conn.close()


def add_job(job_id, job_type, prompt, operation_name, media_id=None, request_id=None):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        'INSERT INTO flow_jobs (id, type, prompt, status, operation_name, media_id, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (job_id, job_type, prompt, 'PENDING', operation_name, media_id, request_id),
    )
    conn.commit()
    conn.close()


def update_job_status(job_id, status, media_id=None, url=None):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        'UPDATE flow_jobs SET status=?, media_id=?, url=? WHERE id=?',
        (status, media_id, url, job_id),
    )
    conn.commit()
    conn.close()


def save_media_mapping(media_id, workflow_id):
    if not media_id or not workflow_id:
        return
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('CREATE TABLE IF NOT EXISTS flow_media_map (media_id TEXT PRIMARY KEY, workflow_id TEXT)')
        c.execute('INSERT OR REPLACE INTO flow_media_map (media_id, workflow_id) VALUES (?, ?)', (media_id, workflow_id))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[FlowService] Error saving media mapping: {e}")


def get_workflow_id(media_id):
    if not media_id:
        return None
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('CREATE TABLE IF NOT EXISTS flow_media_map (media_id TEXT PRIMARY KEY, workflow_id TEXT)')
        c.execute('SELECT workflow_id FROM flow_media_map WHERE media_id=?', (media_id,))
        r = c.fetchone()
        conn.close()
        return r[0] if r else None
    except Exception as e:
        print(f"[FlowService] Error reading media mapping: {e}")
        return None


def get_pending_jobs():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT id, operation_name, media_id, request_id, status FROM flow_jobs WHERE status IN ("PENDING","PROCESSING") AND type != "upscale_video"')
    rows = c.fetchall()
    conn.close()
    return [{"id": r[0], "operation_name": r[1], "media_id": r[2], "request_id": r[3], "status": r[4]} for r in rows]


def get_all_jobs(limit=50):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT id, type, prompt, status, operation_name, media_id, url, created_at FROM flow_jobs ORDER BY created_at DESC LIMIT ?', (limit,))
    rows = c.fetchall()
    conn.close()
    return [
        {
            "id": r[0], "type": r[1], "prompt": r[2], "status": r[3],
            "operation_name": r[4], "media_id": r[5], "url": r[6], "created_at": r[7],
        }
        for r in rows
    ]


def get_job_by_id(job_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT id, type, prompt, status, operation_name, media_id, url, created_at FROM flow_jobs WHERE id=?', (job_id,))
    r = c.fetchone()
    conn.close()
    if not r:
        return None
    return {
        "id": r[0], "type": r[1], "prompt": r[2], "status": r[3],
        "operation_name": r[4], "media_id": r[5], "url": r[6], "created_at": r[7],
    }


# ─── FlowService ───────────────────────────────────────────────────────

class FlowService:
    def __init__(self):
        self.connections = set()
        self.connection_metadata = {}  # {WebSocket: dict}
        self.request_ws_map = {}  # {request_id: WebSocket}
        self.flow_key = None
        self.pending_requests: dict[str, asyncio.Future] = {}
        init_db()

    @property
    def active_ws(self):
        # Return the first active connection for backwards compatibility
        if self.connections:
            return next(iter(self.connections))
        return None

    @active_ws.setter
    def active_ws(self, ws):
        # Setter for backwards compatibility
        if ws:
            self.add_connection(ws)

    def add_connection(self, websocket):
        self.connections.add(websocket)
        if websocket not in self.connection_metadata:
            self.connection_metadata[websocket] = {"flowKeyPresent": False}
        print(f"[FlowService] Added connection. Total connections: {len(self.connections)}")

    def remove_connection(self, websocket):
        self.connections.discard(websocket)
        self.connection_metadata.pop(websocket, None)
        # Clean up mapping for disconnected websocket
        self.request_ws_map = {k: v for k, v in self.request_ws_map.items() if v != websocket}
        print(f"[FlowService] Removed connection. Total connections: {len(self.connections)}")

    def get_best_websocket(self):
        if not self.connections:
            return None
        
        # Filter connections that have flowKeyPresent = True
        ready_connections = [
            ws for ws in self.connections 
            if self.connection_metadata.get(ws, {}).get("flowKeyPresent", False)
        ]
        
        # If no connection has a token yet, fallback to all connections
        candidates = ready_connections if ready_connections else list(self.connections)
        
        # Count active requests per candidate connection
        counts = {ws: 0 for ws in candidates}
        for req_id, future in list(self.pending_requests.items()):
            ws = self.request_ws_map.get(req_id)
            if ws in counts:
                counts[ws] += 1
                
        # Find candidate with minimum load
        best_ws = min(counts.keys(), key=lambda w: counts[w])
        return best_ws

    def resolve_request(self, data):
        req_id = data.get("id")
        if req_id and req_id in self.pending_requests:
            if not self.pending_requests[req_id].done():
                self.pending_requests[req_id].set_result(data)

    async def send_clear_cache_and_reload(self, project_id: str):
        if not self.connections:
            print("[FlowService] No active extension connections to clear cache")
            return False
        
        payload = {
            "type": "clear_cache_and_reload",
            "projectId": project_id,
        }
        
        # Send to all connected extensions to clear their caches and reload Flow tab
        for ws in list(self.connections):
            try:
                await ws.send_json(payload)
                print(f"[FlowService] Sent clear_cache_and_reload to extension")
            except Exception as e:
                print(f"[FlowService] Failed to send clear_cache_and_reload: {e}")
        return True

    async def send_reload_tab(self, project_id: str):
        """Send F5 reload command to extension (no cache clearing)."""
        if not self.connections:
            print("[FlowService] No active extension connections to reload")
            return False
        
        payload = {
            "type": "reload_tab",
            "projectId": project_id,
        }
        
        for ws in list(self.connections):
            try:
                await ws.send_json(payload)
                print(f"[FlowService] Sent reload_tab to extension")
            except Exception as e:
                print(f"[FlowService] Failed to send reload_tab: {e}")
        return True

    async def _send(self, method, params, timeout=180):
        ws = self.get_best_websocket()
        if not ws:
            return {"error": "Extension not connected via WS"}

        req_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.pending_requests[req_id] = future
        self.request_ws_map[req_id] = ws

        payload = {
            "id": req_id,
            "method": method,
            "params": params,
        }

        try:
            await ws.send_json(payload)
            result = await asyncio.wait_for(future, timeout)
            return result
        except asyncio.TimeoutError:
            return {"error": "Timeout"}
        except Exception as e:
            return {"error": str(e)}
        finally:
            self.pending_requests.pop(req_id, None)
            # Prune request_ws_map if it grows too large to prevent memory leaks
            if len(self.request_ws_map) > 2000:
                oldest_keys = list(self.request_ws_map.keys())[:500]
                for k in oldest_keys:
                    self.request_ws_map.pop(k, None)

    # ─── URL helpers ────────────────────────────────────────────────────

    def _build_url(self, path):
        base = "https://aisandbox-pa.googleapis.com"
        key = os.getenv("FLOWKIT_BROWSER_API_KEY", "")
        if key:
            sep = "&" if "?" in path else "?"
            return f"{base}{path}{sep}key={key}"
        return f"{base}{path}"

    def _client_context(self, project_id):
        return {
            "projectId": project_id,
            "recaptchaContext": {
                "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
                "token": "",
            },
            "sessionId": f";{int(time.time() * 1000)}",
            "tool": "PINHOLE",
        }

    # ─── Image Upload ──────────────────────────────────────────────────

    async def upload_image(self, image_base64: str, project_id: str = ""):
        """Upload a base64-encoded image to Flow API, return media_id."""
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]

        body = {
            "clientContext": self._client_context(project_id),
            "fileName": "reference.jpg",
            "imageBytes": image_base64,
            "isHidden": False,
            "isUserUploaded": True,
            "mimeType": "image/jpeg",
        }
        url = self._build_url("/v1/flow/uploadImage")

        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
            "captchaAction": "IMAGE_GENERATION",
        }, timeout=300)

        if res.get("status") == 200:
            data = res.get("data", {})
            # Debug: log raw response keys to check workflow field
            print(f"[FlowService] Upload response keys: {list(data.keys())}")
            media_id = data.get("media", {}).get("name")
            workflow_id = data.get("workflow", {}).get("name")
            print(f"[FlowService] Image uploaded OK, media_id: {media_id}, workflow_id: {workflow_id}")
            save_media_mapping(media_id, workflow_id)
            return {"success": True, "media_id": media_id, "workflow_id": workflow_id}

        print(f"[FlowService] Image upload error: {res}")
        return {"success": False, "error": res}

    # ─── Image Generation ──────────────────────────────────────────────

    async def request_scene_frame(
        self,
        prompt: str,
        project_id: str,
        reference_media_ids: list = None,
        aspect_ratio: str = "IMAGE_ASPECT_RATIO_LANDSCAPE",
        model: str = "GEM_PIX_2",
    ):
        """Generate an image synchronously, returning fife URL directly."""
        request_item = {
            "clientContext": {
                **self._client_context(project_id),
                "sessionId": f";{int(time.time() * 1000)}",
            },
            "seed": int(time.time()) % 10000,
            "structuredPrompt": {"parts": [{"text": prompt}]},
            "imageAspectRatio": aspect_ratio,
            "imageModelName": model,
        }

        if reference_media_ids:
            request_item["imageInputs"] = [
                {"name": mid, "imageInputType": "IMAGE_INPUT_TYPE_REFERENCE"}
                for mid in reference_media_ids
            ]

        body = {
            "clientContext": self._client_context(project_id),
            "mediaGenerationContext": {"batchId": str(uuid.uuid4())},
            "useNewMedia": True,
            "requests": [request_item],
        }

        url = self._build_url(f"/v1/projects/{project_id}/flowMedia:batchGenerateImages")

        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
            "captchaAction": "IMAGE_GENERATION",
        }, timeout=300)

        if res.get("status") == 200:
            data = res.get("data", {})
            media = data.get("media", [])
            if media:
                media_id = media[0].get("name")
                image_obj = media[0].get("image", {})
                gen_image = image_obj.get("generatedImage", {})
                if not gen_image and media[0].get("video"):
                    gen_image = media[0]["video"].get("generatedImage", {})
                fife_url = gen_image.get("fifeUrl")
                if fife_url:
                    return {"success": True, "media_id": media_id, "url": fife_url}
        return {"success": False, "error": res}

    # ─── Video Generation ──────────────────────────────────────────────

    async def request_scene_video(
        self,
        prompt: str,
        project_id: str,
        scene_id: str = None,
        start_image_media_id: str = None,
        reference_media_ids: list = None,
        video_model: str = "veo_3_1_i2v_lite_low_priority",
        aspect_ratio: str = "VIDEO_ASPECT_RATIO_LANDSCAPE",
    ):
        """Request async video generation, returns job_id for tracking."""
        if not scene_id:
            scene_id = str(uuid.uuid4())

        # Auto-map model key for portrait aspect ratio
        is_portrait = "PORTRAIT" in aspect_ratio
        PORTRAIT_MAP = {
            # T2V
            "veo_3_1_t2v_fast_ultra": "veo_3_1_t2v_fast_portrait_ultra",
            "veo_3_1_t2v_fast": "veo_3_1_t2v_fast_portrait",
            # I2V
            "veo_3_1_i2v_s_fast_ultra": "veo_3_1_i2v_s_fast_portrait_ultra",
            "veo_3_1_i2v_s_fast": "veo_3_1_i2v_s_fast_portrait_relaxed",
            "veo_3_1_i2v_s_lite_4s_low_priority": "veo_3_1_i2v_s_lite_4s_low_priority",
            "veo_3_1_i2v_s_lite_6s_low_priority": "veo_3_1_i2v_s_lite_6s_low_priority",
            # R2V
            "veo_3_1_r2v_fast_landscape_ultra": "veo_3_1_r2v_fast_portrait_ultra",
            "veo_3_1_r2v_fast_landscape": "veo_3_1_r2v_fast_portrait",
        }
        actual_model = PORTRAIT_MAP.get(video_model, video_model) if is_portrait else video_model
        print(f"[FlowService] Video model: {video_model} -> {actual_model} (portrait={is_portrait})")

        # Redirect Omni (abra_) I2V to R2V since Omni does not have a true I2V model
        is_omni = str(video_model).startswith("abra_") or str(actual_model).startswith("abra_")
        if is_omni and start_image_media_id:
            # Map abra_i2v_Xs to abra_r2v_Xs
            target_r2v = video_model.replace("i2v", "r2v")
            if target_r2v == "abra" or target_r2v.endswith("i2v"):
                target_r2v = "abra_r2v_10s"
            print(f"[FlowService] Redirecting Omni I2V/Story request to R2V with model {target_r2v}")
            return await self.request_r2v_video(
                prompt=prompt,
                project_id=project_id,
                reference_media_ids=[start_image_media_id],
                video_model=target_r2v,
                aspect_ratio=aspect_ratio,
            )

        request_item = {
            "aspectRatio": aspect_ratio,
            "seed": int(time.time()) % 10000,
            "textInput": {"prompt": prompt},
            "videoModelKey": actual_model,
            "metadata": {"sceneId": scene_id},
        }

        if start_image_media_id:
            request_item["startImage"] = {"mediaId": start_image_media_id}

        body = {
            "mediaGenerationContext": {"batchId": str(uuid.uuid4())},
            "clientContext": self._client_context(project_id),
            "requests": [request_item],
            "useV2ModelConfig": True,
        }

        # Select endpoint based on start image presence (T2V vs I2V)
        if start_image_media_id:
            path = "/v1/video:batchAsyncGenerateVideoStartImage"
        else:
            path = "/v1/video:batchAsyncGenerateVideoText"

        url = self._build_url(path)

        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
            "captchaAction": "VIDEO_GENERATION",
        }, timeout=300)

        if res.get("status") == 200:
            data = res.get("data", {})
            out = {"success": True, "_request_id": res.get("id")}  # extension echoes request ID
            operations = data.get("operations", [])
            if operations and len(operations) > 0:
                out["operation_name"] = operations[0].get("name")
            else:
                workflows = data.get("workflows", [])
                if workflows and len(workflows) > 0:
                    out["operation_name"] = workflows[0].get("name")
                    out["primary_media_id"] = workflows[0].get("metadata", {}).get("primaryMediaId")

            if "operation_name" in out:
                job_id = str(uuid.uuid4())
                # req_id from _send is used by extension to track this log entry
                add_job(job_id, "video", prompt, out["operation_name"], out.get("primary_media_id"), request_id=out.get("_request_id"))
                out["job_id"] = job_id
            return out
        return {"success": False, "error": res}

    async def request_scene_video_with_bytes(
        self,
        prompt: str,
        project_id: str,
        image_base64: str,
        video_model: str = "veo_3_1_i2v_s_fast_ultra_relaxed",
        aspect_ratio: str = "VIDEO_ASPECT_RATIO_LANDSCAPE",
    ):
        """Generate I2V video with image bytes sent directly (no separate upload)."""
        scene_id = str(uuid.uuid4())

        # Auto-map model key for portrait aspect ratio
        is_portrait = "PORTRAIT" in aspect_ratio
        PORTRAIT_MAP = {
            "veo_3_1_i2v_s_fast_ultra": "veo_3_1_i2v_s_fast_portrait_ultra",
            "veo_3_1_i2v_s_fast": "veo_3_1_i2v_s_fast_portrait_relaxed",
            "veo_3_1_i2v_s_fast_ultra_relaxed": "veo_3_1_i2v_s_fast_portrait_ultra_relaxed",
            "veo_3_1_i2v_lite_low_priority": "veo_3_1_i2v_lite_low_priority",
            "veo_3_1_i2v_s_lite_4s_low_priority": "veo_3_1_i2v_s_lite_4s_low_priority",
            "veo_3_1_i2v_s_lite_6s_low_priority": "veo_3_1_i2v_s_lite_6s_low_priority",
        }
        actual_model = PORTRAIT_MAP.get(video_model, video_model) if is_portrait else video_model

        request_item = {
            "aspectRatio": aspect_ratio,
            "seed": int(time.time()) % 10000,
            "textInput": {"prompt": prompt},
            "videoModelKey": actual_model,
            "metadata": {"sceneId": scene_id},
            "startImage": {"imageBytes": image_base64},
        }

        body = {
            "mediaGenerationContext": {"batchId": str(uuid.uuid4())},
            "clientContext": self._client_context(project_id),
            "requests": [request_item],
            "useV2ModelConfig": True,
        }

        path = "/v1/video:batchAsyncGenerateVideoStartImage"
        url = self._build_url(path)

        print(f"[FlowService] I2V with bytes: model={actual_model}, prompt={prompt[:50]}...")

        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
            "captchaAction": "VIDEO_GENERATION",
        }, timeout=300)

        if res.get("status") == 200:
            data = res.get("data", {})
            out = {"success": True, "_request_id": res.get("id")}
            operations = data.get("operations", [])
            if operations and len(operations) > 0:
                out["operation_name"] = operations[0].get("name")
            else:
                workflows = data.get("workflows", [])
                if workflows and len(workflows) > 0:
                    out["operation_name"] = workflows[0].get("name")
                    out["primary_media_id"] = workflows[0].get("metadata", {}).get("primaryMediaId")

            if "operation_name" in out:
                job_id = str(uuid.uuid4())
                add_job(job_id, "video", prompt, out["operation_name"], out.get("primary_media_id"), request_id=out.get("_request_id"))
                out["job_id"] = job_id
            return out
        print(f"[FlowService] I2V with bytes error: {res}")
        return {"success": False, "error": res}

    # ─── Status Checks ─────────────────────────────────────────────────

    async def check_media_status(self, media_id: str):
        url = self._build_url(f"/v1/media/{media_id}?clientContext.tool=PINHOLE")
        res = await self._send("api_request", {
            "url": url,
            "method": "GET",
            "headers": {"content-type": "application/json"},
            "body": None,
        })
        return res

    async def check_video_generation_status(self, operations: list):
        """Poll R2V/T2V job status using batchCheckAsyncVideoGenerationStatus (Geoveoai approach)."""
        url = self._build_url("/v1/video:batchCheckAsyncVideoGenerationStatus")
        body = {"operations": operations}
        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
        })
        return res

    async def check_video_status(self, operations: list):
        op = operations[0]
        return await self.check_media_status(op)

    # ─── R2V (Reference to Video) ──────────────────────────────────────

    async def request_r2v_video(
        self,
        prompt: str,
        project_id: str,
        reference_media_ids: list = None,
        entity_ids: list = None,
        video_model: str = "veo_3_1_r2v_fast_landscape_ultra",
        aspect_ratio: str = "VIDEO_ASPECT_RATIO_LANDSCAPE",
        audio_voice_id: str = None,
    ):
        """Generate Reference-to-Video using entity IDs or reference media IDs."""
        is_omni = video_model.startswith("abra_")
        reference_media_ids = reference_media_ids or []
        entity_ids = entity_ids or []

        is_portrait = "PORTRAIT" in aspect_ratio
        

        R2V_PORTRAIT = {
            "veo_3_1_r2v_fast_landscape_ultra": "veo_3_1_r2v_fast_portrait_ultra",
            "veo_3_1_r2v_fast_landscape": "veo_3_1_r2v_fast_portrait",
        }
        actual_model = R2V_PORTRAIT.get(video_model, video_model) if is_portrait else video_model
        print(f"[FlowService] R2V model: {video_model} -> {actual_model} (portrait={is_portrait})")

        request_item = {
            "aspectRatio": aspect_ratio,
            "seed": int(time.time()) % 10000,
            "textInput": {"prompt": prompt},
            "videoModelKey": actual_model,
            "metadata": {"sceneId": str(uuid.uuid4())},
        }

        is_omni = actual_model.startswith("abra_")
        limit = 7 if is_omni else 3

        # 1. Xử lý Character Entity (referenceEntities) - tối đa 1 character
        if entity_ids:
            request_item["referenceEntities"] = [{"entityId": eid} for eid in entity_ids[:1]]
            print(f"[FlowService] R2V using entity: {entity_ids[:1]}")

        # 2. Xử lý ảnh trực tiếp (referenceImages) - tối đa limit-1 (nếu có character) hoặc limit
        max_images = (limit - 1) if entity_ids else limit
        if reference_media_ids:
            ref_list = [{"imageUsageType": "IMAGE_USAGE_TYPE_ASSET", "mediaId": mid} for mid in reference_media_ids[:max_images]]
            request_item["referenceImages"] = ref_list
            print(f"[FlowService] R2V using referenceImages (limit={max_images}): {reference_media_ids[:max_images]}")

        # Add audio reference (preset voice like "achernar" or custom media ID)
        if audio_voice_id:
            # Nếu là custom media ID (chứa dấu '-' và dài), giữ nguyên hoa thường.
            # Nếu là preset voice, chuyển về chữ thường để Google API nhận dạng.
            if "-" in audio_voice_id and len(audio_voice_id) > 20:
                voice_id = audio_voice_id
            else:
                voice_id = audio_voice_id.lower()
            request_item["referenceAudio"] = [{"mediaId": voice_id}]
            print(f"[FlowService] R2V referenceAudio: {voice_id}")

        url = self._build_url("/v1/video:batchAsyncGenerateVideoReferenceImages")
        body = {
            "clientContext": self._client_context(project_id),
            "requests": [request_item],
        }

        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
            "captchaAction": "VIDEO_GENERATION",
        }, timeout=300)

        if res.get("status") == 200:
            data = res.get("data", {})
            out = {"success": True, "_request_id": res.get("id")}
            operations = data.get("operations", [])
            if operations:
                out["operation_name"] = operations[0].get("name")
            else:
                workflows = data.get("workflows", [])
                if workflows:
                    out["operation_name"] = workflows[0].get("name")
                    out["primary_media_id"] = workflows[0].get("metadata", {}).get("primaryMediaId")
            if "operation_name" in out:
                job_id = str(uuid.uuid4())
                add_job(job_id, "r2v", prompt, out["operation_name"], out.get("primary_media_id"), request_id=out.get("_request_id"))
                out["job_id"] = job_id
            return out
        return {"success": False, "error": res}

    # ─── Audio Generation (TTS) ────────────────────────────────────────

    async def generate_audio(
        self,
        dialog: str,
        voice: str,
        speaker_name: str,
        project_id: str,
        personality: str = "",
    ):
        """Generate TTS audio preview."""
        url = self._build_url("/v1/flow:batchGenerateAudio")
        body = {
            "clientContext": {
                "projectId": project_id or str(uuid.uuid4()),
                "tool": "PINHOLE",
                "sessionId": f";{int(time.time() * 1000)}",
            },
            "requests": [{
                "dialog": dialog,
                "voicePerformance": personality,
                "modelKey": "gemini_v4s_tts_flow",
                "voiceConfigs": [{"speaker": speaker_name, "voice": voice}],
                "generationType": "PREVIEW",
            }],
        }
        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
        }, timeout=30)
        if res.get("status") == 200:
            data = res.get("data", {})
            media_list = data.get("media", [])
            workflow_list = data.get("workflows", [])
            audio_mid = media_list[0].get("name") if media_list else None
            audio_wid = workflow_list[0].get("name") if workflow_list else None
            # Extract audio bytes/URI from media response
            audio_data = None
            audio_uri = None
            if media_list:
                m = media_list[0]
                audio_data = m.get("imageBytes") or m.get("audioBytes")
                audio_uri = m.get("signedUri") or m.get("servingUri") or m.get("uri")
                # Check nested fields
                if not audio_uri:
                    for key in ["image", "audio", "file"]:
                        nested = m.get(key, {})
                        if isinstance(nested, dict):
                            audio_uri = nested.get("signedUri") or nested.get("uri")
                            if audio_uri:
                                break
            print(f"[FlowService] TTS result: mid={audio_mid}, has_data={audio_data is not None}, uri={audio_uri}")
            return {"success": True, "media_id": audio_mid, "workflow_id": audio_wid, "audio_data": audio_data, "audio_uri": audio_uri}
        return {"success": False, "error": res}

    # ─── Upload Video ──────────────────────────────────────────────────

    async def upload_video(self, video_b64: str, project_id: str, file_name: str = "video.mp4", mime_type: str = "video/mp4"):
        """Upload video to Google Flow platform."""
        url = self._build_url("/v1/flow/uploadImage")
        body = {
            "clientContext": {
                "projectId": project_id or str(uuid.uuid4()),
                "tool": "PINHOLE",
            },
            "imageBytes": video_b64,
            "isUserUploaded": True,
            "isHidden": False,
            "mimeType": mime_type,
            "fileName": file_name,
        }
        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
        }, timeout=120)
        if res.get("status") == 200:
            data = res.get("data", {})
            media_id = data.get("name") or data.get("mediaId") or data.get("media", {}).get("name")
            workflow_id = data.get("workflow", {}).get("name")
            return {"success": True, "media_id": media_id, "workflow_id": workflow_id}
        return {"success": False, "error": res}

    # ─── Create Entity (Character) ─────────────────────────────────────

    async def create_entity(self, display_name: str, project_id: str):
        """Create a CHARACTER entity via TRPC."""
        url = "https://labs.google/fx/api/trpc/flow.createEntity"
        body = {
            "json": {
                "projectId": project_id or str(uuid.uuid4()),
                "entityInfo": {
                    "entityType": "CHARACTER",
                    "displayName": display_name,
                    "characterInfo": {},
                }
            }
        }
        res = await self._send("trpc_request", {
            "url": url,
            "method": "POST",
            "body": body,
        }, timeout=30)
        if res.get("status") == 200:
            data = res.get("data", {})
            entity_data = data.get("result", {}).get("data", {}).get("json", {})
            entity_id = entity_data.get("entityId")
            return {"success": True, "entity_id": entity_id}
        return {"success": False, "error": res}

    async def upload_entity_image(self, image_base64: str, entity_id: str, project_id: str, image_index: int = 0):
        """Upload image linked to a character entity via entityContext."""
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]

        body = {
            "clientContext": {"projectId": project_id, "tool": "PINHOLE"},
            "imageBytes": image_base64,
            "isUserUploaded": True,
            "isHidden": False,
            "mimeType": "image/jpeg",
            "fileName": "character_image.jpg",
            "mediaGenerationContext": {
                "entityContext": {
                    "entityId": entity_id,
                    "characterSlot": {
                        "imageReferenceIndex": image_index
                    }
                }
            }
        }
        url = self._build_url("/v1/flow/uploadImage")

        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
        }, timeout=60)

        if res.get("status") == 200:
            data = res.get("data", {})
            print(f"[FlowService] Entity upload response keys: {list(data.keys())}")
            media_id = data.get("media", {}).get("name")
            workflow_id = data.get("workflow", {}).get("name")
            print(f"[FlowService] Entity image uploaded: media={media_id}, workflow={workflow_id}")
            save_media_mapping(media_id, workflow_id)
            return {"success": True, "media_id": media_id, "workflow_id": workflow_id}

        print(f"[FlowService] Entity image upload failed: {res}")
        return {"success": False, "error": res}

    async def update_entity(self, entity_id: str, display_name: str, image_workflow_ids: list, project_id: str, voice_id: str = None):
        """Update entity with PATCH (exact Geoveoai format)."""
        url = self._build_url("/v1/flow/entities")

        # Convert potential mediaIds to workflowIds using mapping
        resolved_workflow_ids = []
        if image_workflow_ids:
            for mid in image_workflow_ids:
                if mid:
                    wid = get_workflow_id(mid)
                    resolved_workflow_ids.append(wid if wid else mid)

        # Build imageReferences (pad to 2 slots as API expects)
        image_refs = []
        if resolved_workflow_ids:
            for wid in resolved_workflow_ids:
                if wid:
                    image_refs.append({"workflowId": wid})
        while len(image_refs) < 2:
            image_refs.append({})

        character_info = {
            "imageReferences": image_refs,
            "audioReferences": []
        }

        update_mask_parts = ["entityInfo.displayName", "entityInfo.characterInfo.imageReferences"]

        if voice_id:
            character_info["audioReferences"] = [{"presetVoiceId": voice_id.lower()}]
            update_mask_parts.append("entityInfo.characterInfo.audioReferences")

        body = {
            "entity": {
                "projectId": project_id or str(uuid.uuid4()),
                "entityId": entity_id,
                "entityInfo": {
                    "displayName": display_name,
                    "characterInfo": character_info
                }
            },
            "updateMask": ",".join(update_mask_parts)
        }

        res = await self._send("api_request", {
            "url": url,
            "method": "PATCH",
            "headers": {"content-type": "text/plain;charset=UTF-8"},
            "body": body,
        }, timeout=30)
        if res.get("status") == 200:
            print(f"[FlowService] Entity updated: {entity_id} ({display_name})")
            return {"success": True}
        print(f"[FlowService] updateEntity failed: {res}")
        return {"success": False, "error": res}

    async def create_character_with_images(self, display_name: str, image_b64_list: list, project_id: str, voice: str = None):
        """Create entity + upload images (linked) + update entity.
        Flow: createEntity → upload_entity_image × N (with entityContext) → updateEntity(PATCH)"""
        # Step 1: Create entity via TRPC
        entity_res = await self.create_entity(display_name, project_id)
        if not entity_res.get("success"):
            return {"success": False, "error": f"Create entity failed: {entity_res.get('error')}"}
        entity_id = entity_res["entity_id"]
        print(f"[FlowService] Created entity: {entity_id} ({display_name})")

        # Step 2: Upload each image linked to entity
        media_ids = []
        workflow_ids = []
        for idx, b64 in enumerate(image_b64_list):
            upload_res = await self.upload_entity_image(b64, entity_id, project_id, image_index=idx)
            if not upload_res.get("success"):
                print(f"[FlowService] Upload img {idx+1} failed: {upload_res}")
                continue
            mid = upload_res.get("media_id")
            wid = upload_res.get("workflow_id")
            if mid:
                media_ids.append(mid)
            if wid:
                workflow_ids.append(wid)
            print(f"[FlowService] Uploaded img {idx+1}: media={mid}, workflow={wid}")

        # Step 3: Update entity with workflow IDs via PATCH
        if workflow_ids or voice:
            update_res = await self.update_entity(entity_id, display_name, workflow_ids, project_id, voice_id=voice)
            if not update_res.get("success"):
                print(f"[FlowService] updateEntity failed: {update_res}")
        else:
            print("[FlowService] WARNING: No workflow_ids or voice to update entity with")

        return {"success": True, "entity_id": entity_id, "media_ids": media_ids}

    # ─── Upscale Video (1080p / 4K) ────────────────────────────────────

    async def upscale_video(
        self,
        media_id: str,
        project_id: str,
        resolution: str = "1080p",
        aspect_ratio: str = "VIDEO_ASPECT_RATIO_LANDSCAPE",
    ):
        """Upscale a generated video to 1080p or 4K.

        Args:
            media_id: UUID of the original video (from generation response)
            resolution: '1080p' or '4K'
            aspect_ratio: landscape/portrait
        Returns:
            dict with job_id for polling via check_upscale_status
        """
        is_4k = resolution.lower() in ("4k",)
        video_model = "veo_3_1_upsampler_4k" if is_4k else "veo_3_1_upsampler_1080p"
        video_resolution = "VIDEO_RESOLUTION_4K" if is_4k else "VIDEO_RESOLUTION_1080P"
        batch_id = str(uuid.uuid4())

        full_media_id = media_id if media_id.startswith("projects/") else f"projects/{project_id}/flowMedia/{media_id}"

        request_item = {
            "resolution": video_resolution,
            "aspectRatio": aspect_ratio,
            "seed": int(time.time()) % 100000,
            "videoModelKey": video_model,
            "metadata": {"workflowId": str(uuid.uuid4())},
            "videoInput": {"mediaId": full_media_id},
        }

        body = {
            "mediaGenerationContext": {"batchId": batch_id},
            "clientContext": self._client_context(project_id),
            "requests": [request_item],
            "useV2ModelConfig": True,
        }

        url = self._build_url("/v1/video:batchAsyncGenerateVideoUpsampleVideo")

        print(f"[FlowService] Upscale video: media={full_media_id} resolution={resolution} model={video_model}")

        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
            "captchaAction": "VIDEO_GENERATION",
        }, timeout=120)

        if res.get("status") == 200:
            data = res.get("data", {})
            out = {"success": True, "media_id": media_id, "resolution": resolution, "_request_id": res.get("id")}

            operations = data.get("operations", [])
            if operations:
                out["operation_name"] = operations[0].get("name")
            else:
                workflows = data.get("workflows", [])
                if workflows:
                    out["operation_name"] = workflows[0].get("name")

            # Build upsampled name for polling
            suffix = "_4k_upsampled" if is_4k else "_upsampled"
            out["upsampled_name"] = f"{full_media_id}{suffix}"

            if "operation_name" in out:
                job_id = str(uuid.uuid4())
                add_job(job_id, "upscale_video", f"Upscale {resolution}: {media_id[:20]}", out["operation_name"], media_id, request_id=out.get("_request_id"))
                out["job_id"] = job_id

            print(f"[FlowService] Upscale started: upsampled_name={out.get('upsampled_name')}")
            return out

        print(f"[FlowService] Upscale video failed: {res}")
        return {"success": False, "error": res}

    async def check_upscale_status(
        self,
        media_id: str,
        project_id: str,
        resolution: str = "1080p",
    ):
        """Check upscale video status by polling the upsampled media name.

        Returns:
            dict with 'status' (processing/done/failed) and 'url' if done
        """
        is_4k = resolution.lower() in ("4k",)
        suffix = "_4k_upsampled" if is_4k else "_upsampled"
        full_media_id = media_id if media_id.startswith("projects/") else f"projects/{project_id}/flowMedia/{media_id}"
        upsampled_name = f"{full_media_id}{suffix}"

        # Use batchCheckAsyncVideoGenerationStatus with media[] format
        body = {
            "media": [{
                "name": upsampled_name,
                "projectId": project_id,
            }]
        }

        url = self._build_url("/v1/video:batchCheckAsyncVideoGenerationStatus")

        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
        }, timeout=60)

        if res.get("status") != 200:
            return {"status": "error", "error": res}

        data = res.get("data", {})
        media_items = data.get("media", data.get("operations", []))

        for item in media_items:
            gen_status = ""
            # V2: nested mediaMetadata.mediaStatus.mediaGenerationStatus
            try:
                gen_status = item.get("mediaMetadata", {}).get("mediaStatus", {}).get("mediaGenerationStatus", "")
            except Exception:
                pass
            if not gen_status:
                gen_status = str(item.get("status", item.get("state", "")))

            if "SUCCEEDED" in gen_status or "COMPLETED" in gen_status:
                # Try to extract download URL
                video_url = None
                # Check fifeUrl in various paths
                try:
                    video_url = item.get("video", {}).get("generatedVideo", {}).get("fifeUrl")
                except Exception:
                    pass
                if not video_url:
                    try:
                        video_url = item.get("video", {}).get("fifeUrl")
                    except Exception:
                        pass

                print(f"[FlowService] Upscale DONE: {upsampled_name}, url={video_url}")
                return {"status": "done", "url": video_url, "upsampled_name": upsampled_name}

            if "FAILED" in gen_status:
                print(f"[FlowService] Upscale FAILED: {gen_status}")
                return {"status": "failed", "error": gen_status}

            if any(kw in gen_status for kw in ["PENDING", "PROCESSING", "ACTIVE"]):
                return {"status": "processing", "upsampled_name": upsampled_name}

        # Unknown status — treat as processing
        return {"status": "processing", "upsampled_name": upsampled_name}

    # ─── Upscale Image (2K / 4K) ───────────────────────────────────────

    async def upscale_image(
        self,
        media_id: str,
        project_id: str,
        quality: str = "2K",
    ):
        """Upscale an image to 2K or 4K resolution.

        Args:
            media_id: media name/ID of the image (from generation response)
            quality: '2K' or '4K'
        Returns:
            dict with url of the upscaled image
        """
        resolution_map = {
            "2K": "UPSAMPLE_IMAGE_RESOLUTION_2K",
            "4K": "UPSAMPLE_IMAGE_RESOLUTION_4K",
        }
        target_resolution = resolution_map.get(quality.upper(), "UPSAMPLE_IMAGE_RESOLUTION_2K")

        full_media_id = media_id if media_id.startswith("projects/") else f"projects/{project_id}/flowMedia/{media_id}"
        body = {
            "mediaId": full_media_id,
            "targetResolution": target_resolution,
            "clientContext": self._client_context(project_id),
        }

        url = self._build_url("/v1/flow/upsampleImage")

        print(f"[FlowService] Upscale image: media={media_id[:30]}... quality={quality}")

        res = await self._send("api_request", {
            "url": url,
            "method": "POST",
            "headers": {"content-type": "application/json"},
            "body": body,
            "captchaAction": "IMAGE_GENERATION",
        }, timeout=60)

        if res.get("status") == 200:
            data = res.get("data", {})
            # Extract upscaled image URL
            upscaled_url = None
            upscaled_media_id = None

            # Try media.fifeUrl
            media_obj = data.get("media", {})
            if isinstance(media_obj, dict):
                upscaled_url = media_obj.get("fifeUrl")
                upscaled_media_id = media_obj.get("name")
            if not upscaled_url:
                upscaled_url = data.get("fifeUrl") or data.get("url")
            if not upscaled_media_id:
                upscaled_media_id = data.get("name") or data.get("mediaId")

            print(f"[FlowService] Upscale image result: url={upscaled_url}, media_id={upscaled_media_id}")

            # If url not immediately available, poll check_media_status internally
            if not upscaled_url and upscaled_media_id:
                print(f"[FlowService] Image upscale URL not immediately available. Polling status for media_id={upscaled_media_id}...")
                for attempt in range(30):
                    await asyncio.sleep(2)
                    poll_res = await self.check_media_status(upscaled_media_id)
                    if poll_res.get("status") == 200:
                        poll_data = poll_res.get("data", {})
                        p_media = poll_data.get("media", {})
                        p_url = None
                        if isinstance(p_media, dict):
                            p_url = p_media.get("fifeUrl")
                        if not p_url:
                            img_obj = poll_data.get("image", {})
                            if isinstance(img_obj, dict):
                                gen_img = img_obj.get("generatedImage", {})
                                if isinstance(gen_img, dict):
                                    p_url = gen_img.get("fifeUrl")
                                if not p_url:
                                    p_url = img_obj.get("fifeUrl")
                        if not p_url:
                            p_url = poll_data.get("fifeUrl") or poll_data.get("url")
                        
                        if p_url:
                            upscaled_url = p_url
                            print(f"[FlowService] Image upscale resolved on attempt {attempt+1}: {upscaled_url}")
                            break
                        else:
                            m_status = poll_data.get("mediaMetadata", {}).get("mediaStatus", {})
                            state = m_status.get("mediaGenerationStatus") or poll_data.get("status") or poll_data.get("state")
                            print(f"[FlowService] Poll attempt {attempt+1} - state: {state}")
                            if state == "FAILED":
                                print(f"[FlowService] Image upscale failed on Google side")
                                break
                    else:
                        print(f"[FlowService] Poll attempt {attempt+1} failed with status {poll_res.get('status')}: {poll_res}")

            result = {"success": True, "media_id": upscaled_media_id, "quality": quality}

            if upscaled_url:
                result["url"] = upscaled_url
            else:
                # No direct URL — return media_id for tRPC resolve
                result["needs_resolve"] = True

            return result

        print(f"[FlowService] Upscale image failed: {res}")
        return {"success": False, "error": res}


# Singleton
flow_service = FlowService()

