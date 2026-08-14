"""AI Multi-Agent System — Director + Sub-agents orchestration."""

import json
import re
import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from .agents.director import DIRECTOR_PROMPT
from .agents.script_agent import SCRIPT_AGENT_PROMPT
from .agents.music_agent import MUSIC_AGENT_PROMPT
from .agents.prompt_enhancer import PROMPT_ENHANCER_PROMPT, PROMPT_ENHANCER_R2I_PROMPT
from .agents.core_guidelines import CORE_SYSTEM_GUIDELINES
from .project import _load_project
from .generate import _append_art_style_suffix

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class AgentChatRequest(BaseModel):
    messages: list[ChatMessage] = []
    characters: list[str] = []
    image_base64: str = ""  # DEPRECATED, kept for backward compat
    images_base64: list[str] = []  # All uploaded images for analysis
    audios_base64: list[str] = []  # All uploaded audio files for analysis
    ai_endpoint: str = "http://127.0.0.1:8045"
    ai_key: str = ""
    ai_model: str = "gemini-3-flash"
    enhance_prompts: bool = True  # Auto-enhance prompts before returning
    has_references: bool = False  # If user has references already in the library
    global_art_style: str = ""


class EnhanceRequest(BaseModel):
    prompts: list[str] = []
    ai_endpoint: str = "http://127.0.0.1:8045"
    ai_key: str = ""
    ai_model: str = "gemini-3-flash"


# ─── Combined System Prompt (Director + Script + Music in one call for efficiency) ───
COMBINED_AGENT_SYSTEM = CORE_SYSTEM_GUIDELINES + "\n\n" + DIRECTOR_PROMPT + """

--- CẮT ---

Khi đã đủ thông tin, BẠN SẼ TỰ VIẾT PROMPT theo quy tắc sau (LƯU Ý: R2I prompt phải NGẮN GỌN!):

""" + SCRIPT_AGENT_PROMPT + """

--- ĐẶC BIỆT: PHÂN TÍCH ÂM NHẠC & KỊCH BẢN MUSIC VIDEO ---

""" + MUSIC_AGENT_PROMPT


@router.post("/api/agent/chat")
async def agent_chat(req: AgentChatRequest):
    """Multi-turn chat with AI Director+Script agent."""
    if not req.ai_key:
        return {"success": False, "error": "Cần API key. Cấu hình trong Settings → AI Director."}
    
    print(f"[Agent Chat] messages={len(req.messages)}, images={len(req.images_base64)}, has_references={req.has_references}")

    # Build context
    context = ""
    
    # Load project config and get global style (support request payload directly)
    global_style = req.global_art_style or _load_project().get("globalArtStyle") or ""
    if global_style:
        context += f"\n[SYSTEM: ⚠️ PHONG CÁCH HÌNH ẢNH THỐNG NHẤT (UNIFIED VISUAL STYLE): Phong cách chủ đạo của dự án hiện tại là: '{global_style}'. Khi viết các trường 'image_prompt' và 'video_prompts' cho kịch bản, bạn BẮT BUỘC phải tự động ghép chính xác phong cách này vào CUỐI tất cả các prompt (ngay cuối chuỗi tiếng Anh). Không được tự ý đổi phong cách khác hoặc để trống phong cách này!]"
        
        # Detect animation styles and enforce VIDEO STYLE matching
        style_lower = global_style.lower()
        is_donghua = any(kw in style_lower for kw in ["donghua", "đông hua", "hoạt hình trung quốc", "chinese animation", "wuxia", "xianxia", "tu tiên", "tiên hiệp"])
        is_anime = any(kw in style_lower for kw in ["anime", "nhật bản", "japanese animation", "manga"])
        is_3d_anim = any(kw in style_lower for kw in ["3d animation", "pixar", "dreamworks", "hoạt hình 3d"])
        
        if is_donghua:
            context += "\n[SYSTEM: ⚠️⚠️ CẢNH BÁO ART STYLE = DONGHUA! Khi viết video_prompts, TUYỆT ĐỐI KHÔNG dùng 'hyperrealistic cinematic photography', 'anamorphic lens', 'Arri Alexa', 'film grain'. Thay vào đó BẮT BUỘC dùng: 'premium 3D donghua animation, Chinese animated series style, smooth character animation, vibrant donghua color palette, dramatic donghua lighting, wuxia/xianxia atmosphere, donghua studio quality'. Video phải ra PHONG CÁCH ĐÔNG HUA, KHÔNG PHẢI LIVE-ACTION!]"
        elif is_anime:
            context += "\n[SYSTEM: ⚠️⚠️ CẢNH BÁO ART STYLE = ANIME! Khi viết video_prompts, TUYỆT ĐỐI KHÔNG dùng 'hyperrealistic cinematic photography'. BẮT BUỘC dùng: 'premium Japanese anime animation, anime studio quality, vibrant anime colors, cel-shaded, dynamic anime motion'. Video phải ra PHONG CÁCH ANIME, KHÔNG PHẢI LIVE-ACTION!]"
        elif is_3d_anim:
            context += "\n[SYSTEM: ⚠️⚠️ CẢNH BÁO ART STYLE = 3D ANIMATION! Khi viết video_prompts, TUYỆT ĐỐI KHÔNG dùng 'hyperrealistic cinematic photography'. BẮT BUỘC dùng: 'premium 3D animation, smooth character animation, vibrant colors, ray-traced lighting, animated film quality'. Video phải ra PHONG CÁCH HOẠT HÌNH 3D!]"

    if req.characters:
        context += f"\n[SYSTEM: Nhân vật đã tạo: {', '.join(req.characters)}. Dùng mode r2v nếu user muốn tham chiếu.]"
    
    # Check user messages to detect reference/story/consistency intent in history
    latest_user_msg = ""
    for m in reversed(req.messages):
        if m.role == "user":
            latest_user_msg = m.content.lower()
            break
    
    all_user_text = " ".join([m.content.lower() for m in req.messages if m.role == "user"])
    has_ever_requested_ref = any(kw in all_user_text for kw in ["tham chiếu", "reference", "đồng nhất", "nhân vật", "nhan vat", "sản phẩm tham chiếu", "san pham tham chieu", "story", "kể chuyện", "ke chuyen", "truyện", "phim hoạt hình", "phim hoat hinh"])
    
    is_explicit_t2v = any(kw in latest_user_msg for kw in ["text to video", "t2v", "không dùng ảnh", "không tham chiếu", "tạo từ text", "tao tu text"])
    is_confirm = any(kw in latest_user_msg for kw in ["ok", "chốt", "đồng ý", "tiếp tục", "làm đi", "tạo đi", "chạy đi", "phương án b", "phương án c", "chọn b", "chọn c", "b", "c", "yes", "confirm"])

    if (req.has_references or len(req.images_base64) > 0) and not is_explicit_t2v:
        context += "\n[SYSTEM: Người dùng ĐÃ tải lên hoặc có ảnh tham chiếu (sản phẩm/người mẫu) trong thư viện/canvas. Hãy ưu tiên sử dụng kịch bản dạng `i2v_pipeline` với `use_reference: true`. Tuyệt đối tránh dùng T2V (mode='t2v') khi đã có ảnh tham chiếu unless explicitly asked!]"
    elif has_ever_requested_ref and not is_explicit_t2v:
        # User wants reference-based or Story
        if is_confirm:
            context += "\n[SYSTEM: Người dùng ĐÃ XÁC NHẬN lựa chọn phương án tạo ảnh trước rồi video từ ảnh (hoặc Story đồng nhất nhân vật). Bạn hãy xuất thẳng kịch bản JSON action (dạng 'story' hoặc 'i2v_pipeline') khớp với mô tả của người dùng, TUYỆT ĐỐI KHÔNG dùng mode='t2v' và không được hỏi lại nữa! Hãy giải thích quy trình 2 bước tuần tự trong phần văn bản phản hồi.]"
        else:
            context += "\n[SYSTEM: Người dùng yêu cầu tạo video DẠNG THAM CHIẾU / STORY KỂ CHUYỆN / NHÂN VẬT ĐỒNG NHẤT. BẮT BUỘC bạn phải dừng lại giải thích quy trình 2 bước tuần tự (tạo ảnh trước bối cảnh/nhân vật để duyệt rồi mới animate thành video) và HỎI người dùng muốn đi theo phương án nào (A: T2V trực tiếp, B: I2V tạo ảnh trước rồi animate, hay C: Story tạo nhân vật đồng nhất làm tham chiếu) và KHÔNG được tự ý xuất thẳng kịch bản JSON T2V khi chưa nhận được sự đồng ý của họ!]"
    else:
        # No references, or explicitly asked for T2V
        if is_confirm:
            context += "\n[SYSTEM: Người dùng ĐÃ XÁC NHẬN phương án tạo. Hãy xuất thẳng kịch bản JSON action (dạng 'i2v_pipeline' nếu chọn tạo ảnh trước rồi animate, hoặc 'generate_scenes' mode='t2v' nếu chọn T2V trực tiếp) khớp với mô tả của họ, không hỏi lại nữa!]"
        else:
            context += "\n[SYSTEM: Người dùng KHÔNG có ảnh tham chiếu hoặc yêu cầu tạo bằng Text-to-Video (T2V). Bạn BẮT BUỘC PHẢI giới thiệu các phương án tạo (T2V trực tiếp hay I2V tạo ảnh trước) và HỎI người dùng xác nhận lựa chọn trước khi xuất JSON action. Tuyệt đối không tự ý xuất thẳng kịch bản JSON khi chưa hỏi ý kiến xác nhận của họ!]"

    # Build conversation
    full_prompt = COMBINED_AGENT_SYSTEM + context + "\n\n"
    for msg in req.messages:
        if msg.role == "user":
            full_prompt += f"User: {msg.content}\n\n"
        else:
            full_prompt += f"Assistant: {msg.content}\n\n"
    full_prompt += "Assistant:"

    # Build parts for API (support multiple images)
    parts = [{"text": full_prompt}]
    # Collect all non-empty images
    all_images = [img for img in (req.images_base64 or []) if img and len(img) > 100]
    if not all_images and req.image_base64 and len(req.image_base64) > 100:
        all_images = [req.image_base64]
    
    for idx, img_b64 in enumerate(all_images):
        try:
            # Strip data URL prefix if present
            clean_b64 = img_b64.split(",")[-1] if "," in img_b64 else img_b64
            parts.append({
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": clean_b64,
                }
            })
        except Exception as e:
            print(f"[Agent] Skip image {idx}: {e}")
    
    # Collect and inject all non-empty audios
    all_audios = [aud for aud in (req.audios_base64 or []) if aud and len(aud) > 100]
    for idx, aud_b64 in enumerate(all_audios):
        try:
            clean_b64 = aud_b64.split(",")[-1] if "," in aud_b64 else aud_b64
            parts.append({
                "inline_data": {
                    "mime_type": "audio/mp3",
                    "data": clean_b64,
                }
            })
            print(f"[Agent] Injected audio {idx} to Gemini parts successfully")
        except Exception as e:
            print(f"[Agent] Skip audio {idx}: {e}")
    
    if all_images:
        # Prepend image analysis instruction with SHORT PROMPT reminder
        parts[0] = {"text": f"[SYSTEM: User đã tải lên {len(all_images)} ảnh tham chiếu. Dùng pipeline R2I→I2V. ⚠️ QUAN TRỌNG: image_prompt PHẢI NGẮN GỌN 5-15 từ, chỉ mô tả cảnh+hành động. VD: 'the product on a table, warm light' hoặc 'cô gái cầm sản phẩm, phòng bếp'. KHÔNG mô tả chi tiết sản phẩm/người — AI tự nhận diện từ ảnh!]\n\n" + parts[0]["text"]}

    if all_audios:
        # Prepend audio script guidelines
        parts[0] = {"text": f"[SYSTEM: User đã tải lên file âm thanh (MP3/WAV) để phân tích lời thoại/kịch bản. Hãy lắng nghe và phân tích kỹ nội dung lời thoại đó. Nhiệm vụ của bạn:\n1. Đưa ra 3 gợi ý kịch bản video khác nhau khớp với lời thoại/ngữ cảnh trong file âm thanh này (VD: Gợi ý 1: Phong cách Kịch tính/Storytelling, Gợi ý 2: Phong cách Đời thường/Lifestyle/UGC, Gợi ý 3: Phong cách Review chi tiết/TikTok Review).\n2. Gợi ý phong cách hình ảnh (Art Style) phù hợp cho mỗi gợi ý kịch bản.\n3. Hỏi người dùng lựa chọn kịch bản/phong cách nào trước khi sinh JSON action kịch bản chi tiết.\n4. Sau khi người dùng chốt phương án, sinh action i2v_pipeline hoặc story tương ứng. Các cảnh video 8s phải không tiếng diễn xuất tốt khớp với ngữ cảnh thoại đoạn đó.]\n\n" + parts[0]["text"]}

    try:
        result = await call_ai(
            parts=parts,
            endpoint=req.ai_endpoint,
            api_key=req.ai_key,
            model=req.ai_model,
        )

        # Parse actions
        actions = []
        text_response = result

        action_pattern = re.compile(r'```action\s*\n?(.*?)\n?```', re.DOTALL)
        matches = action_pattern.findall(result)

        for match in matches:
            try:
                action = json.loads(match.strip())
                actions.append(action)
                text_response = text_response.replace(f'```action\n{match}\n```', '').strip()
                text_response = text_response.replace(f'```action{match}```', '').strip()
            except json.JSONDecodeError:
                pass

        text_response = re.sub(r'\n{3,}', '\n\n', text_response).strip()
        text_response = re.sub(r'```\s*```', '', text_response).strip()

        # ─── Auto-fix R2I prompts: ensure every scene mentions "the product" ───
        for action in actions:
            use_ref = action.get("use_reference", False)
            if not use_ref:
                continue
            scenes = action.get("scenes") or action.get("images") or []
            for scene in scenes:
                img_prompt = scene.get("image_prompt") or scene.get("prompt") or ""
                # Check if prompt mentions "the product" or "the model"
                lower_p = img_prompt.lower()
                has_ref_keyword = any(k in lower_p for k in ["the product", "the model", "sản phẩm", "người mẫu"])
                if not has_ref_keyword and img_prompt:
                    # Auto-prepend short reference — keep it minimal!
                    fixed = f"The product in the scene. {img_prompt}"
                    if "image_prompt" in scene:
                        scene["image_prompt"] = fixed
                    else:
                        scene["prompt"] = fixed
                    print(f"[Agent] Auto-fixed R2I prompt: added 'the product' to scene {scene.get('number', '?')}")

        # ─── Auto-enhance prompts if enabled ───
        # ⚠️ SKIP enhancement for R2I actions — R2I prompts MUST stay SHORT!
        if req.enhance_prompts and actions:
            for action in actions:
                use_ref = action.get("use_reference", False)
                
                # R2I: DO NOT enhance image_prompt — keep them short as-is
                if use_ref:
                    print(f"[Prompt Enhancer] SKIPPED for R2I action (use_reference=true) — prompts stay short")
                    continue
                
                scenes = action.get("scenes") or action.get("images") or []
                raw_prompts = []
                for s in scenes:
                    p = s.get("image_prompt") or s.get("prompt") or ""
                    if p:
                        raw_prompts.append(p)

                if raw_prompts:
                    try:
                        enhanced = await enhance_prompts_batch(
                            raw_prompts,
                            req.ai_endpoint, req.ai_key, req.ai_model,
                        )
                        if enhanced and len(enhanced) == len(raw_prompts):
                            idx = 0
                            for s in scenes:
                                key = "image_prompt" if "image_prompt" in s else "prompt"
                                if s.get(key):
                                    s[key] = enhanced[idx]
                                    idx += 1
                    except Exception as e:
                        print(f"[Prompt Enhancer] Skipped: {e}")

        agents_used = ["director", "script"]
        if all_audios:
            agents_used.insert(1, "music")
        if req.enhance_prompts and actions:
            agents_used.append("prompt_enhancer")

        # ─── Auto-append global visual style to all returned actions (double-safe guarantee) ───
        if global_style:
            print(f"[Agent Post-Process] Enforcing visual style suffix: {global_style[:30]}...")
            for action in actions:
                scenes = action.get("scenes") or action.get("images") or []
                for s in scenes:
                    # Append style to image_prompt or prompt
                    img_key = "image_prompt" if "image_prompt" in s else "prompt" if "prompt" in s else None
                    if img_key and s.get(img_key):
                        s[img_key] = _append_art_style_suffix(s[img_key], global_style)
                    
                    # Append style to video_prompts
                    if "video_prompts" in s and isinstance(s["video_prompts"], list):
                        s["video_prompts"] = [_append_art_style_suffix(vp, global_style) for vp in s["video_prompts"] if vp]

        return {
            "success": True,
            "message": text_response,
            "actions": actions,
            "agents_used": agents_used,
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/agent/enhance-prompts")
async def enhance_prompts_endpoint(req: EnhanceRequest):
    """Standalone prompt enhancement endpoint."""
    if not req.ai_key:
        return {"success": False, "error": "API key required"}

    try:
        enhanced = await enhance_prompts_batch(
            req.prompts, req.ai_endpoint, req.ai_key, req.ai_model,
        )
        return {"success": True, "enhanced": enhanced}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def enhance_prompts_batch(prompts: list[str], endpoint: str, api_key: str, model: str, use_r2i_mode: bool = False) -> list[str]:
    """Call Prompt Enhancer sub-agent to enhance a batch of prompts."""
    input_json = json.dumps({"prompts": prompts}, ensure_ascii=False)
    # Use R2I enhancer (keeps prompts SHORT) or full enhancer (adds detail)
    enhancer_prompt = PROMPT_ENHANCER_R2I_PROMPT if use_r2i_mode else PROMPT_ENHANCER_PROMPT
    mode_label = "R2I (minimal)" if use_r2i_mode else "Full"
    print(f"[Prompt Enhancer] Mode: {mode_label}, prompts: {len(prompts)}")
    
    proj_config = _load_project()
    global_style = proj_config.get("globalArtStyle", "")
    style_instruction = ""
    if global_style:
        style_instruction = f"\n\n⚠️ PHONG CÁCH HÌNH ẢNH THỐNG NHẤT (UNIFIED VISUAL STYLE):\nPhong cách chủ đạo hiện tại là: '{global_style}'. Bạn BẮT BUỘC phải tự động ghép chính xác phong cách này vào CUỐI tất cả các prompt được nâng cấp của bạn. Tuyệt đối không được đổi phong cách khác hoặc để trống!\n"

    full_prompt = enhancer_prompt + style_instruction + f"\n\nInput:\n{input_json}\n\nOutput (JSON only):"

    result = await call_ai(
        parts=[{"text": full_prompt}],
        endpoint=endpoint, api_key=api_key, model=model,
    )

    # Parse JSON from response
    # Try to find JSON in the response
    json_match = re.search(r'\{.*"enhanced".*\}', result, re.DOTALL)
    if json_match:
        data = json.loads(json_match.group())
        return data.get("enhanced", prompts)

    # Fallback: try to parse the entire response
    try:
        data = json.loads(result)
        return data.get("enhanced", prompts)
    except:
        print(f"[Prompt Enhancer] Could not parse response, returning originals")
        return prompts


# Legacy endpoint
class ScriptRequest(BaseModel):
    request: str
    characters: list[str] = []
    duration_minutes: float = 2
    style: str = "cinematic"
    ai_endpoint: str = "http://127.0.0.1:8045"
    ai_key: str = ""
    ai_model: str = "gemini-3-flash"


@router.post("/api/agent/generate-script")
async def generate_script(req: ScriptRequest):
    """Legacy: Generate screenplay (non-chat mode)."""
    if not req.ai_key:
        return {"success": False, "error": "API key required."}

    num_scenes = max(1, round((req.duration_minutes * 60) / 8))
    prompt = f"""Create EXACTLY {num_scenes} video scene prompts for:
"{req.request}"
Characters: {', '.join(req.characters) if req.characters else 'generic'}
Style: {req.style}
Return ONLY a JSON array:
[{{"number":1,"prompt":"English prompt...","description":"Vietnamese desc..."}}]"""

    try:
        result = await call_ai(
            parts=[{"text": COMBINED_AGENT_SYSTEM + "\n\nTạo ngay:\n" + prompt}],
            endpoint=req.ai_endpoint, api_key=req.ai_key, model=req.ai_model,
        )
        json_start = result.find("[")
        json_end = result.rfind("]") + 1
        if json_start == -1 or json_end == 0:
            return {"success": False, "error": "AI did not return valid JSON", "raw": result[:500]}
        scenes = json.loads(result[json_start:json_end])
        return {
            "success": True,
            "script": {
                "title": req.request[:50],
                "total_scenes": len(scenes),
                "estimated_duration": f"{len(scenes) * 8}s (~{len(scenes) * 8 / 60:.1f} min)",
                "scenes": scenes,
            },
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def call_ai(parts: list, endpoint: str, api_key: str, model: str) -> str:
    """Call AI via proxy (Gemini format with multimodal support). Supports API Key Rotation."""
    endpoint = endpoint.rstrip('/')
    if endpoint.endswith('/v1'):
        base_endpoint = endpoint[:-3] # Remove /v1
        url = f"{base_endpoint}/v1beta/models/{model}:generateContent"
    else:
        url = f"{endpoint}/v1beta/models/{model}:generateContent"
        
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.9,
            "maxOutputTokens": 32768,
        },
    }

    # Tách danh sách API keys nếu người dùng nhập nhiều key (cách nhau bởi dấu phẩy, chấm phẩy hoặc xuống dòng)
    keys = []
    if api_key:
        clean_key_str = api_key.replace("\r\n", ",").replace("\n", ",").replace(";", ",")
        keys = [k.strip() for k in clean_key_str.split(",") if k.strip()]
    
    if not keys:
        raise Exception("Cần API key. Cấu hình trong Settings → AI Director.")

    last_error = None
    for idx, current_key in enumerate(keys):
        print(f"[API Key Rotation] Thử sử dụng API Key {idx + 1}/{len(keys)} (độ dài: {len(current_key)} chars)...")
        try:
            print(f"[AI Agent] Calling: {url} (parts: {len(parts)})")

            async with httpx.AsyncClient(timeout=90.0) as client:
                try:
                    res = await client.post(
                        url, json=body,
                        headers={
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {current_key}",
                        },
                    )
                except Exception as e:
                    raise Exception(f"Không kết nối được AI proxy: {e}")

            print(f"[AI Agent] Status: {res.status_code}")

            if res.status_code != 200:
                # Fallback to OpenAI format
                if endpoint.endswith('/v1'):
                    url2 = f"{endpoint}/chat/completions"
                else:
                    url2 = f"{endpoint}/v1/chat/completions"
                
                text_content = next((p["text"] for p in parts if "text" in p), "")
                body2 = {
                    "model": model,
                    "messages": [{"role": "user", "content": text_content}],
                    "temperature": 0.9,
                    "max_tokens": 16384,
                }
                async with httpx.AsyncClient(timeout=90.0) as client:
                    try:
                        res2 = await client.post(url2, json=body2, headers={
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {current_key}",
                        })
                    except Exception as e:
                        raise Exception(f"Gemini ({res.status_code}) + OpenAI lỗi: {e}")

                if not res2.text:
                    raise Exception(f"Response trống (status {res2.status_code})")
                try:
                    data2 = res2.json()
                except:
                    raise Exception(f"Không phải JSON: {res2.text[:200]}")
                if "choices" in data2:
                    return data2["choices"][0]["message"]["content"]
                raise Exception(f"Unexpected: {str(data2)[:200]}")

            if not res.text:
                raise Exception("Response trống")
            try:
                data = res.json()
            except:
                raise Exception(f"Không phải JSON: {res.text[:200]}")

            if "candidates" in data and data["candidates"]:
                return data["candidates"][0]["content"]["parts"][0]["text"]
            if "error" in data:
                raise Exception(data["error"].get("message", str(data["error"])))
            raise Exception(f"Unexpected: {str(data)[:200]}")

        except Exception as e:
            print(f"[API Key Rotation] API Key {idx + 1} gặp lỗi: {e}")
            last_error = e
            # Nếu gặp lỗi (429, 403, 401...) và còn key dự phòng khác, tự động xoay sang key tiếp theo
            if idx < len(keys) - 1:
                print(f"[API Key Rotation] 🔄 Phát hiện lỗi quá tải/tạm thời. Đang tự động xoay sang API Key tiếp theo...")
                continue
            else:
                break

    raise Exception(f"Tất cả {len(keys)} API Key đều thất bại. Lỗi cuối cùng: {last_error}")
