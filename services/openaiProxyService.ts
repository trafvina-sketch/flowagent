
/**
 * OpenAI-Compatible Proxy Service
 * ─────────────────────────────────
 * Hỗ trợ xoay vòng (round-robin) tất cả các models qua một proxy server
 * tương thích OpenAI API (ví dụ: http://127.0.0.1:8045/v1)
 */

const PROXY_STORAGE_KEY = 'advanced_api_proxy';

export interface ProxyConfig {
    baseUrl: string;
    apiKey: string;
    enabled: boolean;
}

export const PROXY_MODELS = [
    // ── Gemini 3.x/3.5 ưu tiên ──
    { id: 'gemini-3-flash',               name: 'Gemini 3 Flash',                 description: 'Flash Preview' },
    { id: 'gemini-3-flash-agent',         name: 'Gemini 3.5 Flash (High)',        description: 'Flash Agent' },
    { id: 'gemini-pro-agent',             name: 'Gemini 3.1 Pro (High)',          description: 'Best Reasoning' },
    { id: 'gemini-3.1-pro-low',           name: 'Gemini 3.1 Pro (Low)',           description: 'Lite & Fast' },
    { id: 'gemini-3.1-flash-lite',        name: 'Gemini 3.1 Flash Lite',          description: 'Fast & Cheap' },
    { id: 'gemini-3.5-flash-low',         name: 'Gemini 3.5 Flash (Medium)',      description: 'Medium Cheap' },
    { id: 'gemini-3.5-flash-extra-low',   name: 'Gemini 3.5 Flash (Low)',         description: 'Ultra Cheap' },
    // ── Gemini 2.5 (legacy) ──
    { id: 'gemini-2.5-flash',             name: 'Gemini 2.5 Flash',               description: 'Standard' },
    { id: 'gemini-2.5-flash-lite',        name: 'Gemini 2.5 Flash Lite',          description: 'Lite & Fast' },
    { id: 'gemini-2.5-pro',               name: 'Gemini 2.5 Pro',                 description: 'Legacy Pro' },
    // ── Claude fallback ──
    { id: 'claude-opus-4-6-thinking',     name: 'Claude Opus 4.6 (Thinking)',     description: 'Claude Reasoning' },
];

let roundRobinIndex = 0;

// ═══════════════════════════════════════════════════════
// Configuration (localStorage)
// ═══════════════════════════════════════════════════════

export function getProxyConfig(): ProxyConfig {
    const stored = localStorage.getItem(PROXY_STORAGE_KEY);
    if (!stored) {
        return { baseUrl: 'http://127.0.0.1:8045/v1', apiKey: '', enabled: false };
    }
    try {
        return JSON.parse(stored);
    } catch {
        return { baseUrl: 'http://127.0.0.1:8045/v1', apiKey: '', enabled: false };
    }
}

export function saveProxyConfig(config: ProxyConfig): void {
    localStorage.setItem(PROXY_STORAGE_KEY, JSON.stringify(config));
}

export function isProxyEnabled(): boolean {
    const config = getProxyConfig();
    const hasProxyKey = !!config.apiKey;
    
    // Đọc trạng thái Gemini API Key từ localStorage và biến môi trường
    const hasGemini = (() => {
        const stored = localStorage.getItem('gemini_api_keys');
        if (!stored) {
            // Kiểm tra biến môi trường node.js (nếu chạy trong Electron Node context)
            const envKey = (typeof process !== 'undefined' && process.env) 
                ? (process.env.GEMINI_API_KEY || process.env.API_KEY) 
                : null;
            return !!envKey;
        }
        try {
            const keys = JSON.parse(stored);
            return Array.isArray(keys) && keys.length > 0 && keys.some((k: any) => k && !!k.key);
        } catch {
            return false;
        }
    })();

    // TRƯỜNG HỢP 1: Người dùng chủ động "Tích chọn bật Proxy" và đã điền Proxy API Key
    // => Tôn trọng tuyệt đối lựa chọn thủ công, ép buộc chạy luồng Proxy
    if (config.enabled && hasProxyKey) {
        return true;
    }

    // TRƯỜNG HỢP 2: Người dùng KHÔNG tích chọn bật Proxy (hoặc để tắt)
    // - Nếu có Gemini API Key hợp lệ trong cài đặt => Chạy luồng Gemini trực tiếp
    if (hasGemini) {
        return false;
    }

    // - Nếu KHÔNG CÓ Gemini API Key, nhưng lại có điền Proxy API Key
    // => Tự động fallback thông minh sang luồng Proxy để đảm bảo tất cả đều sử dụng được
    if (hasProxyKey) {
        console.log("ℹ️ [System] Không tìm thấy Gemini API Key. Tự động chuyển sang sử dụng Proxy API Key.");
        return true;
    }

    // Mặc định trả về false (luồng Gemini direct sẽ báo lỗi thiếu cả 2 loại key)
    return false;
}

// ═══════════════════════════════════════════════════════
// Round-Robin Model Rotation
// ═══════════════════════════════════════════════════════

export function getNextProxyModel(): string {
    const model = PROXY_MODELS[roundRobinIndex % PROXY_MODELS.length];
    roundRobinIndex = (roundRobinIndex + 1) % PROXY_MODELS.length;
    return model.id;
}

export function peekCurrentProxyModel(): { index: number; model: typeof PROXY_MODELS[0] } {
    return { index: roundRobinIndex % PROXY_MODELS.length, model: PROXY_MODELS[roundRobinIndex % PROXY_MODELS.length] };
}

export function resetRoundRobin(): void {
    roundRobinIndex = 0;
}

// ═══════════════════════════════════════════════════════
// Core API Call (fetch-based, no npm dependency needed)
// ═══════════════════════════════════════════════════════

export async function proxyFetchCompletion(
    messages: Array<{ role: string; content: any }>,
    model: string,
    jsonMode: boolean = false,
    signal?: AbortSignal,
    responseSchema?: any,  // Schema để ép AI trả đúng cấu trúc (giống Gemini SDK)
    rawGeminiParts?: any[] // Raw Gemini parts (giữ fileData video URI) — ưu tiên hơn messages
): Promise<string> {
    const config = getProxyConfig();
    if (!config.apiKey) throw new Error('API Key nâng cao chưa được cấu hình.');

    // ── Lấy base endpoint (bỏ /v1 nếu có) ──
    let baseEndpoint = config.baseUrl.replace(/\/+$/, '');
    if (baseEndpoint.endsWith('/v1')) {
        baseEndpoint = baseEndpoint.slice(0, -3);
    }

    // ── Ghép messages thành 1 prompt text (cho fallback OpenAI) ──
    const textContent = messages.map(m => {
        const role = m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${role}: ${content}`;
    }).join('\n\n');

    // ══════════════════════════════════════════════════
    // CHIẾN LƯỢC 1: Gemini Native REST API (ưu tiên)
    // Truyền rawGeminiParts (giữ fileData video) + responseSchema
    // ══════════════════════════════════════════════════
    const geminiUrl = `${baseEndpoint}/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    
    // Nếu có rawGeminiParts (chứa fileData video URI) → dùng trực tiếp
    // Nếu không → convert messages thành text parts
    const geminiParts = rawGeminiParts && rawGeminiParts.length > 0
        ? rawGeminiParts
        : [{ text: textContent }];
    
    const geminiBody: any = {
        contents: [{ parts: geminiParts }],
        generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 32768,
        },
    };
    if (jsonMode) {
        geminiBody.generationConfig.responseMimeType = 'application/json';
    }
    // Truyền responseSchema để ép cấu trúc JSON (giống Gemini SDK trực tiếp)
    if (responseSchema) {
        geminiBody.generationConfig.responseSchema = responseSchema;
    }

    console.log(`🔄 [Proxy] Model: ${model} | Gemini native (parts: ${geminiParts.length}, hasVideo: ${geminiParts.some((p: any) => p.fileData)})`);


    try {
        const geminiRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
                'x-goog-api-key': config.apiKey,
            },
            body: JSON.stringify(geminiBody),
            signal,
        });

        if (geminiRes.ok) {
            const data = await geminiRes.json();
            if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                const text = data.candidates[0].content.parts[0].text;
                console.log(`✅ [Proxy] Model: ${model} | Gemini native OK (${text.length} chars)`);
                return text;
            }
            if (data?.error) {
                throw new Error(data.error.message || JSON.stringify(data.error));
            }
            throw new Error(`Gemini unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
        }

        // Gemini native thất bại → log và thử fallback OpenAI
        const geminiErr = await geminiRes.json().catch(() => ({}));
        console.warn(`⚠️ [Proxy] Gemini native ${geminiRes.status}: ${geminiErr?.error?.message || geminiRes.statusText}. Fallback OpenAI...`);
    } catch (err: any) {
        // Network error (ECONNREFUSED, etc.) → try OpenAI format
        if (err.name === 'AbortError') throw err;
        console.warn(`⚠️ [Proxy] Gemini native error: ${err.message}. Fallback OpenAI...`);
    }

    // ══════════════════════════════════════════════════
    // CHIẾN LƯỢC 2: OpenAI Compatible (fallback)
    // ══════════════════════════════════════════════════
    const openaiUrl = `${baseEndpoint}/v1/chat/completions`;
    const openaiBody: any = { model, messages };
    if (jsonMode) {
        openaiBody.response_format = { type: 'json_object' };
    }
    // Truyền safety_settings tường minh để proxy không inject mặc định
    openaiBody.safety_settings = [
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
    ];
    openaiBody.extra_body = { safety_settings: openaiBody.safety_settings };

    console.log(`🔄 [Proxy] Model: ${model} | Fallback OpenAI: ${openaiUrl}`);

    const response = await fetch(openaiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
            'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify(openaiBody),
        signal,
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error?.message || response.statusText;
        throw new Error(`${response.status}: ${errMsg}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty proxy response');

    console.log(`✅ [Proxy] Model: ${model} | OpenAI OK (${text.length} chars)`);
    return text;
}

// ═══════════════════════════════════════════════════════
// Retry with Round-Robin Model Rotation
// ═══════════════════════════════════════════════════════

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function withProxyRetry<T>(
    fn: (model: string) => Promise<T>,
    retries = 3,
    context = 'Proxy call',
    onRetry?: (attempt: number, delay: number, error: any) => void
): Promise<T> {
    let lastError: unknown;
    const maxAttempts = Math.min(retries * PROXY_MODELS.length, retries * 6);
    let consecutiveAuthErrors = 0; // Track 401/403 liên tiếp
    
    // Reset về đầu danh sách mỗi lần phân tích mới
    roundRobinIndex = 0;

    for (let i = 0; i < maxAttempts; i++) {
        const model = getNextProxyModel();
        try {
            const result = await fn(model);
            consecutiveAuthErrors = 0; // Reset khi thành công
            return result;
        } catch (error) {
            lastError = error;
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Abort — không retry
            if (error instanceof DOMException && error.name === 'AbortError') throw error;

            console.warn(`[Proxy] ${context} attempt ${i + 1}/${maxAttempts} failed (${model}): ${errorMsg}`);
            if (onRetry) onRetry(i + 1, 2000, error);

            // ── 401/403 Auth Error → đếm liên tiếp, nếu >= 2 model khác nhau đều 401 → dừng ──
            const lowerMsg = errorMsg.toLowerCase();
            if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('403') || lowerMsg.includes('api key not valid')) {
                consecutiveAuthErrors++;
                if (consecutiveAuthErrors >= 3) {
                    console.error(`[Proxy] ${consecutiveAuthErrors} auth errors lien tiep. API Key proxy sai/het han. Dung retry.`);
                    throw new Error(`401: Unauthorized - Proxy API Key khong hop le (${consecutiveAuthErrors} models deu loi)`);
                }
                await sleep(500); // Chờ rất ngắn rồi thử model khác
                continue;
            }
            consecutiveAuthErrors = 0; // Reset nếu lỗi khác (không phải auth)

            // ── Smart skip: Lỗi 400 safety_settings → chuyển model ngay ──
            if (lowerMsg.includes('400') && lowerMsg.includes('safety_settings')) {
                console.log(`[Proxy] Model ${model} bi loi safety_settings. Chuyen model tiep...`);
                if (model.startsWith('gemini')) {
                    roundRobinIndex = PROXY_MODELS.length - 1;
                    console.log(`[Proxy] Gemini bi loi safety -> chuyen sang Claude fallback`);
                }
                await sleep(500);
                continue;
            }

            if (lowerMsg.includes('429') || lowerMsg.includes('quota') || lowerMsg.includes('too many requests') || lowerMsg.includes('limit')) {
                const waitTime = 12000 + Math.random() * 4000;
                console.log(`[Proxy] Rate Limit (429). Doi ${Math.round(waitTime/1000)}s...`);
                await sleep(waitTime);
            } else if (lowerMsg.includes('503') || lowerMsg.includes('overload') || lowerMsg.includes('unavailable')) {
                await sleep(5000 + Math.random() * 2000);
            } else if (lowerMsg.includes('404')) {
                console.log(`[Proxy] Model ${model} khong ton tai (404). Chuyen model tiep...`);
                await sleep(500);
            } else {
                await sleep(2000 + Math.random() * 1000);
            }
        }
    }

    throw lastError;
}

// ═══════════════════════════════════════════════════════
// Chat Support (proxy)
// ═══════════════════════════════════════════════════════

let proxyConversation: Array<{ role: string; content: string }> = [];

export function startProxyChat(context: string, languageName: string = 'Tiếng Việt') {
    proxyConversation = [
        {
            role: 'system',
            content: `Bạn là một trợ lý AI hữu ích. Nhiệm vụ của bạn là trả lời các câu hỏi về một video đã được phân tích. Đây là bản phân tích video ở định dạng JSON:\n\n${context}\n\nDựa vào thông tin này, hãy trả lời câu hỏi của người dùng một cách ngắn gọn và chính xác bằng tiếng ${languageName}.`,
        },
    ];
}

export async function sendProxyChatMessage(message: string): Promise<string> {
    proxyConversation.push({ role: 'user', content: message });
    const model = getNextProxyModel();

    try {
        const text = await proxyFetchCompletion(proxyConversation, model, false);
        proxyConversation.push({ role: 'assistant', content: text });
        return text;
    } catch (error) {
        // Retry once with next model
        const nextModel = getNextProxyModel();
        const text = await proxyFetchCompletion(proxyConversation, nextModel, false);
        proxyConversation.push({ role: 'assistant', content: text });
        return text;
    }
}
