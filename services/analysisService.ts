
import { GoogleGenAI, Type } from "@google/genai";
import { languages } from '../src/languages';
import { withKeyModelRetry, getApiKeys } from './apiKeyService';
import { isProxyEnabled, withProxyRetry, proxyFetchCompletion } from './openaiProxyService';
import {
    AnalysisState,
    StepStatus,
    GeminiAnalysisResponse,
    KeyframeOutput,
    VideoMetadata,
    GeminiScene,
    StoryOutline,
    GeminiAsset,
    AudioMode,
} from '../types';

export class QuotaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'QuotaError';
    }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mapping style code → label đầy đủ cho AI hiểu rõ
const STYLE_LABEL_MAP: Record<string, string> = {
    'cinematic': 'Phong cách video Cinematic (Điện ảnh)',
    'anime': 'Phong cách video Anime (Hoạt hình Nhật)',
    'ghibli': 'Phong cách video Ghibli (Studio Ghibli)',
    '3d': 'Phong cách video 3D / Pixar',
    'cartoon': 'Phong cách video Cartoon (Hoạt hình)',
    'minecraft': 'Phong cách video Minecraft',
    'pixel-art': 'Phong cách video Pixel Art',
    'watercolor': 'Phong cách video Watercolor (Màu nước)',
    'oil-painting': 'Phong cách video Oil Painting (Sơn dầu)',
    'stickman': 'Phong cách video Stickman (Người que)',
    'chibi': 'Phong cách video Chibi (Đầu to)',
    'animal': 'Phong cách video Animal (Động vật)',
    'faceless': 'Phong cách video Faceless (Không host)',
    'vtuber': 'Phong cách video VTuber (Avatar ảo)',
    'silhouette': 'Phong cách video Silhouette (Bóng đen)',
    'superhero': 'Phong cách video Superhero',
    'voiceover': 'Phong cách video Voiceover (Lồng tiếng/Thuyết minh)',
};

function getStyleLabel(style: string): string {
    return STYLE_LABEL_MAP[style] || `Phong cách video ${style}`;
}

const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h > 0 ? h : null, m, s]
        .filter(x => x !== null)
        .map(x => String(x).padStart(2, '0'))
        .join(':');
};

const parseTimestamp = (ts: string): number => {
    if (!ts) return 0;
    const parts = ts.split(':').map(p => parseInt(p, 10) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
};


// ═══════════════════════════════════════════════════════
// Language Verbosity — Giảm số từ cho ngôn ngữ dài hơn
// ═══════════════════════════════════════════════════════
// Hệ số "phồng" của từng ngôn ngữ so với tiếng Anh (1.0).
// Ví dụ: tiếng Đức trung bình dài hơn ~30%, tiếng Ả Rập ~25%.
const LANGUAGE_VERBOSITY: Record<string, number> = {
    vi: 1.0,   // Tiếng Việt — chuẩn
    en: 1.0,   // English — chuẩn
    zh: 0.8,   // 中文 — ngắn hơn (ký tự đơn âm)
    ja: 0.85,  // 日本語 — tương đối ngắn
    ko: 0.9,   // 한국어 — tương đối ngắn
    th: 1.1,   // ไทย — hơi dài hơn
    id: 1.2,   // Indonesia — dài hơn đáng kể
    hi: 1.25,  // हिन्दी — dài hơn
    fr: 1.25,  // Français — dài hơn ~25%
    es: 1.2,   // Español — dài hơn ~20%
    ru: 1.2,   // Русский — dài hơn ~20%
    de: 1.35,  // Deutsch — dài hơn ~35% (từ ghép dài)
    pt: 1.25,  // Português — dài hơn ~25%
    ar: 1.25,  // العربية — dài hơn ~25%
};

// ═══════════════════════════════════════════════════════
// Voice-Language Mapping — TTS voice phải khớp ngôn ngữ
// ═══════════════════════════════════════════════════════
// Mỗi ngôn ngữ có danh sách voice phù hợp. AI PHẢI chọn voice từ danh sách này.
const LANGUAGE_VOICE_MAP: Record<string, { locale: string; voices: string[] }> = {
    vi: { locale: 'vi-VN', voices: ['vi-VN-female-warm', 'vi-VN-male-calm', 'vi-VN-female-bright', 'vi-VN-male-deep'] },
    en: { locale: 'en-US', voices: ['en-US-female-warm', 'en-US-male-deep', 'en-US-female-bright', 'en-US-male-calm'] },
    zh: { locale: 'zh-CN', voices: ['zh-CN-female-warm', 'zh-CN-male-calm', 'zh-CN-female-bright', 'zh-CN-male-deep'] },
    ja: { locale: 'ja-JP', voices: ['ja-JP-female-warm', 'ja-JP-male-calm', 'ja-JP-female-bright', 'ja-JP-male-deep'] },
    ko: { locale: 'ko-KR', voices: ['ko-KR-female-warm', 'ko-KR-male-calm', 'ko-KR-female-bright', 'ko-KR-male-deep'] },
    th: { locale: 'th-TH', voices: ['th-TH-female-warm', 'th-TH-male-calm', 'th-TH-female-bright', 'th-TH-male-deep'] },
    id: { locale: 'id-ID', voices: ['id-ID-female-warm', 'id-ID-male-calm', 'id-ID-female-bright', 'id-ID-male-deep'] },
    hi: { locale: 'hi-IN', voices: ['hi-IN-female-warm', 'hi-IN-male-calm', 'hi-IN-female-bright', 'hi-IN-male-deep'] },
    fr: { locale: 'fr-FR', voices: ['fr-FR-female-warm', 'fr-FR-male-calm', 'fr-FR-female-bright', 'fr-FR-male-deep'] },
    es: { locale: 'es-ES', voices: ['es-ES-female-warm', 'es-ES-male-calm', 'es-ES-female-bright', 'es-ES-male-deep'] },
    ru: { locale: 'ru-RU', voices: ['ru-RU-female-warm', 'ru-RU-male-calm', 'ru-RU-female-bright', 'ru-RU-male-deep'] },
    de: { locale: 'de-DE', voices: ['de-DE-female-warm', 'de-DE-male-calm', 'de-DE-female-bright', 'de-DE-male-deep'] },
    pt: { locale: 'pt-BR', voices: ['pt-BR-female-warm', 'pt-BR-male-calm', 'pt-BR-female-bright', 'pt-BR-male-deep'] },
    ar: { locale: 'ar-SA', voices: ['ar-SA-female-warm', 'ar-SA-male-calm', 'ar-SA-female-bright', 'ar-SA-male-deep'] },
};

/** Trả về locale và danh sách voice cho language code */
const getVoiceConfig = (langCode: string) => {
    return LANGUAGE_VOICE_MAP[langCode] || LANGUAGE_VOICE_MAP['en'];
};

/** Tạo hướng dẫn voice cho AI prompt */
const getVoiceInstructions = (langCode: string, langName: string): string => {
    const config = getVoiceConfig(langCode);
    return `
🎤 VOICE / TTS — QUY TẮC NGHIÊM NGẶT:
   - Ngôn ngữ bắt buộc cho voice: ${langName} (locale: ${config.locale})
   - Danh sách voice hợp lệ: ${config.voices.join(', ')}
   - Mỗi nhân vật PHẢI được gán 1 voice_id từ danh sách trên. KHÔNG được dùng voice ngoài danh sách.
   - voice_id của nhân vật PHẢI thuộc locale ${config.locale}. TUYỆT ĐỐI KHÔNG dùng voice của ngôn ngữ khác.
   - VD: Nếu ngôn ngữ là ${langName}, KHÔNG được gán voice "en-US-...", "ja-JP-..." hay bất kỳ locale nào khác.
   - Nhân vật nam → chọn voice "...-male-...". Nhân vật nữ → chọn voice "...-female-...".
   - 2 nhân vật khác nhau PHẢI có voice_id khác nhau (để phân biệt khi TTS).
   - speaker_id trong mỗi cảnh PHẢI khớp với Character ID đã định nghĩa.`;
};

/**
 * Trả về hướng dẫn giới hạn từ cho script dựa trên ngôn ngữ.
 * ÁP DỤNG CHO TẤT CẢ NGÔN NGỮ — kể cả vi, en.
 * Mỗi cảnh ~8 giây. TTS nói ~2 từ/giây → tối đa ~15 từ/cảnh.
 * Ngôn ngữ dài hơn (de, fr...) → giảm thêm.
 */
const getScriptWordLimitRule = (langCode: string, langName: string, density: number = 8): string => {
    const factor = LANGUAGE_VERBOSITY[langCode] ?? 1.0;

    // Công thức: TTS ~2 từ/giây × số giây × 0.9375 (buffer an toàn)
    // 8s →15 từ | 6s →11 từ | 10s →19 từ | ngôn ngữ verbose → giảm thêm.
    const maxWords = Math.round((density * 1.875) / factor);
    const hardCap  = Math.round((density * 2.25)  / factor);

    return `
⚠️ GIỚI HẠN SCRIPT/THOẠI — BẮT BUỘC:
   - Mỗi cảnh = ĐÚNG ${density} GIÂY. TTS ~2 từ/giây → script quá ${density}s = bị cắt.
   - TỐI ĐA ${maxWords} từ/cảnh. HARD CAP = ${hardCap} từ tuyệt đối.
   - 1 câu chính + tối đa 1 mệnh đề phụ. Cắt bỏ tính từ thừa.
   - VD đúng (${density}s): "Anh nhìn cô qua ô cửa. Ánh chiều buồn."`;
};

const storyOutlineSchema = {
    type: Type.OBJECT,
    properties: {
        title: { type: Type.STRING, description: "A creative, compelling title for the story." },
        logline: { type: Type.STRING, description: "A punchy one-sentence hook that captures the story's core conflict and stakes." },
        characters: {
            type: Type.ARRAY,
            description: "List of ALL important characters with unique IDs and detailed visual character-sheet prompts.",
            items: {
                type: Type.OBJECT,
                properties: {
                    id: { type: Type.STRING, description: "Unique fixed Character Anchor ID in format [NAME_V1], e.g. [HERO_V1], [VILLAIN_V1]. Used in ALL scene prompts." },
                    name: { type: Type.STRING, description: "Full display name of the character." },
                    prompt: { type: Type.STRING, description: "Character sheet prompt: appearance, clothing, weapons, special effects/aura, personality keywords. Plain text only, no labels." },
                    voice_id: { type: Type.STRING, description: "TTS voice label matching the target language locale. Must be from the provided voice list. E.g. 'vi-VN-female-warm', 'en-US-male-deep'." },
                    original_names: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "List of original names of this character in the source video URL (if applicable, e.g. ['Raju', 'Amit']), to help mapping. Empty array if not applicable."
                    }
                },
                required: ['id', 'name', 'prompt', 'voice_id']
            }
        },
        parts: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    part_id: { type: Type.INTEGER },
                    title: { type: Type.STRING, description: "Evocative title for this story beat." },
                    summary: { type: Type.STRING, description: "Detailed summary of this part's events." },
                    script: { type: Type.STRING, description: "Draft voiceover/dialogue for this part — MUST be SHORT: max 2-3 sentences, total ≤40 words. Each sentence max 15 words. This will be split across ~8-second video scenes." },
                    start_time: { type: Type.STRING, description: "Start timestamp 'mm:ss'." },
                    end_time: { type: Type.STRING, description: "End timestamp 'mm:ss'." },
                },
                required: ['part_id', 'title', 'summary', 'script', 'start_time', 'end_time']
            }
        }
    },
    required: ['title', 'logline', 'characters', 'parts']
};

// ─── Scene Blueprint: phân bổ nội dung từng scene trước khi viết prompt ───
interface SceneBlueprintItem {
    scene_index: number;
    part_id: number;
    t0: string;
    t1: string;
    content_brief: string;
    script_draft: string;
    visual_hint: string;
}

const sceneBlueprintSchema = {
    type: Type.OBJECT,
    properties: {
        scenes: {
            type: Type.ARRAY,
            description: "Danh sách chi tiết từng scene đã phân bổ vào đúng phần (part) tương ứng.",
            items: {
                type: Type.OBJECT,
                properties: {
                    scene_index: { type: Type.INTEGER, description: "Số thứ tự scene (1, 2, 3...)" },
                    part_id: { type: Type.INTEGER, description: "ID phần dàn ý (số nguyên) mà scene này thuộc về (1, 2, 3...)" },
                    t0: { type: Type.STRING, description: "Timestamp bắt đầu 'mm:ss'" },
                    t1: { type: Type.STRING, description: "Timestamp kết thúc 'mm:ss'" },
                    content_brief: { type: Type.STRING, description: "Tóm tắt ngắn gọn nội dung/diễn biến chính của scene này (1-2 câu)" },
                    script_draft: { type: Type.STRING, description: "Lời thoại/thuyết minh nháp cho scene (ngắn gọn, sẽ được triển khai chi tiết ở bước sau)" },
                    visual_hint: { type: Type.STRING, description: "Gợi ý hình ảnh: bối cảnh, góc máy, ánh sáng, hành động chính" },
                },
                required: ['scene_index', 'part_id', 't0', 't1', 'content_brief', 'script_draft', 'visual_hint']
            }
        }
    },
    required: ['scenes']
};

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        video_meta: {
            type: Type.OBJECT,
            properties: {
                url: { type: Type.STRING },
                title: { type: Type.STRING },
                duration_sec: { type: Type.NUMBER },
                audio_mode: {
                    type: Type.STRING,
                    enum: ['dialogue', 'narration', 'asmr'],
                    description: "'dialogue' if the video has character conversations, 'narration' if it's a single-voice voiceover/commentary, 'asmr' if video has no speech - only ASMR sounds (tapping, scratching, whispering, etc.)."
                },
                style: {
                    type: Type.OBJECT,
                    properties: {
                        mood: { type: Type.STRING },
                        palette: { type: Type.ARRAY, items: { type: Type.STRING } },
                        music: { type: Type.STRING }
                    },
                    required: ['mood', 'palette', 'music']
                }
            },
            required: ['url', 'title', 'duration_sec', 'audio_mode', 'style']
        },
        character_profile: {
            type: Type.OBJECT,
            properties: {
                id: { type: Type.STRING, description: "Unique Character ID (e.g., [AMARA_V1])" },
                description: { type: Type.STRING, description: "General character description" },
                physical_traits: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Detailed physical traits" }
            },
            required: ['id', 'description', 'physical_traits']
        },
        style_profile: {
            type: Type.OBJECT,
            properties: {
                medium: { type: Type.STRING, description: "Cinematic, 2D Anime, 3D Render, etc." },
                lighting: { type: Type.STRING, description: "Lighting details" },
                color_grading: { type: Type.STRING, description: "Color grading details" },
                lens_film: { type: Type.STRING, description: "Lens or film stock details" },
                environment_materials: { type: Type.STRING, description: "Materials like old bricks, misty forest, etc." },
                style_tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Independent style tags" }
            },
            required: ['medium', 'lighting', 'color_grading', 'lens_film', 'environment_materials', 'style_tags']
        },
        scenes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    scene_id: { type: Type.INTEGER },
                    t0: { type: Type.STRING },
                    t1: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    action_prompt: { type: Type.STRING, description: "Action & Camera Flow: Verbs + Camera Movements only." },
                    CAM: { type: Type.STRING },
                    SUBJ: { type: Type.STRING },
                    SET: { type: Type.STRING },
                    MOOD: { type: Type.STRING },
                    FX: { type: Type.STRING },
                    CLR: { type: Type.STRING },
                    SND: { type: Type.STRING },
                    EDIT: { type: Type.STRING },
                    RNDR: { type: Type.STRING },
                    '!FOCAL': { type: Type.STRING },
                    TIM: { type: Type.STRING },
                    title: { type: Type.STRING },
                    style_video: { type: Type.STRING },
                    script: { type: Type.STRING, description: "THE ACTUAL VOICEOVER/DIALOGUE TEXT for this scene. MAX 15 WORDS (TTS reads ~2 words/sec, scene is 8 seconds). Dialogue mode: '[CHAR_ID]: text'. Narration mode: plain prose. MUST be 100% in the target language." },
                    speaker_id: { type: Type.STRING, description: "Character ID of the primary speaker in this scene. Use null string '~' if no speaker (narration/no dialogue)." },
                    voice_locale: { type: Type.STRING, description: "The TTS voice locale for this scene's speaker, e.g. 'vi-VN', 'en-US', 'ko-KR'. Must match the target output language." }
                },
                required: [
                    'scene_id', 't0', 't1', 'summary', 'action_prompt', 'CAM', 'SUBJ', 'SET', 'MOOD', 'FX',
                    'CLR', 'SND', 'EDIT', 'RNDR', '!FOCAL', 'TIM', 'title', 'style_video', 'script', 'speaker_id', 'voice_locale'
                ]
            }
        },
        assets: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    id: { type: Type.STRING },
                    type: { type: Type.STRING },
                    description: { type: Type.STRING }
                },
                required: ['id', 'type', 'description']
            }
        }
    },
    required: ['video_meta', 'scenes', 'assets', 'character_profile', 'style_profile']
};

const getErrorMessage = (error: any): string => {
    if (!error) return 'unknown';
    if (typeof error === 'string') return error.toLowerCase();
    if (error instanceof Error) return error.message.toLowerCase();
    return JSON.stringify(error).toLowerCase();
};

const sanitizeJsonString = (rawString: string): string => {
    const trimmed = rawString.trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return (match && match[1]) ? match[1] : trimmed;
};

/**
 * Chuyển đổi định dạng Gemini Contents (parts có inlineData/text) sang định dạng OpenAI Multimodal (content blocks)
 * để đảm bảo các Proxy Server (như OpenRouter, OpenAI Proxy) không bị lỗi 400 Bad Request khi truyền ảnh.
 */
const convertGeminiContentsToOpenAI = (geminiContents: any): any => {
    if (!geminiContents) return "";
    
    // Nếu là string trần
    if (typeof geminiContents === 'string') return geminiContents;
    
    // Nếu là Object Gemini có dạng { parts: [...] } hoặc { contents: { parts: [...] } }
    if (geminiContents && typeof geminiContents === 'object') {
        let parts = (geminiContents as any).parts;
        if (!parts && (geminiContents as any).contents && (geminiContents as any).contents.parts) {
            parts = (geminiContents as any).contents.parts;
        }
        
        if (Array.isArray(parts)) {
            return parts.map((part: any) => {
                if (part.text) {
                    return { type: 'text', text: part.text };
                }
                if (part.inlineData) {
                    const mime = part.inlineData.mimeType || 'image/png';
                    const base64 = part.inlineData.data;
                    return {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mime};base64,${base64}`
                        }
                    };
                }
                return null;
            }).filter(x => x !== null);
        }
    }
    
    // Nếu là mảng các Content block hoặc các Part
    if (Array.isArray(geminiContents)) {
        return geminiContents.map((part: any) => {
            if (typeof part === 'string') return { type: 'text', text: part };
            if (part.text) return { type: 'text', text: part.text };
            if (part.inlineData) {
                const mime = part.inlineData.mimeType || 'image/png';
                const base64 = part.inlineData.data;
                return {
                    type: 'image_url',
                    image_url: {
                        url: `data:${mime};base64,${base64}`
                    }
                };
            }
            return null;
        }).filter(x => x !== null);
    }
    
    return geminiContents;
};

/**
 * Chuẩn hoá contents cho SDK @google/genai.
 * SDK mới mong đợi mảng các Part hoặc mảng các Content thay vì Object { parts: [...] } trực tiếp.
 */
const convertContentsForGeminiSdk = (contents: any): any => {
    if (contents && typeof contents === 'object' && 'parts' in contents) {
        return (contents as any).parts; // Trích xuất trực tiếp mảng parts
    }
    return contents;
};

const generateAndParseJsonWithRetry = async <T>(
    modelId: string,
    contents: any,
    schema: any,
    maxRetries: number,
    onRetry: (attempt: number, delay: number, reason: string) => void,
    signal?: AbortSignal
): Promise<T> => {
    // ═══ BƯỚC 1: Kiểm tra có Gemini API Key không ═══
    const geminiKeys = getApiKeys();
    const hasGeminiKeys = geminiKeys.length > 0 && geminiKeys.some(k => k.key && k.key.trim() !== '');

    // ═══ LUỒNG GEMINI TRỰC TIẾP (ưu tiên) ═══
    if (hasGeminiKeys) {
        const apiCall = async (currentKey: string, currentModel: string): Promise<T> => {
            if (signal?.aborted) throw new DOMException('Phan tich da bi dung', 'AbortError');
            const ai = new GoogleGenAI({ apiKey: currentKey });
            const geminiSdkContents = convertContentsForGeminiSdk(contents);
            const response = await ai.models.generateContent({
                model: currentModel,
                contents: geminiSdkContents,
                config: { 
                    responseMimeType: 'application/json', 
                    responseSchema: schema,
                }
            });
            const text = response.text;
            if (!text) throw new Error("Empty AI response");
            return JSON.parse(sanitizeJsonString(text)) as T;
        };

        try {
            return await withKeyModelRetry(
                apiCall,
                modelId,
                maxRetries,
                3000,
                'generateAndParse',
                (attempt, delay, error) => {
                    const msg = error instanceof Error ? error.message : String(error);
                    onRetry(attempt, delay, msg);
                }
            );
        } catch (geminiError: any) {
            // ═══ GEMINI HẾT → FALLBACK PROXY (nếu bật) ═══
            const errMsg = (geminiError instanceof Error ? geminiError.message : String(geminiError)).toLowerCase();
            const isExhausted = errMsg.includes('quota') || errMsg.includes('429') || 
                                errMsg.includes('api key') || errMsg.includes('invalid') ||
                                errMsg.includes('khong hop le') || errMsg.includes('het han muc');
            
            if (isExhausted && isProxyEnabled()) {
                console.log(`[Hybrid] Gemini keys het quota/invalid. Fallback sang Proxy...`);
                onRetry(0, 1000, 'Gemini key het, chuyen sang Proxy API...');
                // Rơi xuống luồng Proxy bên dưới
            } else if (isProxyEnabled()) {
                console.log(`[Hybrid] Gemini error (${errMsg.slice(0, 60)}). Thu Proxy...`);
                onRetry(0, 1000, 'Gemini loi, thu Proxy API...');
                // Rơi xuống luồng Proxy bên dưới
            } else {
                throw geminiError; // Không có Proxy → throw lỗi Gemini
            }
        }
    }

    // ═══ LUỒNG PROXY (fallback hoặc khi không có Gemini key) ═══
    if (isProxyEnabled()) {
        const proxyApiCall = async (currentModel: string): Promise<T> => {
            if (signal?.aborted) throw new DOMException('Phan tich da bi dung', 'AbortError');
            
            let rawParts: any[] | undefined;
            if (contents && typeof contents === 'object' && 'parts' in contents) {
                rawParts = (contents as any).parts;
            } else if (Array.isArray(contents)) {
                rawParts = contents;
            }
            
            const openAiContent = convertGeminiContentsToOpenAI(contents);
            const messages = [{ role: 'user', content: openAiContent }];
            
            const text = await proxyFetchCompletion(messages, currentModel, true, signal, schema, rawParts);
            return JSON.parse(sanitizeJsonString(text)) as T;
        };
        
        return withProxyRetry(
            proxyApiCall,
            maxRetries,
            'generateAndParse (Proxy)',
            (attempt, delay, error) => {
                const msg = error instanceof Error ? error.message : String(error);
                onRetry(attempt, delay, msg);
            }
        );
    }

    // Không có cả Gemini key lẫn Proxy
    throw new Error('Chua cau hinh API Key. Vui long them Gemini API Key hoac bat Proxy trong Cai dat.');
};


export const runNextPartAnalysis = async (
    previousResult: GeminiAnalysisResponse,
    nextPartIdea: string,
    durationMinutes: number,
    modelId: string,
    languageCode: string,
    audioMode: 'narration' | 'dialogue' | 'asmr' | 'auto',
    sceneDuration: number = 8,          // ← số giây mỗi cảnh: 4 | 6 | 8 | 10
    onStateUpdate: (state: AnalysisState) => void,
    onComplete: (result: GeminiAnalysisResponse) => void,
    style?: string,
    signal?: AbortSignal,
    generateSrt: boolean = false
) => {
    let currentState: AnalysisState = {
        currentStep: 0,
        steps: [
            { title: "Khởi tạo dữ liệu", status: StepStatus.PENDING, output: '', error: null },
            { title: "Kế thừa phong cách", status: StepStatus.PENDING, output: '', error: null },
            { title: "Phân tích ý tưởng", status: StepStatus.PENDING, output: '', error: null },
            { title: "Lập dàn ý phần tiếp theo", status: StepStatus.PENDING, output: '', error: null },
            { title: "Phân bổ Scene (Blueprint)", status: StepStatus.PENDING, output: '', error: null },
            { title: "Viết kịch bản chi tiết", status: StepStatus.PENDING, output: '', error: null },
            { title: "Cấu trúc JSON", status: StepStatus.PENDING, output: '', error: null },
            { title: "Final Prompts", status: StepStatus.PENDING, output: '', error: null },
        ],
    };

    const updateStep = (idx: number, status: StepStatus, output?: any, error?: string) => {
        const newSteps = [...currentState.steps];
        newSteps[idx] = { ...newSteps[idx], status, output: output || newSteps[idx].output, error: error || null };
        
        let nextStep = currentState.currentStep;
        if (status === StepStatus.PROCESSING) {
            nextStep = idx;
        } else if (status === StepStatus.COMPLETE && idx < newSteps.length - 1) {
            nextStep = idx + 1;
            newSteps[idx + 1] = { ...newSteps[idx + 1], status: StepStatus.PROCESSING };
        }
        
        currentState = { ...currentState, steps: newSteps, currentStep: nextStep };
        onStateUpdate(currentState);
    };

    try {
        updateStep(0, StepStatus.PROCESSING, "Đang chuẩn bị dữ liệu từ phần trước...");
        await sleep(500);
        updateStep(0, StepStatus.COMPLETE);

        updateStep(1, StepStatus.PROCESSING, "Đang kế thừa phong cách và nhân vật...");
        await sleep(500);
        updateStep(1, StepStatus.COMPLETE, `Đã kế thừa nhân vật: ${previousResult.character_profile.id}`);

        updateStep(2, StepStatus.PROCESSING, "Đang phân tích ý tưởng mới...");
        const lang = languages.find(l => l.code === languageCode)?.name || 'English';
        const isAutoMode = audioMode === 'auto';
        const effectiveAudioMode = isAutoMode ? (previousResult.video_meta?.audio_mode || 'dialogue') : audioMode;
        const isNarrationMode = effectiveAudioMode === 'narration';
        const isAsmrMode = effectiveAudioMode === 'asmr';
        await sleep(500);
        updateStep(2, StepStatus.COMPLETE, `Ý tưởng: ${nextPartIdea || 'Tự động sáng tạo'}`);

        // Step 3: Lập dàn ý
        updateStep(3, StepStatus.PROCESSING, "Đang lập dàn ý cho phần tiếp theo...");

        // Kế thừa danh sách nhân vật từ phần trước (nếu có)
        const prevCharacters = previousResult.story_outline?.characters || [];
        const prevCharList = formatCharactersFullForPrompt(prevCharacters);
        const styleDNA = (style && style !== 'inherit')
            ? getStyleLabel(style)
            : getInheritedStyleDNA(previousResult);

        const voiceConfig = getVoiceConfig(languageCode);
        const promptGenerateSrt = true;
        const tokenSavingRule = !promptGenerateSrt
            ? `
⚠️ CHẾ ĐỘ TIẾT KIỆM TOKEN (KHÔNG TẠO PHỤ ĐỀ/LỜI THOẠI):
- TUYỆT ĐỐI KHÔNG VIẾT LỜI THOẠI HAY LỜI DẪN CHUYỆN.
- Đối với mọi phần (part) trong kịch bản: trường 'script' BẮT BUỘC thiết lập là "~".
- Đối với mọi phần (part): trường 'speaker_id' BẮT BUỘC thiết lập là "~".
`
            : `
=== ⚠️ SCRIPT = LỜI THOẠI CHO FILE SRT PHỤ ĐỀ (BẮT BUỘC) ===
- Script là NỘI DUNG THOẠI/THUYẾT MINH sẽ xuất ra file SRT phụ đề.
- Script PHẢI 100% bằng tiếng ${lang}. TUYỆT ĐỐI KHÔNG dùng ngôn ngữ gốc của video.
- Script KHÔNG PHẢI là mô tả hình ảnh hay prompt tạo video. Script là LỜI NÓI THỰC SỰ.
- ⚠️ QUAN TRỌNG: Mỗi phần chỉ có vài cảnh 8 giây. Script cho MỖI PHẦN phải CỰC NGẮN, chỉ 2-3 câu ngắn. KHÔNG viết đoạn văn dài.
- Phần 1: MỘT CÂU HOOK ngắn gọn (không giới thiệu dài dòng).
- Phần giữa: Leo thang căng thẳng. Mỗi phần kết thúc với twist nhỏ.
- Phần cuối: Cliffhanger ngắn gọn.
- TUYỆT ĐỐI KHÔNG: Lặp cấu trúc câu, dùng cùng từ mở đầu liên tiếp.
- Mỗi câu script tối đa 10-15 từ. Ưu tiên câu ngắn, đanh thép.
${getScriptWordLimitRule(languageCode, lang, sceneDuration)}
${getVoiceInstructions(languageCode, lang)}
`;

        const outlinePrompt = `
BẠN LÀ ĐẠO DIỄN PHIM CHUYÊN NGHIỆP. PHẢN HỒI 100% bằng tiếng ${lang} (chỉ thuật ngữ kỹ thuật không thể dịch mới được giữ nguyên tiếng Anh).

=== DỮ LIỆU KẾ THỪA ===
CỐT TRUYỆN CŨ: ${previousResult.story_outline?.logline || '(không có)'}
PHONG CÁCH CỐ ĐỊNH: ${styleDNA}
CHI TIẾT PHONG CÁCH: ${JSON.stringify(previousResult.style_profile)}
NHÂN VẬT ĐÃ CÓ:
${prevCharList || JSON.stringify(previousResult.character_profile)}

=== YÊU CẦU PHẦN TIẾP THEO ===
Ý TƯỞNG: ${nextPartIdea || 'Tự sáng tạo, nâng cao stakes và xung đột so với phần trước.'}
THỜI LƯỢNG: ${durationMinutes} phút (${durationMinutes * 60} giây) → chia 5-7 phần nhỏ.
⚠️ QUY TẮC THỜI LƯỢNG CỨNG:
   - Phần đầu tiên: start_time = "00:00".
   - Phần cuối cùng: end_time = "${formatTime(durationMinutes * 60)}".
   - start_time phần sau = end_time phần trước (KHÔNG kẽ hở).
   - TUYỆT ĐỐI KHÔNG vượt quá "${formatTime(durationMinutes * 60)}".

=== NHIỆM VỤ ===
1. NHÂN VẬT: Gán ID cố định [TÊN_V1] cho từng nhân vật (giữ đúng ID cũ nếu nhân vật đã có). Mỗi nhân vật PHẢI có các trường: 'id', 'name', 'prompt', 'voice_id', 'original_names'.
   - voice_id BẮT BUỘC phải thuộc locale ${voiceConfig.locale}. Chọn từ: ${voiceConfig.voices.join(', ')}
   - KHÔNG được dùng voice locale của ngôn ngữ khác!
   - 'original_names' BẮT BUỘC chứa mảng các tên riêng gốc của nhân vật trong video gốc đối thủ mà nhân vật Remix mới này thay thế (ví dụ: ["Raju", "Amit"]). Nếu không có hoặc nhân vật hoàn toàn mới, để mảng rỗng []. Quy tắc này cực kỳ quan trọng để hệ thống tự động chuẩn hoá tên.
2. DÀN Ý: Tạo ít nhất 5 phần. Mỗi phần CÓ 'script' (không phải tóm tắt — đây là LỜI DẪN/THOẠI thực sự).

${tokenSavingRule}
        `;

        if (signal?.aborted) throw new DOMException('Phân tích đã bị dừng', 'AbortError');
        const storyOutline = await generateAndParseJsonWithRetry<StoryOutline>(
            modelId, 
            outlinePrompt, 
            storyOutlineSchema, 
            3, 
            (attempt, delay, reason) => {
                updateStep(3, StepStatus.PROCESSING, `Thử lại lần ${attempt} do ${reason}...`);
            },
            signal
        );
        updateStep(3, StepStatus.COMPLETE, JSON.stringify(storyOutline, null, 2));

        // Step 4: Phân bổ Scene (Blueprint) — gán nội dung từng scene vào đúng phần
        const density = sceneDuration; // số giây mỗi cảnh do user chọn (4 | 6 | 8 | 10)
        const totalSeconds = durationMinutes * 60;
        const targetScenes = Math.ceil(totalSeconds / density);

        updateStep(4, StepStatus.PROCESSING, `Đang phân bổ ${targetScenes} scene vào ${storyOutline.parts.length} phần...`);

        let blueprintScriptDraftRule = '';
        if (!promptGenerateSrt) {
            blueprintScriptDraftRule = `5. script_draft: BẮT BUỘC thiết lập là "~" (không tạo thoại/thuyết minh).`;
        } else if (isAsmrMode) {
            blueprintScriptDraftRule = `5. script_draft: Mô tả âm thanh ASMR bằng tiếng ${lang} (Ví dụ: "Tiếng bước chân", "Tiếng lá xạc xào"). BẮT BUỘC bắt đầu bằng [SFX: <mô tả âm thanh>]. Tối đa ${Math.round(density * 1.875)} từ.`;
        } else if (effectiveAudioMode === 'dialogue') {
            blueprintScriptDraftRule = `5. script_draft: Lời thoại của nhân vật trong cảnh. BẮT BUỘC định dạng: [CHAR_ID]: "Nội dung lời thoại bằng tiếng ${lang}". Tối đa ${Math.round(density * 1.875)} từ.`;
        } else {
            // narration mode
            blueprintScriptDraftRule = `5. script_draft: Lời dẫn chuyện (narration) bằng tiếng ${lang}. Tối đa ${Math.round(density * 1.875)} từ. KHÔNG dùng prefix nhân vật.`;
        }
        
        const blueprintPrompt = `
BẠN LÀ ĐẠO DIỄN PHIM. PHẢN HỒI 100% tiếng ${lang}.

=== DÀN Ý KỊCH BẢN ===
${storyOutline.parts.map(part => `- Phần ${part.part_id} [${part.start_time} - ${part.end_time}] "${part.title}":
  + Tóm tắt: ${part.summary}
  + Thoại nháp: ${part.script}`).join('\n')}

=== NHÂN VẬT ===
${formatCharactersForPrompt(storyOutline.characters)}

=== PHONG CÁCH HÌNH ẢNH ===
STYLE_DNA: "${styleDNA}"
${previousResult.style_profile ? `Lighting: ${previousResult.style_profile.lighting} | Color: ${previousResult.style_profile.color_grading} | Lens: ${previousResult.style_profile.lens_film}` : ''}

=== NHIỆM VỤ ===
Phân bổ CHÍNH XÁC ${targetScenes} scene (mỗi scene ${density} giây) vào các phần dàn ý bên trên.
Tổng thời lượng: ${totalSeconds} giây (${durationMinutes} phút).

QUY TẮC:
1. Scene đầu tiên: t0 = "00:00". Scene cuối: t1 = "${formatTime(totalSeconds)}".
2. Mỗi scene = ${density} giây. t0 scene sau = t1 scene trước (KHÔNG kẽ hở).
3. part_id phải khớp với part_id (số nguyên) trong dàn ý (1, 2, 3...). Scene phải nằm trong time range của phần tương ứng.
4. content_brief: 1-2 câu mô tả diễn biến chính của scene.
5. ${blueprintScriptDraftRule}
6. visual_hint: Gợi ý bối cảnh, góc máy, hành động + BẮT BUỘC bắt đầu bằng phong cách STYLE_DNA "${styleDNA}". Dùng Character ID [NAME_V1] thay vì tên.
7. Phân bổ nội dung ĐỀU giữa các phần — KHÔNG dồn quá nhiều scene vào 1 phần.
8. Đảm bảo câu chuyện diễn biến TUẦN TỰ, không nhảy cóc.
        `;

        if (signal?.aborted) throw new DOMException('Phân tích đã bị dừng', 'AbortError');
        const blueprintResult = await generateAndParseJsonWithRetry<{ scenes: SceneBlueprintItem[] }>(
            modelId,
            blueprintPrompt,
            sceneBlueprintSchema,
            3,
            (attempt, _delay, reason) => {
                updateStep(4, StepStatus.PROCESSING, `Thử lại lần ${attempt} do ${reason}...`);
            },
            signal
        );
        const sceneBlueprint: SceneBlueprintItem[] = blueprintResult.scenes || [];
        updateStep(4, StepStatus.COMPLETE, `Đã phân bổ ${sceneBlueprint.length}/${targetScenes} scene vào ${storyOutline.parts.length} phần.`);

        // Step 5: Viết kịch bản chi tiết theo từng phần câu chuyện (Cumulative Batching) — dùng Blueprint
        updateStep(5, StepStatus.PROCESSING, "Đang viết kịch bản chi tiết theo từng phần câu chuyện...");
        
        const allScenes: GeminiScene[] = [];
        const accumulatedScenes: GeminiScene[] = []; // Ngữ cảnh lũy kế các cảnh trước

        const outlineParts = storyOutline.parts || [];
        const numParts = outlineParts.length;
        console.log(`[NextPart] Target: ${targetScenes} cảnh, phân bổ theo ${numParts} phần câu chuyện.`);

        for (let i = 0; i < numParts; i++) {
            const part = outlineParts[i];
            
            // Tìm các blueprint scenes thuộc part này
            const partBlueprints = sceneBlueprint.filter(bp => Number(bp.part_id) === Number(part.part_id));
            if (partBlueprints.length === 0) {
                console.warn(`[NextPart] Không tìm thấy blueprint cho phần ${part.part_id}, bỏ qua.`);
                continue;
            }
            
            // Sắp xếp theo scene_index tăng dần
            partBlueprints.sort((a, b) => a.scene_index - b.scene_index);
            
            const startIdx = partBlueprints[0].scene_index;
            const endIdx = partBlueprints[partBlueprints.length - 1].scene_index;
            const currentChunkSize = partBlueprints.length;

            const chunkTStart = (startIdx - 1) * density; // giây bắt đầu
            const chunkTEnd = Math.min(endIdx * density, totalSeconds); // giây kết thúc (clamp)

            if (i > 0) {
                // Nghỉ giãn cách giữa các batch để tránh Rate Limit (429)
                const batchDelay = isProxyEnabled() ? 10000 : 3000;
                console.log(`[NextPart] Tạm nghỉ ${batchDelay}ms giữa các phần để tránh rate limit (429)...`);
                await sleep(batchDelay);
            }

            const previousScenesContext = accumulatedScenes.length > 0
                ? `=== KỊCH BẢN CÁC CẢNH TRƯỚC ĐÓ (BẮT BUỘC ĐỐI CHIẾU LŨY KẾ) ===
Dưới đây là lời thoại và mô tả của các cảnh trước đó đã sinh thành công. 
AI PHẢI đọc kỹ để tiếp tục mạch kịch bản trôi chảy:
${JSON.stringify(accumulatedScenes.map(s => ({ scene_id: s.scene_id, script: s.script, summary: s.summary })), null, 2)}
 
⚠️ BẮT BUỘC ĐỐI CHIẾU & LÀM MƯỢT NGÔN NGỮ THOẠI CỦA QUỐC GIA ${lang}:
   - Đọc kỹ lời thoại (script) và tóm tắt (summary) của các cảnh trước đó để viết tiếp mượt mà nhất.
   - TUYỆT ĐỐI KHÔNG lặp lại từ bắt đầu câu thoại, không lặp cấu trúc ngữ pháp thoại từ các cảnh trước.
   - Điều chỉnh văn phong thoại tự nhiên, trôi chảy, đúng điệu tự nhiên nhất của người bản xứ ${lang}.
   - Đảm bảo diễn biến tâm lý, thái độ nhân vật chuyển tiếp logic từ các cảnh trước.`
                : `=== KỊCH BẢN CÁC CẢNH TRƯỚC ĐÓ ===
(Không có, đây là Phần 1. Hãy đặt nền móng thoại và bối cảnh thật lôi cuốn, đanh thép, chuẩn văn phong thoại tự nhiên của quốc gia ${lang}!)`;

            const blueprintContext = partBlueprints.length > 0
                ? `=== BLUEPRINT CHI TIẾT CHO BATCH NÀY (BẮT BUỘC TRIỂN KHAI ĐÚNG TỪNG SCENE) ===
Dưới đây là nội dung ĐÃ PHÂN BỔ SẴN cho từng scene trong batch này. Batch này đại diện cho:
Phần ${part.part_id}: ${part.title} (Tóm tắt: ${part.summary})

AI BẮT BUỘC phải triển khai chi tiết TỪNG SCENE theo đúng blueprint:
${partBlueprints.map(bp => `- Scene ${bp.scene_index} [${bp.t0} - ${bp.t1}] (Phần ${bp.part_id}):
  + Nội dung: ${bp.content_brief}
  + Thoại nháp: ${bp.script_draft}
  + Hình ảnh: ${bp.visual_hint}`).join('\n\n')}

⚠️ TUYỆT ĐỐI KHÔNG thay đổi thứ tự, bỏ sót, hoặc nhảy cóc nội dung. Mỗi scene PHẢI match đúng blueprint.`
                : `=== BLUEPRINT ===
(Không tìm thấy blueprint cho phần này. Hãy sinh cảnh dựa trên bối cảnh chung.)`;

            // Lấy danh sách TẤT CẢ nhân vật từ dàn ý (không chỉ 1 nhân vật chính)
            const allCharactersList = formatCharactersFullForPrompt(storyOutline.characters);


            const chunkStyleVideoRule = !promptGenerateSrt
                ? `   "${styleDNA} [TẤT CẢ CHARACTER_IDs] với [ngoại hình/trang phục từng người]. [Bối cảnh môi trường: người xung quanh, động vật, âm thanh, thời tiết]. [Hành động]. [Góc máy]."
   → TUYỆT ĐỐI KHÔNG chứa [VO: ...] hay lời thoại nào.`
                : isAsmrMode
                ? `   "${styleDNA} [Bối cảnh/đối tượng chi tiết]. [HÀNH ĐỘNG TẠO ÂM THANH]. [Extreme close-up / macro / POV]. [Chuyển động máy chậm, mượt]."
   → KHÔNG chứa [VO:] hay lời thoại. CHỈ mô tả HÀNH ĐỘNG VÀ HÌNH ẢNH + chất liệu bề mặt.`
                : isNarrationMode
                ? `   "${styleDNA} [TẤT CẢ CHARACTER_IDs] với [ngoại hình/trang phục từng người]. [Bối cảnh môi trường: người xung quanh, động vật, âm thanh, thời tiết]. [Hành động]. [Góc máy]. [VO: lời thuyết minh ngắn gọn]"
   → style_video PHẢI kết thúc bằng [VO: ...] chứa lời dẫn chuyện.`
                : `   "${styleDNA} [TẤT CẢ CHARACTER_IDs] với [ngoại hình/trang phục từng người]. [Bối cảnh môi trường: người xung quanh, động vật, âm thanh, thời tiết]. [Hành động]. [Góc máy]."
   → KHÔNG kết thúc bằng [VO: ...]. Lời thoại sẽ được lấy từ field SCRIPT riêng.
   → Mỗi nhân vật nói phải có character ID prefix trong SCRIPT (VD: [HERO_V1]: "Câu thoại").`;

            const chunkScriptRule = !promptGenerateSrt
                ? `3. KHÔNG CẦN LỜI THOẠI/NARRATION (TIẾT KIỆM TOKEN):
   - script = "~" cho mọi cảnh.
   - speaker_id = "~" cho mọi cảnh.
   - TUYỆT ĐỐI KHÔNG viết thoại hay thuyết minh.`
                : isAsmrMode
                ? `3. CHẾ ĐỘ ASMR — KHÔNG LỜI THOẠI:
   - script = mô tả âm thanh ASMR bằng tiếng ${lang}. speaker_id = "~".
   - TUYỆT ĐỐI KHÔNG viết lời thoại, narrator.`
                : `3. MỌI CẢNH ĐỀU PHẢI CÓ LỜI THOẠI/NARRATION — BẮT BUỘC:
   - TUYỆT ĐỐI KHÔNG để script là âm thanh môi trường ("Tiếng gió...", "Tiếng nước...", "Tiếng chim...").
   - KHÔNG viết "[KHÔNG THOẠI]", "[VO: không thoại]", hay bất kỳ mô tả SFX nào.
   - Ngay cả cảnh không có nhân vật nói: AI phải sáng tác lời narrator phù hợp với cảnh đó.
   - Âm thanh môi trường chỉ được đặt trong field SND — KHÔNG bao giờ đưa vào script/VO.`;

            const audioScriptRule = isAutoMode
                ? `🤖 CHẾ ĐỘ TỰ ĐỘNG — AI TỰ PHÂN TÍCH:
   - TỰ XÁC ĐỊNH video này là DIALOGUE (nhiều nhân vật nói), NARRATION (1 giọng thuyết minh), hay ASMR (không lời, chỉ âm thanh).
   - Nếu DIALOGUE: script dạng [CHAR_ID]: "câu thoại", speaker_id = char nói nhiều nhất.
   - Nếu NARRATION: script = văn xuôi 1 giọng, speaker_id = "~".
   - Nếu ASMR: script = mô tả âm thanh chi tiết, speaker_id = "~", KHÔNG lời thoại.
   - Ghi audio_mode chính xác vào video_meta.
   - ⚠️ TẤT CẢ script PHẢI 100% bằng tiếng ${lang}.`
                : isAsmrMode
                ? `🎧 CHẾ ĐỘ ASMR — KHÔNG LỜI THOẠI, CHỈ MÔ TẢ ÂM THANH:
   - script = mô tả chi tiết ÂM THANH ASMR trong cảnh bằng tiếng ${lang}.
   - VD: "Tiếng gõ nhẹ lên gỗ — toc toc toc. Tiếng xào xạo giấy. Thì thầm nhẹ."
   - TUYỆT ĐỐI KHÔNG viết lời thoại, narrator, hay thuyết minh.
   - Mô tả: loại âm thanh, nhịp độ (nhanh/chậm), cường độ (nhẹ/mạnh), chất liệu (gỗ/kim loại/vải/da...).
   - speaker_id = "~" (không có speaker).
   - style_video PHẢI MÔ TẢ HÀNH ĐỘNG TẠO ÂM THANH: tay gõ, ngón vuốt, miệng thổi, kéo vải, bóp bọt biển...`
                : isNarrationMode
                ? `🎤 CHẾ ĐỘ THUYẾT MINH (NARRATION) — MỘT GIỌNG DUY NHẤT:
   - script = văn xuôi sạch, giàu hình ảnh, viết cho 1 người dẫn chuyện.
   - ⚠️ TẤT CẢ script PHẢI 100% bằng tiếng ${lang}. TUYỆT ĐỐI KHÔNG dùng ngôn ngữ khác.
   - TUYỆT ĐỐI KHÔNG prefix nhân vật. KHÔNG viết thoại trực tiếp giữa các nhân vật.
   - Nếu cảnh có thoại: đưa vào tường thuật bằng tiếng ${lang}.
   - speaker_id = "~" (không có speaker riêng).
   - Giọng điệu phải nhất quán: bình tĩnh, miêu tả, không gấp gáp.`
                : `💬 CHẾ ĐỘ HỘI THOẠI (DIALOGUE) — MỖI NHÂN VẬT MỘT GIỌNG:
   ⚠️ ⚠️ ⚠️ TUYỆT ĐỐI TẤT CẢ LỜI THOẠI PHẢI 100% bằng tiếng ${lang}. KHÔNG dùng tiếng Việt hay ngôn ngữ khác dù chỉ 1 từ.
   - script = mỗi dòng bắt đầu bằng [CHAR_ID]: "Câu thoại bằng tiếng ${lang}"
     CẤU TRÚC: [CHAR_ID]: "<nội dung thoại bằng ${lang}>"
   - speaker_id = Character ID của nhân vật nói nhiều nhất trong cảnh.
   - Mỗi nhân vật PHẢI giữ GIỌNG NÓI RIÊNG phù hợp tính cách.
   - Cảnh không có nhân vật nói: AI tự sáng tác 1 câu narrator ngắn bằng tiếng ${lang}. speaker_id = "~".
   - TUYỆT ĐỐI KHÔNG dùng "[KHÔNG THOẠI]" hay âm thanh môi trường làm script.`;

            const chunkPrompt = `
BẠN LÀ ĐẠO DIỄN PHIM. PHẢN HỒI 100% tiếng ${lang} (thuật ngữ kỹ thuật giữ nguyên).

=== NGỮ CẢNH PHẦN ${i + 1}/${numParts}: PHẦN ${part.part_id} - ${part.title} (CẢNH ${startIdx} ĐẾN CẢNH ${endIdx}) ===
DÀN Ý: ${storyOutline.logline}
STYLE_DNA: "${styleDNA}"
THỜI LƯỢNG TỔNG: ${totalSeconds} giây (${durationMinutes} phút). KHÔNG ĐƯỢC vượt quá.

NHÂN VẬT REMIX MỚI BẮT BUỘC SỬ DỤNG (TUYỆT ĐỐI KHÔNG DÙNG TÊN TRONG VIDEO GỐC):
${allCharactersList}

${previousScenesContext}

${blueprintContext}

=== NHIỆM VỤ ===
Tạo ĐÚNG ${currentChunkSize} cảnh (~${density} giây/cảnh), bao phủ CHÍNH XÁC từ ${formatTime(chunkTStart)} đến ${formatTime(chunkTEnd)}.
Cảnh đầu tiên của chunk này bắt đầu tại t0 = "${formatTime(chunkTStart)}".
Cảnh cuối của chunk này kết thúc tại t1 = "${formatTime(chunkTEnd)}".
Dùng cấu trúc JSON GeminiAnalysisResponse.

=== QUY TẮC CỨNG ===
1. CHARACTER ID — NHÂN VẬT PHẢI GIỐNG Y CHANG MÔ TẢ BÊN TRÊN:
   - ⚠️ TUYỆT ĐỐI KHÔNG sử dụng tên gốc của video URL đối thủ (ví dụ: Raju, Amit, Sita, Vikram, v.v.) trong prompt style_video hay thoại script.
   - BẮT BUỘC sử dụng chính xác ID nhân vật mới dạng [NAME_V1] (ví dụ: [HERO_V1], [VILLAIN_V1]) từ danh sách nhân vật phía trên.
   - TUYỆT ĐỐI KHÔNG thay đổi ngoại hình, trang phục, đặc điểm nhận dạng của nhân vật so với mô tả đã cho.
   - Khi nhân vật xuất hiện trong STYLE_VIDEO: PHẢI dùng ĐÚNG mô tả ngoại hình/trang phục như trong danh sách nhân vật bên trên. KHÔNG tự sáng tạo trang phục/ngoại hình mới.
   - Nếu cảnh có 2+ nhân vật, STYLE_VIDEO PHẢI nhắc đến TẤT CẢ nhân vật đó với mô tả CHÍNH XÁC, KHÔNG được bỏ sót.

2. STYLE_VIDEO: Má»™t cÃ¢u liá»n máº¡ch theo cáº¥u trÃºc:
${chunkStyleVideoRule}
   âš ï¸ Má»–I Cáº¢NH PHáº¢I KHÃC NHAU: Thay Ä‘á»•i gÃ³c mÃ¡y, gÃ³c nhÃ¬n Ä‘á»ƒ phong phÃº.

${chunkScriptRule}

4. SCRIPT â€” QUY Táº®C STORYTELLING + Äá»˜ DÃ€I:
${audioScriptRule}
   - âš ï¸ SCRIPT PHáº¢I 100% Báº°NG TIáº¾NG ${lang}. KHÃ”NG dÃ¹ng ngÃ´n ngá»¯ gá»‘c cá»§a video dÃ¹ chá»‰ 1 tá»«.
${promptGenerateSrt ? `   - âš ï¸ Má»–I Cáº¢NH CHá»ˆ ${density} GIÃ‚Y â€” TTS Ä‘á»c ~2 tá»«/giÃ¢y â†’ Tá»I ÄA ${Math.round(density * 1.875)} Tá»ª/Cáº¢NH. Script dÃ i hÆ¡n sáº½ bá»‹ cáº¯t!
   - KHÃ”NG láº·p cáº¥u trÃºc cÃ¢u 2 cáº£nh liá»n tiáº¿p.
   - Cáº£nh hÃ nh Ä‘á»™ng â†’ 1 cÃ¢u ngáº¯n 5-8 tá»«. Cáº£nh cáº£m xÃºc â†’ 1-2 cÃ¢u, tá»•ng â‰¤15 tá»«.`
: `   - Script Báº®T BUá»˜C thiáº¿t láº­p lÃ  "~" cho má»i cáº£nh. speaker_id = "~".` }
   - voice_locale cho Má»ŒI cáº£nh PHáº¢I lÃ  "${voiceConfig.locale}".
   - speaker_id PHáº¢I khá»›p Character ID Ä‘Ã£ Ä‘á»‹nh nghÄ©a.
${promptGenerateSrt ? getScriptWordLimitRule(languageCode, lang, density) : ''}

5. DỊCH THUẬT: Tất cả trang phục, thức ăn, văn hóa PHẢI dịch sang ${lang}. KHÔNG giữ nguyên tiếng nước ngoài (kurta → áo dài tay, saree → váy quấn, turban → khăn xếp...).

6. TIMESTAMP — QUY TẮC CỨNG:
   - Cảnh đầu chunk bắt đầu tại t0 = "${formatTime(chunkTStart)}". Cảnh cuối chunk kết thúc tại t1 = "${formatTime(chunkTEnd)}".
   - Mỗi cảnh kéo dài ĐÚNG ~${density} giây (${density - 2}–${density + 2}s OK). t0 cảnh sau = t1 cảnh trước.
   - TUYỆT ĐỐI KHÔNG vượt quá ${formatTime(chunkTEnd)}.
7. KHÔNG dùng nhãn thừa: "Prompt:", "Cảnh:", "Mô tả:", "Scene:", "CAM:", "SND:", v.v.
8. Timestamp (t0, t1) liên tục không có kẽ hở.
9. KHUNG CẢNH MÔI TRƯỜNG — BẮT BUỘC:
   - KHÔNG tạo cảnh trống chỉ có nhân vật. PHẢI thêm chi tiết môi trường sống động.
10. ⚠️ PHONG CÁCH HÌNH ẢNH BẮT BUỘC — "${styleDNA}":
    - TẤT CẢ style_video PHẢI bắt đầu bằng style "${styleDNA}".
    - KHÔNG tự tiện thay đổi sang style khác. TUYỆT ĐỐI KHÔNG copy phong cách hình ảnh gốc của video mà phải sử dụng phong cách khóa "${styleDNA}" này.
            `;

            if (signal?.aborted) throw new DOMException('Phân tích đã bị dừng', 'AbortError');
            let chunkResult: GeminiAnalysisResponse | null = null;
            
            // Retry tại chỗ: batch PHẢI thành công mới sang batch tiếp theo (đảm bảo thứ tự)
            const MAX_BATCH_RETRIES = 2; // Tổng cộng: 3 lần thử trong generateAndParseJsonWithRetry + 2 lần retry ngoài = 5 lần
            let batchSuccess = false;
            for (let retryAttempt = 0; retryAttempt <= MAX_BATCH_RETRIES; retryAttempt++) {
                if (signal?.aborted) throw new DOMException('Phân tích đã bị dừng', 'AbortError');
                if (retryAttempt > 0) {
                    const retryDelay = retryAttempt * 8000; // 8s, 16s
                    console.log(`[NextPart] 🔄 Retry batch ${i+1} lần ${retryAttempt}/${MAX_BATCH_RETRIES}, chờ ${retryDelay}ms...`);
                    updateStep(5, StepStatus.PROCESSING, `🔄 Đợt ${i+1} lỗi, thử lại lần ${retryAttempt}/${MAX_BATCH_RETRIES}...`);
                    await sleep(retryDelay);
                }
                try {
                    chunkResult = await generateAndParseJsonWithRetry<GeminiAnalysisResponse>(
                        modelId, 
                        chunkPrompt, 
                        responseSchema, 
                        3, 
                        (attempt, delay, reason) => {
                            updateStep(5, StepStatus.PROCESSING, `Đợt ${i + 1} (Cảnh ${startIdx}-${endIdx}): thử lần ${attempt} do ${reason}...`);
                        },
                        signal
                    );
                    if (chunkResult && Array.isArray(chunkResult.scenes) && chunkResult.scenes.length > 0) {
                        batchSuccess = true;
                        break; // Thành công → thoát vòng retry
                    } else {
                        console.warn(`[NextPart] Batch ${i+1} retry ${retryAttempt}: trả về 0 cảnh, thử lại...`);
                    }
                } catch (batchErr: any) {
                    if (batchErr?.name === 'AbortError') throw batchErr;
                    console.error(`[NextPart] ❌ Batch ${i+1}/${numParts} retry ${retryAttempt}: ${batchErr.message}`);
                    if (retryAttempt === MAX_BATCH_RETRIES) {
                        // Đã hết lần retry → throw dừng hẳn (không bỏ qua)
                        throw new Error(`Batch ${i+1} (Cảnh ${startIdx}-${endIdx}) thất bại sau ${MAX_BATCH_RETRIES + 1} lần thử: ${batchErr.message}`);
                    }
                }
            }

            if (batchSuccess && chunkResult && Array.isArray(chunkResult.scenes) && chunkResult.scenes.length > 0) {
                // Sắp xếp nội bộ batch theo scene_id thô của AI
                chunkResult.scenes.sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0));

                // Ép scene_id chính xác theo phân đoạn kịch bản
                chunkResult.scenes.forEach((s, idx) => {
                    s.scene_id = startIdx + idx;
                });

                allScenes.push(...chunkResult.scenes);
                accumulatedScenes.push(...chunkResult.scenes); // Lưu vào bộ nhớ lưu luỹ
            }
        }

        updateStep(5, StepStatus.COMPLETE, `Đã tạo tổng cộng ${allScenes.length} cảnh quay.`);

        // Step 5: Cấu trúc JSON
        updateStep(6, StepStatus.PROCESSING, "Đang hoàn thiện cấu trúc dữ liệu...");
        const finalResult: GeminiAnalysisResponse = {
            video_meta: {
                url: previousResult.video_meta?.url || '',
                title: storyOutline.title || previousResult.video_meta?.title || 'Untitled',
                duration_sec: totalSeconds,
                audio_mode: audioMode === 'auto' ? (previousResult.video_meta?.audio_mode || 'dialogue') : audioMode,
                style: previousResult.video_meta?.style || { mood: '', palette: [], music: '' }
            },
            scenes: allScenes,
            assets: previousResult.assets || [],
            character_profile: previousResult.character_profile || { id: '[CHAR_V1]', description: '', physical_traits: [] },
            style_profile: previousResult.style_profile
                ? { ...previousResult.style_profile, medium: styleDNA }
                : { medium: styleDNA, lighting: '', color_grading: '', lens_film: '', environment_materials: '', style_tags: [] },
            story_outline: storyOutline
        };
        
        // Đánh lại ID cảnh và sắp xếp theo scene_id
        finalResult.scenes.sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0));
        
        // Luôn phân bổ lại timestamps tuần tự để loại bỏ hoàn toàn lỗi nhảy cóc thời gian (Timeline Jump Error)
        finalResult.scenes.forEach((s, idx) => {
            s.t0 = formatTime(idx * density);
            s.t1 = formatTime(Math.min((idx + 1) * density, totalSeconds));
        });
        
        // Loại bỏ cảnh bắt đầu sau totalSeconds
        finalResult.scenes = finalResult.scenes.filter(s => parseTimestamp(s.t0) < totalSeconds);
        
        finalResult.scenes.forEach((s, idx) => s.scene_id = idx + 1);
        
        // Hậu xử lý phòng thủ chuẩn hoá tên nhân vật
        finalResult.scenes = normalizeRemixCharacterNames(finalResult.scenes, storyOutline.characters as any);
        
        console.log(`[runNextPart] Final: ${finalResult.scenes.length} scenes, target=${formatTime(totalSeconds)}, last t1=${finalResult.scenes[finalResult.scenes.length - 1]?.t1 || 'N/A'}`);

        await sleep(500);
        updateStep(6, StepStatus.COMPLETE, JSON.stringify(finalResult, null, 2));

        // Step 6: Final Prompts
        updateStep(7, StepStatus.PROCESSING, "Đang tạo prompts cuối cùng...");
        await sleep(500);
        updateStep(7, StepStatus.COMPLETE, "Hoàn tất!");
        
        onComplete(finalResult);
    } catch (error) {
        console.error(error);
        const errStep = currentState.currentStep;
        updateStep(errStep, StepStatus.ERROR, null, getErrorMessage(error));
        throw error;
    }
};

const formatStyleProfile = (profile: any): string => {
    if (!profile) return "";
    const tags = Array.isArray(profile.style_tags) ? profile.style_tags.join(", ") : "";
    return `${profile.medium || ''}, ${profile.lighting || ''}, ${profile.color_grading || ''}, ${profile.lens_film || ''}, ${profile.environment_materials || ''}${tags ? `, ${tags}` : ""}`.replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '').trim();
};

const getInheritedStyleDNA = (previousResult: GeminiAnalysisResponse): string => {
    if (!previousResult) return 'Phong cách video Cinematic (Điện ảnh)';
    
    if (previousResult.scenes && previousResult.scenes.length > 0) {
        const firstSceneStyleVideo = (previousResult.scenes[0].style_video || "").toLowerCase();
        
        // Match using english / vietnamese keywords
        if (firstSceneStyleVideo.includes('3d') || firstSceneStyleVideo.includes('pixar')) {
            return STYLE_LABEL_MAP['3d'];
        }
        if (firstSceneStyleVideo.includes('ghibli')) {
            return STYLE_LABEL_MAP['ghibli'];
        }
        if (firstSceneStyleVideo.includes('anime') || firstSceneStyleVideo.includes('hoạt hình nhật')) {
            return STYLE_LABEL_MAP['anime'];
        }
        if (firstSceneStyleVideo.includes('cartoon') || (firstSceneStyleVideo.includes('hoạt hình') && !firstSceneStyleVideo.includes('nhật'))) {
            return STYLE_LABEL_MAP['cartoon'];
        }
        if (firstSceneStyleVideo.includes('minecraft')) {
            return STYLE_LABEL_MAP['minecraft'];
        }
        if (firstSceneStyleVideo.includes('pixel')) {
            return STYLE_LABEL_MAP['pixel-art'];
        }
        if (firstSceneStyleVideo.includes('watercolor') || firstSceneStyleVideo.includes('màu nước')) {
            return STYLE_LABEL_MAP['watercolor'];
        }
        if (firstSceneStyleVideo.includes('oil painting') || firstSceneStyleVideo.includes('oil-painting') || firstSceneStyleVideo.includes('sơn dầu')) {
            return STYLE_LABEL_MAP['oil-painting'];
        }
        if (firstSceneStyleVideo.includes('stickman') || firstSceneStyleVideo.includes('người que')) {
            return STYLE_LABEL_MAP['stickman'];
        }
        if (firstSceneStyleVideo.includes('chibi')) {
            return STYLE_LABEL_MAP['chibi'];
        }
        if (firstSceneStyleVideo.includes('animal') || firstSceneStyleVideo.includes('động vật')) {
            return STYLE_LABEL_MAP['animal'];
        }
        if (firstSceneStyleVideo.includes('faceless') || firstSceneStyleVideo.includes('không host')) {
            return STYLE_LABEL_MAP['faceless'];
        }
        if (firstSceneStyleVideo.includes('vtuber')) {
            return STYLE_LABEL_MAP['vtuber'];
        }
        if (firstSceneStyleVideo.includes('silhouette') || firstSceneStyleVideo.includes('bóng đen')) {
            return STYLE_LABEL_MAP['silhouette'];
        }
        if (firstSceneStyleVideo.includes('superhero')) {
            return STYLE_LABEL_MAP['superhero'];
        }
        if (firstSceneStyleVideo.includes('lồng tiếng') || firstSceneStyleVideo.includes('thuyết minh') || firstSceneStyleVideo.includes('voiceover')) {
            return STYLE_LABEL_MAP['voiceover'];
        }
        if (firstSceneStyleVideo.includes('cinematic') || firstSceneStyleVideo.includes('điện ảnh')) {
            return STYLE_LABEL_MAP['cinematic'];
        }

        // Check if starts with or includes any of our preset labels
        for (const label of Object.values(STYLE_LABEL_MAP)) {
            if (firstSceneStyleVideo.includes(label.toLowerCase())) {
                return label;
            }
        }
    }
    
    const formatted = formatStyleProfile(previousResult.style_profile);
    return formatted.trim() !== "" ? formatted : 'Phong cách video Cinematic (Điện ảnh)';
};

// Tạo danh sách nhân vật rõ ràng cho prompt — đảm bảo TẤT CẢ nhân vật được AI nhận diện
const formatCharactersForPrompt = (characters: Array<{ id?: string; name: string; prompt: string }> | undefined): string => {
    if (!characters || characters.length === 0) return '';
    return characters.map((c, i) => {
        const cid = c.id || `[CHAR${i + 1}_V1]`;
        return `  ${cid} | ${c.name}: ${c.prompt.slice(0, 200)}${c.prompt.length > 200 ? '...' : ''}`;
    }).join('\n');
};

// CLONE MODE: Truyền TOÀN BỘ prompt nhân vật (không cắt ngắn) để AI giữ mô tả 100% chính xác
const formatCharactersFullForPrompt = (characters: Array<{ id?: string; name: string; prompt: string }> | undefined): string => {
    if (!characters || characters.length === 0) return '';
    return characters.map((c, i) => {
        const cid = c.id || `[CHAR${i + 1}_V1]`;
        return `  ${cid} | ${c.name}: ${c.prompt}`;
    }).join('\n');
};

// Trích xuất Character ID đầu tiên làm neo chính cho style_video (giữ backward compat)
const getMainCharacterId = (characters: Array<{ id?: string; name: string }> | undefined, fallback: string): string => {
    if (characters && characters.length > 0 && characters[0].id) return characters[0].id;
    return fallback;
};

/**
 * Hậu xử lý phòng thủ: Đồng nhất tên nhân vật ở chế độ Remix
 * Quét toàn bộ scenes và thay thế bất kỳ tên gốc nào trong original_names thành ID nhân vật [NAME_V1] tương ứng.
 */
const normalizeRemixCharacterNames = (
    scenes: GeminiScene[],
    characters: Array<{ id: string; name: string; original_names?: string[] }> | undefined
): GeminiScene[] => {
    if (!characters || characters.length === 0 || !scenes || scenes.length === 0) return scenes;

    return scenes.map(scene => {
        let styleVideo = scene.style_video || "";
        let script = scene.script || "";
        let speakerId = scene.speaker_id || "";

        characters.forEach(char => {
            const charId = char.id; // VD: [HERO_V1]
            const cleanCharId = charId.replace(/[\[\]]/g, ''); // VD: HERO_V1 (không có ngoặc vuông để so khớp linh hoạt)
            const origNames = char.original_names || [];

            // 1. Quét và replace các tên gốc
            origNames.forEach((origName: string) => {
                if (!origName || origName.trim() === "") return;
                const cleanOrigName = origName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                // Regex khớp từ độc lập, không phân biệt hoa thường
                const regex = new RegExp(`\\b${cleanOrigName}\\b`, 'gi');

                styleVideo = styleVideo.replace(regex, charId);
                script = script.replace(regex, charId);
                
                // Thay thế speaker_id nếu chứa tên gốc
                if (speakerId.toLowerCase() === origName.toLowerCase()) {
                    speakerId = charId;
                }
            });

            // 2. Bảo vệ thêm: Thay thế nếu AI ghi [HERO_V1] nhưng bị thiếu ngoặc vuông (vd: HERO_V1)
            // hoặc AI ghi nhầm tên hiển thị mới (vd: Thạch Sanh) thay vì dùng ID [HERO_V1] trong style_video
            const escapedCharName = char.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const nameRegex = new RegExp(`\\b${escapedCharName}\\b`, 'gi');
            styleVideo = styleVideo.replace(nameRegex, charId);
            
            // Khớp ID trần trụi không có [] (như HERO_V1) và chuyển về [HERO_V1]
            const bareRegex = new RegExp(`(?<!\\[)\\b${cleanCharId}\\b(?!\\])`, 'g');
            styleVideo = styleVideo.replace(bareRegex, charId);
            script = script.replace(bareRegex, charId);
            if (speakerId === cleanCharId) {
                speakerId = charId;
            }
        });

        // Đảm bảo speaker_id sạch sẽ
        if (speakerId && speakerId !== "~" && !speakerId.startsWith("[")) {
            // Nếu speaker_id bị gán lệch mà không khớp ID, kiểm tra thử xem có trùng khớp name nào không
            const matchedChar = characters.find(c => c.name.toLowerCase() === speakerId.toLowerCase() || c.id.replace(/[\[\]]/g, '').toLowerCase() === speakerId.toLowerCase());
            if (matchedChar) {
                speakerId = matchedChar.id;
            }
        }

        // Tự động chuẩn hóa script của chế độ hội thoại nếu thiếu prefix [CHAR_ID]:
        if (speakerId && speakerId !== "~" && script && script.trim() !== "" && script.trim() !== "~" && script.trim() !== "[KHÔNG THOẠI]") {
            const hasPrefix = /^\[\w+\]\s*:/.test(script.trim());
            if (!hasPrefix) {
                const cleanText = script.trim().replace(/^["']|["']$/g, '');
                script = `${speakerId}: "${cleanText}"`;
            }
        }

        return {
            ...scene,
            style_video: styleVideo,
            script: script,
            speaker_id: speakerId
        };
    });
};

// Helper: Upload a local File to Gemini File API and return { uri, mimeType }
const uploadLocalVideoToGemini = async (file: File, apiKey: string): Promise<{ uri: string; mimeType: string }> => {
    const ai = new GoogleGenAI({ apiKey });
    const mimeType = file.type || 'video/mp4';
    const uploadResult = await ai.files.upload({
        file: file,
        config: { mimeType },
    });
    
    // Wait for processing to complete (timeout 5 phút)
    let fileInfo = uploadResult;
    const maxWait = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();
    while (String(fileInfo.state) === 'PROCESSING') {
        if (Date.now() - startTime > maxWait) {
            throw new Error('Upload video timeout: xử lý quá 5 phút.');
        }
        await sleep(3000);
        fileInfo = await ai.files.get({ name: fileInfo.name! });
    }
    
    if (String(fileInfo.state) === 'FAILED') {
        throw new Error(`Upload video thất bại: ${fileInfo.error?.message || fileInfo.name}`);
    }
    
    if (!fileInfo.uri) {
        throw new Error('Upload thành công nhưng không nhận được URI.');
    }
    
    console.log(`[Upload] Video uploaded: ${fileInfo.uri} (${mimeType}, state: ${fileInfo.state})`);
    return { uri: fileInfo.uri, mimeType };
};

export const runAnalysis = async (
    metadata: VideoMetadata,
    style: string,
    modelId: string,
    languageCode: string,
    outputDurationMinutes: number | undefined,
    variationPrompt: string | undefined,
    sceneDuration: number = 8,
    audioMode: 'narration' | 'dialogue' | 'asmr' | 'auto' = 'dialogue',
    onStateUpdate: (state: AnalysisState) => void,
    onComplete: (result: GeminiAnalysisResponse) => void,
    imageFiles?: File[],
    signal?: AbortSignal,
    localVideoFile?: File,
    styleWeight: number = 100,
    characterWeight: number = 100,
    generateSrt: boolean = false
) => {
    let currentState: AnalysisState = {
        currentStep: 0,
        steps: [
            { title: "Siêu dữ liệu Video", status: StepStatus.PENDING, output: '', error: null },
            { title: "Tải Video (Mô phỏng)", status: StepStatus.PENDING, output: '', error: null },
            { title: "Phân tích Ngược (Ảnh)", status: StepStatus.PENDING, output: '', error: null },
            { title: "Detect Cảnh quay", status: StepStatus.PENDING, output: '', error: null },
            { title: "Trích xuất Keyframe", status: StepStatus.PENDING, output: '', error: null },
            { title: "Dàn ý Kịch bản (AI)", status: StepStatus.PENDING, output: '', error: null },
            { title: "Phân bổ Scene (Blueprint)", status: StepStatus.PENDING, output: '', error: null },
            { title: "Chi tiết Cảnh quay (AI)", status: StepStatus.PENDING, output: '', error: null },
            { title: "Cấu trúc JSON", status: StepStatus.PENDING, output: '', error: null },
            { title: "Final Prompts", status: StepStatus.PENDING, output: '', error: null },
        ],
    };

    const updateStep = (idx: number, status: StepStatus, output?: any, error?: string) => {
        const newSteps = [...currentState.steps];
        newSteps[idx] = { ...newSteps[idx], status, output: output || newSteps[idx].output, error: error || null };
        
        let nextStep = currentState.currentStep;
        if (status === StepStatus.PROCESSING) {
            nextStep = idx;
        } else if (status === StepStatus.COMPLETE && idx < newSteps.length - 1) {
            nextStep = idx + 1;
            newSteps[idx + 1] = { ...newSteps[idx + 1], status: StepStatus.PROCESSING };
        }
        
        currentState = { ...currentState, steps: newSteps, currentStep: nextStep };
        console.log(`[updateStep] idx=${idx}, status=${status}, nextStep=${nextStep}, steps[9].status=${currentState.steps[9].status}`);
        onStateUpdate(currentState);
    };

    try {
        updateStep(0, StepStatus.PROCESSING, JSON.stringify(metadata, null, 2));
        updateStep(0, StepStatus.COMPLETE);

        updateStep(1, StepStatus.PROCESSING, "Đang chuẩn bị dữ liệu video...");
        
        // Upload local video file to Gemini File API if available
        let uploadedFileUri: string | null = null;
        let uploadedFileMimeType: string = 'video/mp4';
        if (localVideoFile) {
            try {
                updateStep(1, StepStatus.PROCESSING, `Đang tải video "${localVideoFile.name}" (${(localVideoFile.size / 1024 / 1024).toFixed(1)}MB) lên Gemini...`);
                const { getAvailableKeyAndModel } = await import('./apiKeyService');
                const combo = getAvailableKeyAndModel(modelId);
                if (!combo) throw new Error('Không có API Key khả dụng.');
                const uploaded = await uploadLocalVideoToGemini(localVideoFile, combo.key);
                uploadedFileUri = uploaded.uri;
                uploadedFileMimeType = uploaded.mimeType;
                updateStep(1, StepStatus.COMPLETE, `Đã tải video lên thành công. URI: ${uploadedFileUri}`);
            } catch (uploadErr) {
                console.error('[runAnalysis] Failed to upload local video:', uploadErr);
                updateStep(1, StepStatus.COMPLETE, `Không thể tải video lên Gemini (${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}). AI sẽ phân tích dựa trên metadata.`);
            }
        } else {
            await sleep(500);
            updateStep(1, StepStatus.COMPLETE);
        }

        let imageCharacterProfile: any = null;
        let imageStyleProfile: any = null;
        let imageSampleVideoPrompt: string | null = null;

        const lang = languages.find(l => l.code === languageCode)?.name || 'English';

        if (imageFiles && imageFiles.length > 0) {
            updateStep(2, StepStatus.PROCESSING, `Đang phân tích ${imageFiles.length} ảnh để trích xuất phong cách & nhân vật...`);
            
            const fileToPart = async (file: File) => {
                const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(file);
                });
                return { inlineData: { data: base64, mimeType: file.type } };
            };

            const imageParts = await Promise.all(imageFiles.map(fileToPart));
            const reversePrompt = `
            BẠN LÀ "VISUAL DNA ANALYZER" CHUYÊN NGHIỆP. 
            NGÔN NGỮ BẮT BUỘC: 100% nội dung phản hồi (bao gồm tất cả các trường JSON) PHẢI bằng tiếng ${lang}.
            TUYỆT ĐỐI KHÔNG trộn lẫn tiếng Anh (ngoại trừ các thuật ngữ kỹ thuật không thể dịch).

            NHIỆM VỤ: BÓ TÁCH PHONG CÁCH (STYLE) VÀ NHÂN VẬT (CHARACTER) TỪ CÁC HÌNH ẢNH CUNG CẤP THEO 4 NHÓM LỚN:

            NHÓM 1: XÁC ĐỊNH MEDIUM (CHẤT LIỆU/LOẠI HÌNH)
            - 3D/CGI: (Pixar, Unreal Engine, Claymation, Voxel, Low-poly).
            - 2D/Hand-drawn: (Anime, Manga, Studio Ghibli, American Cartoon, Comic book, Sketch).
            - Realistic/Cinematic: (Phim điện ảnh, Documentary, High-fashion photography, Noir, Monochrome).
            - Traditional Art: (Sơn dầu, Màu nước, Phác thảo chì, Tranh khắc gỗ, Acrylic).
            - Experimental: (Pixel Art, Paper Cutout, Synthwave/Retro, Glitch Art, Watercolor Wash).

            NHÓM 2: THÔNG SỐ KỸ THUẬT (TECHNICAL SPECS)
            - Ánh sáng: (Soft light, Chiaroscuro, Neon, Natural sunlight).
            - Góc máy: (POV, Wide-angle, Macro, Bird's eye view).
            - Độ chi tiết: (Minimalist, Hyper-detailed, Grainy film, Cel-shaded).

            NHÓM 3: MOOD & ATMOSPHERE (CẢM XÚC)
            - (Cyberpunk, Dreamy, Dark, Vibrant, Nostalgic, Gritty).

            NHÓM 4: CHARACTER ANCHOR (NEO NHÂN VẬT)
            - Nhận diện nhân vật xuất hiện xuyên suốt.
            - Tạo ID cố định: [NAME_V1].
            - Mô tả ngoại hình chi tiết (Tóc, mắt, trang phục, đặc điểm nhận dạng).

            KẾT QUẢ ĐẦU RA:
            1. STYLE PROFILE: Tổng hợp thành các trường Medium, Lighting, Color Grading, Lens, Materials.
            2. STYLE TAGS: Danh sách các từ khóa phong cách độc lập.
            3. CHARACTER PROFILE: ID và mô tả chi tiết để làm "Neo nhân vật".
            4. SAMPLE VIDEO PROMPT: Tạo một prompt tạo video mẫu cụ thể, chi tiết nhất có thể bằng tiếng ${lang}, kết hợp hoàn hảo giữa Style Profile và Character Profile. Prompt này sẽ được dùng làm "Khuôn mẫu" (Template) để clone các cảnh video khác.
            QUY TẮC BẮT BUỘC: TUYỆT ĐỐI KHÔNG bao gồm các từ thừa như "Prompt:", "Mô tả:", "Description:", "Sample:". Chỉ trả về nội dung mô tả trực tiếp.
            `;

            const reverseSchema = {
                type: Type.OBJECT,
                properties: {
                    character_profile: responseSchema.properties.character_profile,
                    style_profile: responseSchema.properties.style_profile,
                    sample_video_prompt: { type: Type.STRING, description: `A highly detailed sample prompt in ${lang} to generate a video in this exact style with this character.` }
                },
                required: ['character_profile', 'style_profile', 'sample_video_prompt']
            };

            if (signal?.aborted) throw new DOMException('Phân tích đã bị dừng', 'AbortError');
            const reverseResult = await generateAndParseJsonWithRetry<any>(modelId, { parts: [...imageParts, { text: reversePrompt }] }, reverseSchema, 3, (a, d, r) => {
                updateStep(2, StepStatus.PROCESSING, `Thử lại phân tích ảnh do ${r}...`);
            }, signal);

            // Chuẩn hóa phòng thủ các trường trả về (hỗ trợ cả camelCase từ OpenAI/Proxy)
            const charProf = reverseResult?.character_profile || reverseResult?.characterProfile || reverseResult?.character || {};
            imageCharacterProfile = {
                id: charProf?.id || charProf?.character_id || '[CHAR_V1]',
                description: charProf?.description || charProf?.prompt || '',
                physical_traits: Array.isArray(charProf?.physical_traits) 
                    ? charProf.physical_traits 
                    : Array.isArray(charProf?.physicalTraits)
                    ? charProf.physicalTraits
                    : []
            };

            const styleProf = reverseResult?.style_profile || reverseResult?.styleProfile || reverseResult?.style || {};
            imageStyleProfile = {
                medium: styleProf?.medium || styleProf?.art_style || styleProf?.format || 'Cinematic',
                lighting: styleProf?.lighting || styleProf?.light || '',
                color_grading: styleProf?.color_grading || styleProf?.colorGrading || styleProf?.colors || '',
                lens_film: styleProf?.lens_film || styleProf?.lensFilm || styleProf?.camera || '',
                environment_materials: styleProf?.environment_materials || styleProf?.environmentMaterials || styleProf?.materials || '',
                style_tags: Array.isArray(styleProf?.style_tags)
                    ? styleProf.style_tags
                    : Array.isArray(styleProf?.styleTags)
                    ? styleProf.styleTags
                    : []
            };

            imageSampleVideoPrompt = reverseResult?.sample_video_prompt || reverseResult?.sampleVideoPrompt || reverseResult?.sample_prompt || '';

            const mediumVal = imageStyleProfile?.medium || 'Cinematic';
            const charIdVal = imageCharacterProfile?.id || '[CHAR_V1]';
            updateStep(2, StepStatus.COMPLETE, `Đã học phong cách: ${mediumVal} và nhân vật: ${charIdVal}`);
        } else {
            updateStep(2, StepStatus.COMPLETE, "Bỏ qua (Không có ảnh tải lên).");
        }

        const isVariation = !!variationPrompt?.trim();
        const isSummary = !!(outputDurationMinutes && outputDurationMinutes > 0);
        const isAutoMode = audioMode === 'auto';
        const isNarrationMode = audioMode === 'narration';
        const isAsmrMode = audioMode === 'asmr';
        // audioMode='auto' → AI tự phân tích từ video, không ép chế độ nào
        
        const targetDurationSeconds = isSummary ? (outputDurationMinutes! * 60) : (metadata.duration > 0 ? metadata.duration : 300);
        
        updateStep(3, StepStatus.PROCESSING, `Mục tiêu thời lượng: ${formatTime(targetDurationSeconds)}`);
        await sleep(500);
        
        // Số giây mỗi cảnh do user chọn (6 | 8 | 10) — ảnh hưởng số cảnh và word limit
        const density = sceneDuration;
        const sceneCount = Math.max(8, Math.ceil(targetDurationSeconds / density));
        updateStep(3, StepStatus.COMPLETE, `Phát hiện khoảng ${sceneCount} cảnh tiềm năng để bao phủ ${formatTime(targetDurationSeconds)}.`);

        updateStep(4, StepStatus.PROCESSING, "Đang trích xuất keyframe...");
        await sleep(500);
        updateStep(4, StepStatus.COMPLETE, { log: "Keyframes prepared.", keyframes: [] });

        updateStep(5, StepStatus.PROCESSING, "AI đang XEM và phân tích video thực...");

        // ─ Xác định video URI để gửi cho Gemini
        const isLocalFile = !!(metadata.videoId && metadata.videoId.startsWith('local'));
        const videoFileUri = isLocalFile
            ? uploadedFileUri  // Local file: dùng URI đã upload lên Gemini File API
            : (metadata.videoId ? `https://www.youtube.com/watch?v=${metadata.videoId}` : null);

        // Helper: gói prompt + video thành contents cho Gemini
        // mimeType là BẮT BUỘC trong fileData theo SDK @google/genai
        const videoMimeType = isLocalFile ? uploadedFileMimeType : 'video/mp4';
        const withVideo = (promptText: string, includeTimestamp?: { tStart: number; tEnd: number }) => {
            if (!videoFileUri) return promptText; // Không có video URI → text-only
            const timeHint = includeTimestamp
                ? `\n[FOCUS: Phân tích đoạn video từ giây ${includeTimestamp.tStart} đến giây ${includeTimestamp.tEnd}. Bạn đang xem video thực, hãy mô tả những gì BẠN NHÌN THẤY trong khoảng thời gian này.]`
                : '';
            return {
                parts: [
                    { fileData: { fileUri: videoFileUri, mimeType: videoMimeType } },
                    { text: promptText + timeHint }
                ]
            };
        };

        const voiceConfig = getVoiceConfig(languageCode);
        const promptGenerateSrt = true;
        const tokenSavingRule = !promptGenerateSrt
            ? `
⚠️ CHẾ ĐỘ TIẾT KIỆM TOKEN (KHÔNG TẠO PHỤ ĐỀ/LỜI THOẠI):
- TUYỆT ĐỐI KHÔNG VIẾT LỜI THOẠI HAY LỜI DẪN CHUYỆN.
- Đối với mọi phần (part) trong kịch bản: trường 'script' BẮT BUỘC thiết lập là "~".
- Đối với mọi phần (part): trường 'speaker_id' BẮT BUỘC thiết lập là "~".
`
            : `
=== ⚠️ SCRIPT = LỜI THOẠI CHO FILE SRT PHỤ ĐỀ (BẮT BUỘC) ===
- Script trong mỗi phần là NỘI DUNG THOẠI/THUYẾT MINH sẽ xuất ra file SRT phụ đề.
- Script PHẢI 100% bằng tiếng ${lang}. TUYỆT ĐỐI KHÔNG dùng ngôn ngữ gốc của video.
- Script KHÔNG PHẢI là mô tả hình ảnh hay prompt tạo video. Script là LỜI NÓI THỰC SỰ.
- ⚠️ QUAN TRỌNG: Mỗi cảnh chỉ 8 giây. TTS đọc ~2 từ/giây → MỖI CẢNH TỐI ĐA 15 TỪ. Script dài hơn = thoại bị cắt!
- Mỗi phần (part) gồm vài cảnh → script cho mỗi phần chỉ nên 2-3 câu ngắn, tổng ≤40 từ.
${getScriptWordLimitRule(languageCode, lang)}
${getVoiceInstructions(languageCode, lang)}
`;

        const outlinePrompt = `
BẠN LÀ ĐẠO DIỄN PHIM ĐANG XEM VIDEO THỰC. PHẢN HỒI 100% tiếng ${lang} (chỉ thuật ngữ kỹ thuật mới giữ tiếng Anh).

${videoFileUri
    ? `⚠️ BAN ĐANG XEM VIDEO THỰC: "${metadata.title}"
Nhiệm vụ: Phân tích NỘI DUNG THỰC TẾN TẠI trong video. KHÔNG tưởng tượng. KHÔNG sáng tạc. Chỉ mô tả những gì bạn thực sự nhìn thấy.`
    : `⚠️ Video cục bộ (không có URL). Sử dụng metadata để phân tích.\nTiêu đề: ${metadata.title}\nThời lượng: ${formatTime(targetDurationSeconds)}`
}

=== CHẾ ĐỘ HOẠT ĐỘNG ===
${isSummary
    ? `⚡ COMPRESS MODE: Tóm tắt nội dung video xuống ${formatTime(targetDurationSeconds)}, giữ nhịp điệu gốc.`
    : `🎯 CLONE MODE: Clone NỘI DUNG & CẤU TRÚC video gốc (cốt truyện, hành động, nhịp edit). Đổi ngôn ngữ sang ${lang}.`
}
${isVariation ? `
✏️ YÊU CẦU THAY ĐỔI TỪ NGƯỜI DÙNG (BẮT BUỘC ÁP DỤNG):
"${variationPrompt}"
⚡ Giữ nhịp edit + cấu trúc video gốc, nhưng THAY ĐỔI nội dung theo yêu cầu trên.
   Nếu yêu cầu đổi nhân vật → đổi tên + ngoại hình, giữ hành động/tương tác gốc.
   Nếu yêu cầu đổi bối cảnh → đổi setting, giữ cốt truyện gốc.
   Nếu yêu cầu chung → AI tự phân tích và áp dụng hợp lý.
` : ''}
${imageStyleProfile ? `
🎨 PHONG CÁCH HÌNH ẢNH KHÓA TỪ ẢNH THAM CHIẾU (BẮT BUỘC):
   - Medium: ${imageStyleProfile.medium}
   - Lighting: ${imageStyleProfile.lighting}
   - Color: ${imageStyleProfile.color_grading}
   - Lens: ${imageStyleProfile.lens_film}
   - Materials: ${imageStyleProfile.environment_materials}
   - Tags: ${imageStyleProfile.style_tags?.join(', ') || ''}
   ⚡ TẤT CẢ mô tả cảnh PHẢI dùng phong cách này. KHÔNG copy phong cách gốc từ video!
${imageSampleVideoPrompt ? `   📋 PROMPT MẪU: "${imageSampleVideoPrompt}"` : ''}
` : `   PHONG CÁCH HÌNH ẢNH: "${style}" do người dùng chọn. KHÔNG copy phong cách gốc video.`
}

=== NHIỆM VỤ ===
Tạo dàn ý JSON chia thành ĐÚNG 6-8 phần. Tổng thời lượng = ${formatTime(targetDurationSeconds)} (${targetDurationSeconds} giây).
⚠️ QUY TẮC THỜI LƯỢNG CỨNG:
   - Phần đầu tiên bắt đầu tại start_time = "00:00".
   - Phần cuối cùng kết thúc tại end_time = "${formatTime(targetDurationSeconds)}".
   - start_time của phần sau = end_time của phần trước (KHÔNG có kẽ hở).
   - TUYỆT ĐỐI KHÔNG tạo phần có end_time vượt quá "${formatTime(targetDurationSeconds)}".

1. NHÂN VẬT — BẮT BUỘC (CLONE = MÔ TẢ CHÍNH XÁC TỪ VIDEO):
   - Liệt kê TẤT CẢ nhân vật THỰC SỰ xuất hiện trong video.
   - Mỗi nhân vật PHẢI có: 'id' [TÊN_V1], 'name', 'prompt', 'voice_id', 'original_names'.
   - voice_id BẮT BUỘC thuộc locale ${voiceConfig.locale}. Chọn từ: ${voiceConfig.voices.join(', ')}
   - KHÔNG được dùng voice locale của ngôn ngữ khác!
   - Nhân vật nam → voice "...-male-...". Nhân vật nữ → voice "...-female-...".
   - 2 nhân vật khác nhau PHẢI có voice_id khác nhau.
   - 'original_names' BẮT BUỘC là mảng các tên riêng gốc của nhân vật này trong video gốc đối thủ (ví dụ: ["Raju", "Amit", "Raj"]). Nếu không có hoặc tự sáng tác, để mảng rỗng []. Quy tắc này cực kỳ quan trọng để hệ thống tự động chuẩn hoá tên.
   - 'prompt' = MÔ TẢ NGOẠI HÌNH CỰC KỲ CHI TIẾT VÀ CHÍNH XÁC từ video:
     • Màu tóc, kiểu tóc, độ dài tóc.
     • Màu mắt, hình dáng khuôn mặt.
     • Trang phục CHI TIẾT: màu sắc, chất liệu, kiểu dáng, phụ kiện.
     • Thể hình: cao/thấp, gầy/mập, tuổi tác ước lượng.
     • Đặc điểm nhận dạng: sẹo, hình xăm, trang sức, vũ khí.
   - KHÔNG sáng tạc nhân vật không có trong video.
   - DỊCH THUẬT: Mô tả trang phục, đồ vật bằng ${lang}. KHÔNG giữ nguyên tên gốc nước ngoài (ví dụ: "kurta" → "áo dài tay trắng", "saree" → "váy quấn", "turban" → "khăn xếp đầu"). Nếu không biết dịch chính xác, hãy MÔ TẢ hình dáng bằng ${lang}.

2. DÀN Ý — BẮT BUỘC:
   - Dựa vào cấu trúc THỰC TẾ của video (mở đầu/giữa/kết).
   - Script: lời dẫn hoặc thoại THỰC SỰ bằng ${lang}, không tóm tắt chung chung.
   - Phần 1 (HOOK): Bắt đầu điểm hấp dẫn nhất trong video.
   - ⚠️ MỌI PHẦN ĐỀU PHẢI CÓ LỜI THOẠI/NARRATION THỰC SỰ: TUYỆT ĐỐI KHÔNG dùng mô tả âm thanh môi trường (tiếng gió, tiếng nước...) làm script. Script = lời người nói, không phải SFX.
   - Khi nhiều nhân vật cùng có mặt trong 1 phần, script PHẢI nhắc đến TẤT CẢ nhân vật đó.

${tokenSavingRule}
        `;

        if (signal?.aborted) throw new DOMException('Phân tích đã bị dừng', 'AbortError');
        const storyOutline = await generateAndParseJsonWithRetry<StoryOutline>(
            modelId, 
            withVideo(outlinePrompt),   
            storyOutlineSchema, 3, 
            (a, d) => { updateStep(5, StepStatus.PROCESSING, `Đang xử lý video... (lần thử ${a})`); },
            signal
        );
        updateStep(5, StepStatus.COMPLETE, JSON.stringify(storyOutline, null, 2));

        // Step 6: Phân bổ Scene (Blueprint)
        const targetScenes = Math.max(8, Math.ceil(targetDurationSeconds / density));

        updateStep(6, StepStatus.PROCESSING, `Đang phân bổ ${targetScenes} scene vào ${storyOutline.parts.length} phần...`);

        const activeStyleDNAForBlueprint = imageStyleProfile ? formatStyleProfile(imageStyleProfile) : getStyleLabel(style);
        let blueprintScriptDraftRule = '';
        if (!promptGenerateSrt) {
            blueprintScriptDraftRule = `5. script_draft: BẮT BUỘC thiết lập là "~" (không tạo thoại/thuyết minh).`;
        } else if (isAsmrMode) {
            blueprintScriptDraftRule = `5. script_draft: Mô tả âm thanh ASMR bằng tiếng ${lang} (Ví dụ: "Tiếng bước chân", "Tiếng lá xạc xào"). BẮT BUỘC bắt đầu bằng [SFX: <mô tả âm thanh>]. Tối đa \${Math.round(density * 1.875)} từ.`;
        } else if (isAutoMode) {
            blueprintScriptDraftRule = `5. script_draft: Lời thoại hoặc thuyết minh nháp bằng tiếng ${lang}. Nếu là thoại, bắt đầu bằng [CHAR_ID]: "Lời thoại". Nếu là thuyết minh, viết văn xuôi không prefix. Tối đa \${Math.round(density * 1.875)} từ.`;
        } else if (audioMode === 'dialogue') {
            blueprintScriptDraftRule = `5. script_draft: Lời thoại của nhân vật trong cảnh. BẮT BUỘC định dạng: [CHAR_ID]: "Nội dung lời thoại bằng tiếng ${lang}". Tối đa \${Math.round(density * 1.875)} từ.`;
        } else {
            // narration mode
            blueprintScriptDraftRule = `5. script_draft: Lời dẫn chuyện (narration) bằng tiếng ${lang}. Tối đa \${Math.round(density * 1.875)} từ. KHÔNG dùng prefix nhân vật.`;
        }
        
        const blueprintPrompt = `
BẠN LÀ ĐẠO DIỄN PHIM. PHẢN HỒI 100% tiếng ${lang}.

=== DÀN Ý KỊCH BẢN ===
${storyOutline.parts.map(part => `- Phần ${part.part_id} [\${part.start_time} - \${part.end_time}] "${part.title}":
  + Tóm tắt: ${part.summary}
  + Thoại nháp: ${part.script}`).join('\n')}

=== NHÂN VẬT ===
${formatCharactersForPrompt(storyOutline.characters)}

=== PHONG CÁCH HÌNH ẢNH ===
STYLE_DNA: "${activeStyleDNAForBlueprint}"
${imageStyleProfile ? `Lighting: ${imageStyleProfile.lighting} | Color: ${imageStyleProfile.color_grading} | Lens: ${imageStyleProfile.lens_film}` : ''}
${isVariation ? `\n✏️ YÊU CẦU TỪ NGƯỜI DÙNG: "${variationPrompt}" — phải áp dụng vào visual_hint của từng scene.` : ''}

=== NHIỆM VỤ ===
Phân bổ CHÍNH XÁC ${targetScenes} scene (mỗi scene ${density} giây) vào các phần dàn ý bên trên.
Tổng thời lượng: ${targetDurationSeconds} giây.

QUY TẮC:
1. Scene đầu tiên: t0 = "00:00". Scene cuối: t1 = "${formatTime(targetDurationSeconds)}".
2. Mỗi scene = ${density} giây. t0 scene sau = t1 scene trước (KHÔNG kẽ hở).
3. part_id phải khớp with part_id (số nguyên) trong dàn ý (1, 2, 3...). Scene phải nằm trong time range của phần tương ứng.
4. content_brief: 1-2 câu mô tả diễn biến chính của scene.
5. ${blueprintScriptDraftRule}
6. visual_hint: Gợi ý bối cảnh, góc máy, hành động + phong cách STYLE_DNA. Dùng Character ID [NAME_V1] thay vì tên.
7. Phân bổ nội dung ĐỀU giữa các phần — KHÔNG dồn quá nhiều scene vào 1 phần.
8. Đảm bảo câu chuyện diễn biến TUẦN TỰ, không nhảy cóc.
        `;

        if (signal?.aborted) throw new DOMException('Phân tích đã bị dừng', 'AbortError');
        const blueprintResult = await generateAndParseJsonWithRetry<{ scenes: SceneBlueprintItem[] }>(
            modelId,
            withVideo(blueprintPrompt),
            sceneBlueprintSchema,
            3,
            (attempt, _delay, reason) => {
                updateStep(6, StepStatus.PROCESSING, `Thử lại lần ${attempt} do ${reason}...`);
            },
            signal
        );
        const sceneBlueprint: SceneBlueprintItem[] = blueprintResult.scenes || [];
        updateStep(6, StepStatus.COMPLETE, `Đã phân bổ ${sceneBlueprint.length}/${targetScenes} scene vào ${storyOutline.parts.length} phần.`);


        // Step 7: Chi tiết Cảnh quay – dùng Blueprint gộp theo Phần Câu Chuyện (Story Parts) để tránh lệch vị trí
        
        let finalJson: GeminiAnalysisResponse | null = null;
        const allAssets = new Map<string, GeminiAsset>();
        const accumulatedScenes: GeminiScene[] = []; 

        const outlineParts = storyOutline.parts || [];
        const numParts = outlineParts.length;
        console.log(`[Analysis] Target: ${targetScenes} cảnh, phân bổ theo ${numParts} phần câu chuyện.`);

        for (let i = 0; i < numParts; i++) {
            const part = outlineParts[i];
            
            // Tìm các blueprint scenes thuộc part này
            const partBlueprints = sceneBlueprint.filter(bp => Number(bp.part_id) === Number(part.part_id));
            if (partBlueprints.length === 0) {
                console.warn(`[Analysis] Không tìm thấy blueprint cho phần ${part.part_id}, bỏ qua.`);
                continue;
            }
            
            // Sắp xếp theo scene_index tăng dần
            partBlueprints.sort((a, b) => a.scene_index - b.scene_index);
            
            const startSceneIdx = partBlueprints[0].scene_index;
            const endSceneIdx = partBlueprints[partBlueprints.length - 1].scene_index;
            const currentBatchSize = partBlueprints.length;

            const tStart = (startSceneIdx - 1) * density;
            const tEnd = Math.min(endSceneIdx * density, targetDurationSeconds);
            const chunkDuration = tEnd - tStart;

            if (i > 0) {
                // Nghỉ giãn cách giữa các batch để tránh Rate Limit (429)
                const batchDelay = isProxyEnabled() ? 10000 : 3000;
console.log(`[Analysis] Tạm nghỉ ${batchDelay}ms giữa các phần để tránh rate limit (429)...`);
                await sleep(batchDelay);
            }

            const previousScenesContext = accumulatedScenes.length > 0
                ? `=== KỊCH BẢN CÁC CẢNH TRƯỚC ĐÓ (BẮT BUỘC ĐỐI CHIẾU LŨY KẾ) ===
Dưới đây là lời thoại và mô tả của các cảnh trước đó đã sinh thành công. 
AI PHẢI đọc kỹ để tiếp tục mạch kịch bản trôi chảy:
${JSON.stringify(accumulatedScenes.map(s => ({ scene_id: s.scene_id, script: s.script, summary: s.summary })), null, 2)}
 
⚠️ BẮT BUỘC ĐỐI CHIẾU & LÀM MƯỢT NGÔN NGỮ THOẠI CỦA QUỐC GIA ${lang}:
   - Đọc kỹ lời thoại (script) và tóm tắt (summary) của các cảnh trước đó để viết tiếp mượt mà nhất.
   - TUYỆT ĐỐI KHÔNG lặp lại từ bắt đầu câu thoại, không lặp cấu trúc ngữ pháp thoại từ các cảnh trước.
   - Điều chỉnh văn phong thoại tự nhiên, trôi chảy, đúng điệu tự nhiên nhất của người bản xứ ${lang}.
   - Đảm bảo diễn biến tâm lý, thái độ nhân vật chuyển tiếp logic từ các cảnh trước.`
                : `=== KỊCH BẢN CÁC CẢNH TRƯỚC ĐÓ ===
(Không có, đây là Lô thứ nhất. Hãy đặt nền móng thoại và bối cảnh thật lôi cuốn, đanh thép, chuẩn văn phong thoại tự nhiên của quốc gia ${lang}!)`;

            const blueprintContext = partBlueprints.length > 0
                ? `=== BLUEPRINT CHI TIẾT CHO BATCH NÀY (BẮT BUỘC TRIỂN KHAI ĐÚNG TỪNG SCENE) ===
Dưới đây là nội dung ĐÃ PHÂN BỔ SẴN cho từng scene trong batch này. Batch này đại diện cho:
Phần ${part.part_id}: ${part.title} (Tóm tắt: ${part.summary})

AI BẮT BUỘC phải triển khai chi tiết TỪNG SCENE theo đúng blueprint:
${partBlueprints.map(bp => `- Scene ${bp.scene_index} [${bp.t0} - ${bp.t1}] (Phần ${bp.part_id}):
  + Nội dung: ${bp.content_brief}
  + Thoại nháp: ${bp.script_draft}
  + Hình ảnh: ${bp.visual_hint}`).join('\n\n')}

⚠️ TUYỆT ĐỐI KHÔNG thay đổi thứ tự, bỏ sót, hoặc nhảy cóc nội dung. Mỗi scene PHẢI match đúng blueprint.`
                : `(Không có blueprint riêng cho phần này. Hãy sinh cảnh dựa trên bối cảnh chung.)`;

            const sceneCharacters = storyOutline.characters && storyOutline.characters.length > 0
                ? storyOutline.characters
                : (imageCharacterProfile ? [{ id: imageCharacterProfile.id, name: imageCharacterProfile.id, prompt: imageCharacterProfile.description }] : []);
            const sceneCharList = isVariation 
                ? formatCharactersForPrompt(sceneCharacters)
                : formatCharactersFullForPrompt(sceneCharacters);
            const activeStyleDNA = imageStyleProfile ? formatStyleProfile(imageStyleProfile) : getStyleLabel(style);

            // ── Xác định mức độ clone/remix dựa trên weights ──
            const avgWeight = (styleWeight + characterWeight) / 2;
            const isLowRemix = avgWeight < 30;       // 0-29%: remix mạnh
            const isMediumRemix = avgWeight < 70;     // 30-69%: remix vừa
            // 70-100%: clone sát gốc

            const cloneModeDirective = isSummary
                ? `⚡ COMPRESS: Giữ nguyên nhịp điệu và loại cảnh gốc, rút gọn đều tay.`
                : isLowRemix
                ? `🔀 REMIX MẠNH (${avgWeight.toFixed(0)}%): Lấy CẢM HỨNG từ video gốc (chủ đề, bối cảnh chung) nhưng SÁNG TẠO LẠI hoàn toàn cấu trúc cảnh, hành động, góc máy. PHONG CÁCH HÌNH ẢNH theo STYLE_DNA "${activeStyleDNA}".`
                : isMediumRemix
                ? `🔄 REMIX VỪA (${avgWeight.toFixed(0)}%): Giữ mạch chuyện và bối cảnh chính từ video gốc, nhưng TỰ DO thay đổi chi tiết hành động, góc máy, nhịp cắt. PHONG CÁCH HÌNH ẢNH theo STYLE_DNA "${activeStyleDNA}".`
                : `🎯 CLONE NỘI DUNG: Mirror nhịp edit, loại cảnh, hành động từ video gốc. PHONG CÁCH HÌNH ẢNH phải theo STYLE_DNA "${activeStyleDNA}" — KHÔNG copy phong cách gốc video.`;

            // Block yêu cầu thay đổi từ người dùng (nếu có)
            const userRequestBlock = isVariation ? `
✏️ YÊU CẦU THAY ĐỔI TỪ NGƯỜI DÙNG (BẮT BUỘC ÁP DỤNG):
"${variationPrompt}"
⚡ Áp dụng yêu cầu trên VÀO mỗi cảnh. Giữ nhịp edit + cấu trúc video gốc.
` : '';

            const remixWeightHint = (styleWeight < 100 || characterWeight < 100) ? `
⚠️ REMIX WEIGHT (do người dùng điều chỉnh):
   - Phong cách ảnh: ${styleWeight}% → ${styleWeight >= 80 ? 'Giữ sát phong cách gốc' : styleWeight >= 50 ? 'Tự do sáng tạo một phần, giữ nét chính' : styleWeight >= 20 ? 'Sáng tạo phần lớn, chỉ giữ tone chung' : 'Sáng tạo hoàn toàn tự do'}.
   - Chi tiết nhân vật: ${characterWeight}% → ${characterWeight >= 80 ? 'Giữ NGUYÊN ngoại hình, trang phục, đặc điểm' : characterWeight >= 50 ? 'Giữ nét chính nhưng có thể thay đổi phụ kiện, màu sắc' : characterWeight >= 20 ? 'Giữ vai trò + tên, thay đổi phần lớn ngoại hình' : 'Tự do thiết kế lại nhân vật, chỉ giữ tên và vai trò'}.
` : '';

            const audioScriptRule = isAutoMode
                ? `🤖 CHẾ ĐỘ TỰ ĐỘNG — AI TỰ PHÂN TÍCH:
   - TỰ XÁC ĐỊNH video này là DIALOGUE (nhiều nhân vật nói), NARRATION (1 giọng thuyết minh), hay ASMR (không lời, chỉ âm thanh).
   - Nếu DIALOGUE: script dạng [CHAR_ID]: "câu thoại", speaker_id = char nói nhiều nhất.
   - Nếu NARRATION: script = văn xuôi 1 giọng, speaker_id = "~".
   - Nếu ASMR: script = mô tả âm thanh chi tiết, speaker_id = "~", KHÔNG lời thoại.
   - Ghi audio_mode chính xác vào video_meta.
   - ⚠️ TẤT CẢ script PHẢI 100% bằng tiếng ${lang}.`
                : isAsmrMode
                ? `🎧 CHẾ ĐỘ ASMR — KHÔNG LỜI THOẠI, CHỈ MÔ TẢ ÂM THANH:
   - script = mô tả chi tiết ÂM THANH ASMR trong cảnh bằng tiếng ${lang}.
   - VD: "Tiếng gõ nhẹ lên gỗ — toc toc toc. Tiếng xào xạo giấy. Thì thầm nhẹ."
   - TUYỆT ĐỐI KHÔNG viết lời thoại, narrator, hay thuyết minh.
   - Mô tả: loại âm thanh, nhịp độ (nhanh/chậm), cường độ (nhẹ/mạnh), chất liệu (gỗ/kim loại/vải/da...).
   - speaker_id = "~" (không có speaker).
   - style_video PHẢI MÔ TẢ HÀNH ĐỘNG TẠO ÂM THANH: tay gõ, ngón vuốt, miệng thổi, kéo vải, bóp bọt biển...`
                : isNarrationMode
                ? `🎤 CHẾ ĐỘ THUYẾT MINH (NARRATION) — MỘT GIỌNG DUY NHẤT:
   - script = văn xuôi sạch, giàu hình ảnh, viết cho 1 người dẫn chuyện.
   - ⚠️ TẤT CẢ script PHẢI 100% bằng tiếng ${lang}. TUYỆT ĐỐI KHÔNG dùng ngôn ngữ khác.
   - TUYỆT ĐỐI KHÔNG prefix nhân vật. KHÔNG viết thoại trực tiếp giữa các nhân vật.
   - Nếu cảnh có thoại: đưa vào tường thuật bằng tiếng ${lang}.
   - speaker_id = "~" (không có speaker riêng).
   - Giọng điệu phải nhất quán: bình tĩnh, miêu tả, không gấp gáp.`
                : `💬 CHẾ ĐỘ HỘI THOẠI (DIALOGUE) — MỖI NHÂN VẬT MỘT GIỌNG:
   ⚠️ ⚠️ ⚠️ TUYỆT ĐỐI TẤT CẢ LỜI THOẠI PHẢI 100% bằng tiếng ${lang}. KHÔNG dùng tiếng Việt hay ngôn ngữ khác dù chỉ 1 từ.
   - script = mỗi dòng bắt đầu bằng [CHAR_ID]: "Câu thoại bằng tiếng ${lang}"
     CẤU TRÚC: [CHAR_ID]: "<nội dung thoại bằng ${lang}>"
   - speaker_id = Character ID của nhân vật nói nhiều nhất trong cảnh.
   - Mỗi nhân vật PHẢI giữ GIỌNG NÓI RIÊNG phù hợp tính cách.
   - Cảnh không có nhân vật nói: AI tự sáng tác 1 câu narrator ngắn bằng tiếng ${lang}. speaker_id = "~".
   - TUYỆT ĐỐI KHÔNG dùng "[KHÔNG THOẠI]" hay âm thanh môi trường làm script.`;

            const chunkStyleVideoRule = !promptGenerateSrt
                ? `   "${activeStyleDNA} [TẤT CẢ CHARACTER_IDs có mặt] với [ngoại hình/trang phục CHÍNH XÁC theo mô tả nhân vật]. [Bối cảnh môi trường sống động: người xung quanh, động vật, âm thanh, thời tiết, ánh sáng]. [Động từ hành động]. [Góc máy + chuyển động]."
   → TUYỆT ĐỐI KHÔNG chứa [VO: ...] hay lời thoại nào.`
                : isAsmrMode
                ? `   "${activeStyleDNA} [Bối cảnh/đối tượng chi tiết]. [HÀNH ĐỘNG TẠO ÂM THANH: tay gõ, ngón vuốt, kéo, bóp, xé...]. [Extreme close-up / macro / POV]. [Chuyển động máy chậm, mượt]."
   → KHÔNG chứa [VO:] hay lời thoại. CHỈ mô tả HÀNH ĐỘNG VÀ HÌNH ẢNH.
   → Mô tả chi tiết chất liệu bề mặt (gỗ, kim loại, vải, da, nước, bọt...) vì đây là yếu tố chính ASMR.`
                : isNarrationMode
                ? `   "${activeStyleDNA} [TẤT CẢ CHARACTER_IDs có mặt] với [ngoại hình/trang phục CHÍNH XÁC theo mô tả nhân vật]. [Bối cảnh môi trường sống động: người xung quanh, động vật, âm thanh, thời tiết, ánh sáng]. [Động từ hành động]. [Góc máy + chuyển động]. [VO: lời thuyết minh]"
   → style_video PHẢI kết thúc bằng [VO: ...] chứa lời dẫn chuyện narrator.`
                : isAutoMode
                ? `   "${activeStyleDNA} [TẤT CẢ CHARACTER_IDs có mặt] với [ngoại hình/trang phục CHÍNH XÁC theo mô tả nhân vật]. [Bối cảnh môi trường sống động]. [Động từ hành động]. [Góc máy + chuyển động]."
   → Tùy theo audio_mode AI tự xác định:
     • Nếu DIALOGUE → SCRIPT dạng [CHAR_ID]: "câu thoại". KHÔNG có [VO:] trong style_video.
     • Nếu NARRATION → style_video kết thúc bằng [VO: lời dẫn]. SCRIPT = văn xuôi.
     • Nếu ASMR → KHÔNG VO, CHỈ hành động tạo âm thanh. SCRIPT = mô tả âm thanh.`
                : `   "${activeStyleDNA} [TẤT CẢ CHARACTER_IDs có mặt] với [ngoại hình/trang phục CHÍNH XÁC theo mô tả nhân vật]. [Bối cảnh môi trường sống động: người xung quanh, động vật, âm thanh, thời tiết, ánh sáng]. [Động từ hành động]. [Góc máy + chuyển động]."
   → KHÔNG kết thúc bằng [VO: ...]. Lời thoại nhân vật sẽ lấy từ field SCRIPT riêng.
   → SCRIPT dùng format: [CHAR_ID]: "Câu thoại" (mỗi nhân vật một dòng).`;

            const chunkScriptRule = !promptGenerateSrt
                ? `3. KHÔNG CẦN LỜI THOẠI/NARRATION (TIẾT KIỆM TOKEN):
   - script = "~" cho mọi cảnh.
   - speaker_id = "~" cho mọi cảnh.
   - TUYỆT ĐỐI KHÔNG viết thoại hay thuyết minh.`
                : isAsmrMode
                ? `3. CHẾ ĐỘ ASMR — KHÔNG CÓ LỜI THOẠI, CHỈ ÂM THANH:
   - TUYỆT ĐỐI KHÔNG viết lời thoại, narrator, hay thuyết minh trong script.
   - script = mô tả chi tiết âm thanh ASMR bằng tiếng ${lang}: loại âm, nhịp, cường độ, chất liệu.
   - speaker_id = "~" (không có người nói).`
                : isAutoMode
                ? `3. CHẾ ĐỘ TỰ ĐỘNG — AI TỰ QUYẾT ĐỊNH LOẠI AUDIO:
   - AI PHẢI TỰ XÁC ĐỊNH từ video: DIALOGUE, NARRATION, hay ASMR.
   - Nếu video có nhân vật nói chuyện → DIALOGUE: script = [CHAR_ID]: "câu thoại".
   - Nếu video là thuyết minh/bình luận → NARRATION: script = văn xuôi narrator.
   - Nếu video không có lời, chỉ âm thanh (nấu ăn, ASMR, thiên nhiên...) → ASMR: script = mô tả âm thanh, speaker_id = "~".
   - Ghi đúng audio_mode vào video_meta.
   - ⚠️ KHÔNG ÉP thoại vào video không có thoại! Video nấu ăn im lặng thì ghi ASMR.`
                : `3. MỌI CẢNH ĐỀU PHẢI CÓ LỜI THOẠI HOẶC NARRATION — TUYỆT ĐỐI BẮT BUỘC:
   - KHÔNG bao giờ dùng âm thanh môi trường làm script: KHÔNG "Tiếng gió...", "Tiếng nước...", "Tiếng chim hót...", v.v.
   - KHÔNG viết "[VO: không thoại]", "[KHÔNG THOẠI]", hay bất kỳ dạng để trống nào.
   - Cảnh không có nhân vật nói → AI phải TỰ SÁNG TÁC lời narrator ngắn gọn, phù hợp với hành động trong cảnh.
   - Âm thanh môi trường (SFX) chỉ được đặt trong field SND (dành cho AI video tool) — KHÔNG đưa vào script.
   - VD ĐÚNG cảnh hành động im lặng: [narrator tự sáng tác 1 câu phù hợp cảnh bằng tiếng ${lang}]
   - VD ĐÚNG cảnh thiên nhiên: [narrator tự sáng tác 1 câu miêu tả bằng tiếng ${lang}]`;

            const prompt = `
BẠN LÀ ĐẠO DIỄN PHIM ĐANG XEM VIDEO THỰC. PHẢN HỒI 100% tiếng ${lang} (chỉ thuật ngữ kỹ thuật giữ tiếng Anh).

=== CHẾ ĐỘ: ${cloneModeDirective} ===
${remixWeightHint}
${userRequestBlock}
=== NGỮ CẢNH PHẦN ${i + 1}/${numParts}: PHẦN ${part.part_id} - ${part.title} (CẢNH ${startSceneIdx} ĐẾN CẢNH ${endSceneIdx}) ===
${imageStyleProfile ? `
⚠️ HAI NGUỒN INPUT BẮT BUỘC KẾT HỢP:
   📹 VIDEO GỐC → Clone NỘI DUNG: hành động, bối cảnh, nhịp cắt, diễn biến, số nhân vật, tương tác.
   🎨 ẢNH THAM CHIẾU (ĐÃ PHÂN TÍCH) → Khóa PHONG CÁCH HÌNH ẢNH: "${activeStyleDNA}"
   ⚡ MỌI style_video PHẢI dùng phong cách từ ẢNH, KHÔNG phải từ video gốc!
` : ''}
STYLE_DNA: "${activeStyleDNA}"
BỐI CẢNH: ${storyOutline.logline}
${imageSampleVideoPrompt ? `PROMPT MẪU (template phong cách từ ảnh tham chiếu — BẮT BUỘC theo sát cấu trúc này): "${imageSampleVideoPrompt}"` : ''}
AUDIO_MODE: ${isAutoMode ? 'AUTO — AI TỰ XÁC ĐỊNH TỪ VIDEO' : audioMode.toUpperCase()}

NHÂN VẬT REMIX MỚI BẮT BUỘC SỬ DỤNG (TUYỆT ĐỐI KHÔNG DÙNG TÊN TRONG VIDEO GỐC):
${sceneCharList}

${previousScenesContext}

${blueprintContext}

=== NHIỆM VỤ ===
Tạo ĐÚNG ${currentBatchSize} cảnh (~${density} giây/cảnh), bao phủ CHÍNH XÁC từ ${formatTime(tStart)} đến ${formatTime(tEnd)}. Tổng thời lượng batch = ${chunkDuration} giây. KHÔNG ĐƯỢC vượt quá ${formatTime(tEnd)}.
${videoFileUri ? `Tập trung phân tích NỘI DUNG THỰC của video từ giây ${tStart} đến giây ${tEnd}. Mô tả những gì bạn thực sự nhìn thấy trong khoảng thời gian này.` : ''}

=== QUY TẮC CỨNG ===
1. CHARACTER ID — NHÂN VẬT PHẢI GIỐNG Y CHANG MÔ TẢ BÊN TRÊN:
   - ⚠️ TUYỆT ĐỐI KHÔNG sử dụng tên gốc của video URL đối thủ (ví dụ: Raju, Amit, Sita, Vikram, v.v.) trong prompt style_video hay thoại script.
   - BẮT BUỘC sử dụng chính xác ID nhân vật mới dạng [NAME_V1] (ví dụ: [HERO_V1], [VILLAIN_V1]) từ danh sách nhân vật phía trên.
   - TUYỆT ĐỐI KHÔNG thay đổi ngoại hình, trang phục, đặc điểm nhận dạng của nhân vật so với mô tả đã cho.
   - Khi nhân vật xuất hiện trong STYLE_VIDEO: PHẢI dùng ĐÚNG mô tả ngoại hình/trang phục như trong danh sách nhân vật bên trên. KHÔNG tự sáng tạo trang phục/ngoại hình mới.
   - Nếu cảnh có 2+ nhân vật, STYLE_VIDEO PHẢI nhắc đến TẤT CẢ nhân vật đó với mô tả CHÍNH XÁC, KHÔNG được bỏ sót.

2. STYLE_VIDEO (1 câu liền mạch, không xuống dòng):
${isAsmrMode
    ? `   "${activeStyleDNA} [Bối cảnh/đối tượng chi tiết]. [HÀNH ĐỘNG TẠO ÂM THANH: tay gõ, ngón vuốt, kéo, bóp, xé...]. [Extreme close-up / macro / POV]. [Chuyển động máy chậm, mượt]."
   → KHÔNG chứa [VO:] hay lời thoại. CHỈ mô tả HÀNH ĐỘNG VÀ HÌNH ẢNH.
   → Mô tả chi tiết chất liệu bề mặt (gỗ, kim loại, vải, da, nước, bọt...) vì đây là yếu tố chính ASMR.`
    : isNarrationMode
    ? `   "${activeStyleDNA} [TẤT CẢ CHARACTER_IDs có mặt] với [ngoại hình/trang phục CHÍNH XÁC theo mô tả nhân vật]. [Bối cảnh môi trường sống động: người xung quanh, động vật, âm thanh, thời tiết, ánh sáng]. [Động từ hành động]. [Góc máy + chuyển động]. [VO: lời thuyết minh]"
   → style_video PHẢI kết thúc bằng [VO: ...] chứa lời dẫn chuyện narrator.`
    : isAutoMode
    ? `   "${activeStyleDNA} [TẤT CẢ CHARACTER_IDs có mặt] với [ngoại hình/trang phục CHÍNH XÁC theo mô tả nhân vật]. [Bối cảnh môi trường sống động]. [Động từ hành động]. [Góc máy + chuyển động]."
   → Tùy theo audio_mode AI tự xác định:
     • Nếu DIALOGUE → SCRIPT dạng [CHAR_ID]: "câu thoại". KHÔNG có [VO:] trong style_video.
     • Nếu NARRATION → style_video kết thúc bằng [VO: lời dẫn]. SCRIPT = văn xuôi.
     • Nếu ASMR → KHÔNG VO, CHỈ hành động tạo âm thanh. SCRIPT = mô tả âm thanh.`
    : `   "${activeStyleDNA} [TẤT CẢ CHARACTER_IDs có mặt] với [ngoại hình/trang phục CHÍNH XÁC theo mô tả nhân vật]. [Bối cảnh môi trường sống động: người xung quanh, động vật, âm thanh, thời tiết, ánh sáng]. [Động từ hành động]. [Góc máy + chuyển động]."
   → KHÔNG kết thúc bằng [VO: ...]. Lời thoại nhân vật sẽ lấy từ field SCRIPT riêng.
   → SCRIPT dùng format: [CHAR_ID]: "Câu thoại" (mỗi nhân vật một dòng).`}
   ⚠️ MỖI CẢNH PHẢI KHÁC NHAU: Thay đổi góc máy (close-up/wide/POV/bird-eye), khoảng cách máy, cách mở đầu câu. TUYỆT ĐỐI KHÔNG copy cấu trúc cảnh trước.

${isAsmrMode
    ? `3. CHẾ ĐỘ ASMR — KHÔNG CÓ LỜI THOẠI, CHỈ ÂM THANH:
   - TUYỆT ĐỐI KHÔNG viết lời thoại, narrator, hay thuyết minh trong script.
   - script = mô tả chi tiết âm thanh ASMR bằng tiếng ${lang}: loại âm, nhịp, cường độ, chất liệu.
   - VD: "Tiếng gõ nhẹ toc toc lên gỗ sồi. Tiếng xào xạo giấy báo. Thì thầm nhẹ không rõ lời."
   - speaker_id = "~" (không có người nói).`
    : isAutoMode
    ? `3. CHẾ ĐỘ TỰ ĐỘNG — AI TỰ QUYẾT ĐỊNH LOẠI AUDIO:
   - AI PHẢI TỰ XÁC ĐỊNH từ video: DIALOGUE, NARRATION, hay ASMR.
   - Nếu video có nhân vật nói chuyện → DIALOGUE: script = [CHAR_ID]: "câu thoại".
   - Nếu video là thuyết minh/bình luận → NARRATION: script = văn xuôi narrator.
   - Nếu video không có lời, chỉ âm thanh (nấu ăn, ASMR, thiên nhiên...) → ASMR: script = mô tả âm thanh, speaker_id = "~".
   - Ghi đúng audio_mode vào video_meta.
   - ⚠️ KHÔNG ÉP thoại vào video không có thoại! Video nấu ăn im lặng thì ghi ASMR.`
    : `3. MỌI CẢNH ĐỀU PHẢI CÓ LỜI THOẠI HOẶC NARRATION — TUYỆT ĐỐI BẮT BUỘC:
   - KHÔNG bao giờ dùng âm thanh môi trường làm script: KHÔNG "Tiếng gió...", "Tiếng nước...", "Tiếng chim hót...", v.v.
   - KHÔNG viết "[VO: không thoại]", "[KHÔNG THOẠI]", hay bất kỳ dạng để trống nào.
   - Cảnh không có nhân vật nói → AI phải TỰ SÁNG TÁC lời narrator ngắn gọn, phù hợp với hành động trong cảnh.
   - Âm thanh môi trường (SFX) chỉ được đặt trong field SND (dành cho AI video tool) — KHÔNG đưa vào script.
   - VD ĐÚNG cảnh hành động im lặng: [narrator tự sáng tác 1 câu phù hợp cảnh bằng tiếng ${lang}]
   - VD ĐÚNG cảnh thiên nhiên: [narrator tự sáng tác 1 câu miêu tả bằng tiếng ${lang}]`}

4. SCRIPT — ⚠️ NỘI DUNG CHO FILE SRT PHỤ ĐỀ${isAsmrMode ? ' (MÔ TẢ ÂM THANH)' : ' (TỐI ĐA 15 TỪ/CẢNH)'}:
${audioScriptRule}
   - ⚠️ SCRIPT SẼ XUẤT RA FILE SRT PHỤ ĐỀ. PHẢI 100% bằng tiếng ${lang}.
${isAsmrMode
    ? `   - Script là MÔ TẢ ÂM THANH chi tiết, KHÔNG phải lời nói.
   - Mô tả: loại âm thanh + chất liệu + nhịp + cường độ. VD: "Tiếng dao chạm thớt gỗ lách cách nhanh. Tiếng dầu xèo xèo trong chảo nóng."
   - voice_locale = "${voiceConfig.locale}". speaker_id = "~".`
    : `   - Script là LỜI NÓI THỰC SỰ, KHÔNG phải prompt tạo video.
   - ⚠️⚠️⚠️ MỖI CẢNH CHỈ ${density} GIÂY. TTS ĐỌC ~2 TỪ/GIẠY → TỐI ĐA ${Math.round(density * 1.875)} TỪ SCRIPT/CẢNH.
   - Script > ${Math.round(density * 1.875)} từ = TTS KHÔNG KỊP ĐỌC HẾT trong ${density} giây → VIDEO BỊ LỖI.
   - Cảnh hành động → 1 câu 5-8 từ. Cảnh cảm xúc → 1-2 câu, tổng ≤15 từ.
   - voice_locale cho MỌI cảnh PHẢI là "${voiceConfig.locale}".
   - KHÔNG lặp từ mở đầu 2 cảnh liên tiếp.`}
${getScriptWordLimitRule(languageCode, lang, density)}

5. DỊCH THUẬT TRANG PHỤC VÀ VĂN HÓA — QUAN TRỌNG:
   - PHẢI dịch TẤT CẢ tên trang phục, thức ăn, văn hóa sang ${lang}.
   - KHÔNG giữ nguyên tên gốc từ video (ví dụ: "kurta" → "áo dài trắng truyền thống", "saree" → "váy quấn hồng", "turban" → "khăn xếp xanh", "Haakh" → "rau xanh").
   - Nếu không biết dịch chính xác, hãy mô tả bằng ${lang}: "áo dài tay trắng", "váy dài cổ điển", "khăn quấn đầu".
   - Quy tắc này áp dụng cho TẤT CẢ: trang phục, món ăn, đồ vật, tên gọi văn hóa.

6. TIMESTAMP — QUY TẮC CỨNG:
   - Cảnh đầu tiên bắt đầu tại t0 = "${formatTime(tStart)}". Cảnh cuối kết thúc tại t1 = "${formatTime(tEnd)}".
   - Mỗi cảnh kéo dài ĐÚNG ~${density} giây (t1 - t0 = ${density}s). KHÔNG tạo cảnh ngắn hơn ${density - 2}s hoặc dài hơn ${density + 2}s.
   - Timestamp liên tục không kẽ hở: t0 của cảnh sau = t1 của cảnh trước.
   - TUYỆT ĐỐI KHÔNG tạo cảnh có t1 vượt quá ${formatTime(tEnd)}.
7. ⚠️ PHONG CÁCH HÌNH ẢNH BẮT BUỘC — "${activeStyleDNA}":
   - TẤT CẢ style_video PHẢI bắt đầu bằng style "${activeStyleDNA}".
   - KHÔNG clone phong cách hình ảnh gốc của video. CHỈ clone nội dung (nhân vật, hành động, cốt truyện).
   - Nếu style = "image-derived": dùng STYLE_DNA đã trích xuất từ ảnh tham chiếu.
   - Không dùng nhãn thừa: "Prompt:", "Mô tả:", v.v.

8. KHUNG CẢNH MÔI TRƯỜNG — BẮT BUỘC LÀM PHONG PHÚ:
   - KHÔNG tạo cảnh trống trơn chỉ có nhân vật chính. Mọi cảnh PHẢI có chi tiết môi trường xung quanh.
   - STYLE_VIDEO phải tự phân tích bối cảnh và THÊM VÀO các yếu tố sống động:
     • CHỢ/PHỐ: Thêm người qua lại, xe cộ, quầy hàng, tiếng rao, khói bếp, ánh đèn.
     • SÔNG/HỒ: Thêm thuyền khác, cá nhảy, bèo trôi, sóng gợn, ánh phản chiếu mặt nước.
     • RỪNG/ĐỒNG: Thêm chim bay, thú nhỏ, côn trùng, lá rơi, sương mù, tia nắng xuyên tán lá.
     • NHÀ/BẾP: Thêm bếp lửa, nồi nấu, mèo/chó, đồ dùng, khói bay, ánh sáng cửa sổ.
     • ĐƯỜNG/LÀNG: Thêm trẻ em chơi, gà vịt, xe bò, hàng xóm, cây cối, bóng râm.
   - VD sai: "[LADY_V1] đang nấu ăn trong bếp" → Quá đơn giản, bếp trống trơn.
   - VD đúng: "[LADY_V1] đang nấu ăn bên bếp lửa đỏ rực, khói bay nhẹ qua cửa sổ gỗ, con mèo vàng nằm cuộn bên chân, nồi đồng sôi sùng sục trên bếp than, ánh nắng chiều len qua khe cửa tạo vệt sáng vàng trên sàn đất".
   - Mục đích: Tạo video có chiều sâu, sinh động, giàu chi tiết như phim hoạt hình chuyên nghiệp.
            `;
            // ĐỘT PHÁ TỐI ƯU CHO VIDEO DÀI (>10P): Không gửi lại video thô ở bước chi tiết cảnh quay.
            // Model đã có đầy đủ thông tin từ Dàn ý (Outline) và Bản phân bổ cảnh (Blueprint) dạng văn bản.
            const chunkContents = prompt;
            
            let chunkData: GeminiAnalysisResponse | null = null;
            if (signal?.aborted) throw new DOMException('Phân tích đã bị dừng', 'AbortError');
            
            // Retry tại chỗ: batch PHẢI thành công mới sang batch tiếp theo (đảm bảo thứ tự)
            const MAX_BATCH_RETRIES = 2;
            let batchSuccess = false;
            for (let retryAttempt = 0; retryAttempt <= MAX_BATCH_RETRIES; retryAttempt++) {
                if (signal?.aborted) throw new DOMException('Phân tích đã bị dừng', 'AbortError');
                if (retryAttempt > 0) {
                    const retryDelay = retryAttempt * 8000;
                    console.log(`[Analysis] 🔄 Retry batch ${i+1} lần ${retryAttempt}/${MAX_BATCH_RETRIES}, chờ ${retryDelay}ms...`);
                    updateStep(7, StepStatus.PROCESSING, `🔄 Đợt ${i+1}/${numParts} lỗi, thử lại lần ${retryAttempt}/${MAX_BATCH_RETRIES}...`);
                    await sleep(retryDelay);
                }
                try {
                    chunkData = await generateAndParseJsonWithRetry<GeminiAnalysisResponse>(
                        modelId, 
                        chunkContents,
                        responseSchema, 3, 
                        (attempt, delay, reason) => {
                            updateStep(7, StepStatus.PROCESSING, `Đợt ${i+1}/${numParts} (Cảnh ${startSceneIdx}-${endSceneIdx}): Thử lại lần ${attempt} do ${reason}...`);
                        },
                        signal
                    );
                    if (chunkData && Array.isArray(chunkData.scenes) && chunkData.scenes.length > 0) {
                        batchSuccess = true;
                        break;
                    } else {
                        console.warn(`[Analysis] Batch ${i+1} retry ${retryAttempt}: trả về 0 cảnh, thử lại...`);
                    }
                } catch (batchErr: any) {
                    if (batchErr?.name === 'AbortError') throw batchErr;
                    console.error(`[Analysis] ❌ Batch ${i+1}/${numParts} retry ${retryAttempt}: ${batchErr.message}`);
                    if (retryAttempt === MAX_BATCH_RETRIES) {
                        throw new Error(`Batch ${i+1} (Cảnh ${startSceneIdx}-${endSceneIdx}) thất bại sau ${MAX_BATCH_RETRIES + 1} lần thử: ${batchErr.message}`);
                    }
                }
            }

            if (batchSuccess && chunkData) {
                // Defensive: đảm bảo scenes luôn là array hợp lệ
                if (!Array.isArray(chunkData.scenes)) {
                    console.warn(`[runAnalysis] Batch ${i+1} returned invalid scenes (type: ${typeof chunkData.scenes}), defaulting to [].`);
                    chunkData.scenes = [];
                }
                
                // Sắp xếp nội bộ batch theo scene_id thô của AI
                chunkData.scenes.sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0));

                // Ép scene_id chính xác theo phân đoạn kịch bản
                chunkData.scenes.forEach((s, idx) => {
                    s.scene_id = startSceneIdx + idx;
                });

                // Log chi tiết số cảnh nhận được vs yêu cầu
                const received = chunkData.scenes.length;
                console.log(`[Analysis] Batch ${i+1}/${numParts}: Yêu cầu ${currentBatchSize} cảnh, nhận ${received} cảnh`);
                if (received < currentBatchSize) {
                    console.warn(`[Analysis] ⚠️ Batch ${i+1}: AI trả thiếu ${currentBatchSize - received} cảnh (${received}/${currentBatchSize})`);
                }

                if (!finalJson) {
                    finalJson = {
                        video_meta: chunkData.video_meta || {
                            url: metadata.videoId ? `https://www.youtube.com/watch?v=${metadata.videoId}` : '',
                            title: metadata.title || 'Untitled',
                            duration_sec: targetDurationSeconds,
                            audio_mode: audioMode === 'auto' ? 'dialogue' : audioMode,
                            style: { mood: '', palette: [], music: '' }
                        },
                        scenes: [],
                        assets: chunkData.assets || [],
                        character_profile: imageCharacterProfile || chunkData.character_profile || { id: '[CHAR_V1]', description: '', physical_traits: [] },
                        style_profile: imageStyleProfile || chunkData.style_profile || { medium: getStyleLabel(style), lighting: '', color_grading: '', lens_film: '', environment_materials: '', style_tags: [] }
                    };
                    
                    finalJson.video_meta.title = storyOutline.title || finalJson.video_meta.title || metadata.title;
                    finalJson.video_meta.duration_sec = targetDurationSeconds;
                    if (!isAutoMode) {
                        finalJson.video_meta.audio_mode = audioMode as AudioMode;
                    }
                    if (imageSampleVideoPrompt) {
                        finalJson.sample_video_prompt = imageSampleVideoPrompt;
                    }
                }

                if (chunkData.scenes.length > 0) {
                    finalJson.scenes.push(...chunkData.scenes);
                    accumulatedScenes.push(...chunkData.scenes);
                }

                chunkData.assets?.forEach(a => {
                    if (a.id) allAssets.set(a.id, a);
                });
            }
        }


        if (!finalJson || !Array.isArray(finalJson.scenes) || !finalJson.scenes.length) {
            throw new Error("AI không trả về kết quả phân tích cảnh. Vui lòng thử lại.");
        }
        // Log nếu thiếu cảnh nhưng vẫn tiếp tục (không throw)
        if (finalJson.scenes.length < targetScenes) {
            console.warn(`[Analysis] ⚠️ Thiếu cảnh: có ${finalJson.scenes.length}/${targetScenes} cảnh. Một số batch bị lỗi.`);
            updateStep(7, StepStatus.PROCESSING, `⚠️ Có ${finalJson.scenes.length}/${targetScenes} cảnh (một số batch lỗi). Đang hoàn thiện...`);
        }

        finalJson.assets = Array.from(allAssets.values());
        finalJson.story_outline = storyOutline;
        
        // ── POST-PROCESSING: Fix timestamps (trùng lặp, gap, overflow) ──
        
        // Sort scenes by scene_id (số thứ tự cốt truyện) thay vì t0 (dễ bị AI hallucinate nhảy cóc)
        finalJson.scenes.sort((a, b) => (a.scene_id || 0) - (b.scene_id || 0));
        
        // Luôn phân bổ lại timestamps tuần tự để loại bỏ hoàn toàn lỗi nhảy cóc thời gian (Timeline Jump Error)
        finalJson.scenes.forEach((s, idx) => {
            s.t0 = formatTime(idx * density);
            s.t1 = formatTime(Math.min((idx + 1) * density, targetDurationSeconds));
        });
        
        // Loại bỏ cảnh bắt đầu sau targetDuration
        finalJson.scenes = finalJson.scenes.filter(s => {
            const startSec = parseTimestamp(s.t0);
            return startSec < targetDurationSeconds;
        });
        
        // Re-assign scene IDs liên tục từ 1
        finalJson.scenes.forEach((s, idx) => s.scene_id = idx + 1);
        
        // Chuẩn hoá và đồng nhất tên nhân vật ở chế độ Remix
        finalJson.scenes = normalizeRemixCharacterNames(finalJson.scenes, storyOutline.characters as any);
        
        console.log(`[runAnalysis] Final: ${finalJson.scenes.length} scenes, target=${formatTime(targetDurationSeconds)}, actual last t1=${finalJson.scenes[finalJson.scenes.length - 1]?.t1 || 'N/A'}`);

        console.log("[runAnalysis] Calling updateStep 6 COMPLETE");
        try {
            updateStep(7, StepStatus.COMPLETE, `Đã tạo tổng cộng ${finalJson.scenes.length} cảnh quay chi tiết.`);
        } catch (e) {
            console.error("Error in updateStep 6:", e);
        }
        
        console.log("[runAnalysis] Calling updateStep 7 COMPLETE");
        try {
            updateStep(8, StepStatus.COMPLETE, JSON.stringify(finalJson, null, 2));
        } catch (e) {
            console.error("Error in updateStep 7:", e);
        }
        
        console.log("[runAnalysis] Calling updateStep 8 COMPLETE");
        try {
            updateStep(9, StepStatus.COMPLETE, "Tất cả kịch bản và prompt đã sẵn sàng.");
        } catch (e) {
            console.error("Error in updateStep 8:", e);
        }
        
        console.log("[runAnalysis] Calling onComplete");
        try {
            onComplete(finalJson);
        } catch (e) {
            console.error("Error in onComplete:", e);
            throw e; // Rethrow to be caught by the outer catch block
        }

    } catch (error) {
        console.error(error);
        const errStep = currentState.currentStep;
        updateStep(errStep, StepStatus.ERROR, null, getErrorMessage(error));
        throw error;
    }
};
