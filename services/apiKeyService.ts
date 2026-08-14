
const STORAGE_KEY = 'gemini_api_keys';
const CURRENT_INDEX_KEY = 'gemini_api_key_index';
import { isProxyEnabled } from './openaiProxyService';

export interface ApiKeyInfo {
    key: string;
    label: string;
    isDefault?: boolean;
}

// --- Key State Tracking (in-memory, not persisted) ---
interface KeyState {
    key: string;
    exhaustedModels: Map<string, number>; // model → timestamp exhausted
    failCount: number;
    isInvalid: boolean; // permanently bad key (leaked/wrong)
}

let keyStates: KeyState[] = [];
let currentKeyIdx = 0;
const KEY_COOLDOWN_MS = 65_000; // 65 seconds - wait for quota reset

// Available models for fallback rotation (thứ tự ưu tiên)
const GEMINI_MODELS = [
    'gemini-2.5-flash',          // Ổn định nhất, nhanh
    'gemini-2.5-pro',            // Mạnh nhất
    'gemini-2.5-flash-lite',     // Nhẹ, nhanh
    'gemini-2.0-flash',          // Legacy ổn định
    'gemini-2.5-flash-preview-05-20', // Preview mới nhất
];

// Track current model index PER KEY for round-robin within each key
let modelIndexPerKey: Map<string, number> = new Map();

// --- Basic Key Management (localStorage) ---
export const getApiKeys = (): ApiKeyInfo[] => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
        const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
        if (envKey) {
            return [{ key: envKey, label: 'Default Key', isDefault: true }];
        }
        return [];
    }
    try {
        return JSON.parse(stored);
    } catch (e) {
        console.error('Error parsing API keys from localStorage', e);
        return [];
    }
};

export const saveApiKeys = (keys: ApiKeyInfo[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    // Sync key states when keys change
    syncKeyStates();
};

export const getCurrentKeyIndex = (): number => {
    const index = localStorage.getItem(CURRENT_INDEX_KEY);
    return index ? parseInt(index, 10) : 0;
};

export const setCurrentKeyIndex = (index: number) => {
    localStorage.setItem(CURRENT_INDEX_KEY, index.toString());
    currentKeyIdx = index;
};

export const getActiveApiKey = (): string | null => {
    if (isProxyEnabled()) return 'proxy_enabled';
    const keys = getApiKeys();
    if (keys.length === 0) return null;
    
    let index = getCurrentKeyIndex();
    if (index >= keys.length) {
        index = 0;
        setCurrentKeyIndex(0);
    }
    
    return keys[index].key;
};

// Simple key rotation (legacy - for UI manual switch)
export const rotateApiKey = (): string | null => {
    if (isProxyEnabled()) return 'proxy_enabled';
    const keys = getApiKeys();
    if (keys.length <= 1) return getActiveApiKey();
    
    let index = getCurrentKeyIndex();
    index = (index + 1) % keys.length;
    setCurrentKeyIndex(index);
    
    console.log(`🔄 Rotated to API key at index ${index}: ${keys[index].label}`);
    return keys[index].key;
};

export const addApiKey = (key: string, label: string) => {
    const keys = getApiKeys();
    if (keys.some(k => k.key === key)) return;
    keys.push({ key, label });
    saveApiKeys(keys);
};

export const removeApiKey = (index: number) => {
    const keys = getApiKeys();
    const currentIdx = getCurrentKeyIndex();
    
    keys.splice(index, 1);
    saveApiKeys(keys);
    
    if (currentIdx >= keys.length) {
        setCurrentKeyIndex(Math.max(0, keys.length - 1));
    }
};

// --- Advanced Key+Model Rotation (Closed-loop: exhaust all models per key first) ---

// Sync in-memory states with localStorage keys
function syncKeyStates() {
    const keys = getApiKeys();
    const existingMap = new Map(keyStates.map(s => [s.key, s]));
    
    keyStates = keys.map(k => existingMap.get(k.key) || {
        key: k.key,
        exhaustedModels: new Map(),
        failCount: 0,
        isInvalid: false,
    });
    
    if (currentKeyIdx >= keyStates.length) currentKeyIdx = 0;
}

// Check if a model on a key has recovered after cooldown
function isModelRecovered(state: KeyState, model: string): boolean {
    const exhaustedAt = state.exhaustedModels.get(model);
    if (!exhaustedAt) return true;
    if (Date.now() - exhaustedAt > KEY_COOLDOWN_MS) {
        state.exhaustedModels.delete(model);
        return true;
    }
    return false;
}

/**
 * XOAY VÒNG KHÓA ĐÓN (Closed-loop rotation):
 * 1. Bắt đầu với key hiện tại (currentKeyIdx)
 * 2. Thử TẤT CẢ models trong key đó (ưu tiên preferred model, rồi round-robin các model còn lại)
 * 3. Nếu TẤT CẢ models trong key đó đều exhausted → chuyển sang key tiếp theo
 * 4. Lặp lại cho tất cả keys
 * 5. Nếu tất cả keys + models đều exhausted → tìm combo sớm nhất recover
 */
export function getAvailableKeyAndModel(preferredModel?: string, forceGemini = false): { key: string; model: string } | null {
    if (!forceGemini && isProxyEnabled()) {
        return { key: 'proxy_enabled', model: preferredModel || 'gemini-2.5-flash' };
    }
    if (keyStates.length === 0) syncKeyStates();
    
    const totalKeys = keyStates.length;
    if (totalKeys === 0) {
        const envKey = process.env.API_KEY || '';
        if (!envKey) return null;
        return { key: envKey, model: preferredModel || GEMINI_MODELS[0] };
    }

    // Xây danh sách models: preferred model đầu tiên, sau đó round-robin
    const buildModelList = (keyValue: string): string[] => {
        const startIdx = modelIndexPerKey.get(keyValue) || 0;
        const models: string[] = [];
        
        // Ưu tiên preferred model trước
        if (preferredModel) {
            models.push(preferredModel);
        }
        
        // Sau đó xoay vòng các model khác bắt đầu từ vị trí hiện tại
        for (let j = 0; j < GEMINI_MODELS.length; j++) {
            const idx = (startIdx + j) % GEMINI_MODELS.length;
            const model = GEMINI_MODELS[idx];
            if (!models.includes(model)) {
                models.push(model);
            }
        }
        
        return models;
    };

    // Strategy: với MỖI key, thử TẤT CẢ models trước khi chuyển key
    for (let keyAttempt = 0; keyAttempt < totalKeys; keyAttempt++) {
        const keyIdx = (currentKeyIdx + keyAttempt) % totalKeys;
        const state = keyStates[keyIdx];
        
        if (state.isInvalid) continue;

        const modelsToTry = buildModelList(state.key);
        
        for (const model of modelsToTry) {
            if (isModelRecovered(state, model)) {
                currentKeyIdx = keyIdx;
                return { key: state.key, model };
            }
        }
        
        // Tất cả models trên key này đều exhausted → log và thử key tiếp theo
        console.log(`🔑 Key ...${state.key.slice(-6)}: tất cả ${state.exhaustedModels.size} models đều exhausted, chuyển key tiếp...`);
    }
    
    // All exhausted - find soonest recovery
    let soonestRecovery = Infinity;
    let bestKey = keyStates.find(s => !s.isInvalid) || keyStates[0];
    let bestModel = preferredModel || GEMINI_MODELS[0];
    
    for (const state of keyStates) {
        if (state.isInvalid) continue;
        const modelsToTry = buildModelList(state.key);
        for (const model of modelsToTry) {
            const exhaustedAt = state.exhaustedModels.get(model) || 0;
            const recoversAt = exhaustedAt + KEY_COOLDOWN_MS;
            if (recoversAt < soonestRecovery) {
                soonestRecovery = recoversAt;
                bestKey = state;
                bestModel = model;
            }
        }
    }
    
    return { key: bestKey.key, model: bestModel };
}

// Mark a model on a key as exhausted (quota hit) + advance model index for this key
export function markModelExhausted(keyValue: string, model: string) {
    const state = keyStates.find(s => s.key === keyValue);
    if (state) {
        state.exhaustedModels.set(model, Date.now());
        state.failCount++;
        
        // Advance model index for this key → next call will start from next model
        const currentModelIdx = GEMINI_MODELS.indexOf(model);
        if (currentModelIdx >= 0) {
            modelIndexPerKey.set(keyValue, (currentModelIdx + 1) % GEMINI_MODELS.length);
        }
        
        console.warn(`⛔ Model "${model}" exhausted on key ...${keyValue.slice(-6)}. (${state.exhaustedModels.size}/${GEMINI_MODELS.length} models blocked)`);
        
        // Nếu tất cả models trên key này đều exhausted → tự động chuyển sang key tiếp theo
        const allModelsExhausted = GEMINI_MODELS.every(m => !isModelRecovered(state, m));
        if (allModelsExhausted) {
            const nextKeyIdx = (currentKeyIdx + 1) % keyStates.length;
            if (nextKeyIdx !== currentKeyIdx) {
                console.log(`🔄 Tất cả models trên key ...${keyValue.slice(-6)} đã hết quota. Chuyển sang key ...${keyStates[nextKeyIdx].key.slice(-6)}`);
                currentKeyIdx = nextKeyIdx;
            }
        }
    }
}

// Mark a key as permanently invalid (leaked/wrong)
export function markKeyInvalid(keyValue: string) {
    const state = keyStates.find(s => s.key === keyValue);
    if (state) {
        state.isInvalid = true;
        console.error(`🔒 Key ...${keyValue.slice(-6)} marked INVALID.`);
        
        // Tự động chuyển sang key tiếp theo
        const nextValidIdx = keyStates.findIndex((s, i) => i !== currentKeyIdx && !s.isInvalid);
        if (nextValidIdx >= 0) {
            currentKeyIdx = nextValidIdx;
            console.log(`🔄 Auto-switched to key ...${keyStates[nextValidIdx].key.slice(-6)}`);
        }
    }
}

// Get status for debugging
export function getKeyRotationStatus() {
    return {
        total: keyStates.length,
        active: keyStates.filter(s => !s.isInvalid).length,
        currentKey: currentKeyIdx,
        exhaustedModels: keyStates.reduce((sum, s) => sum + s.exhaustedModels.size, 0),
        modelIndices: Object.fromEntries(modelIndexPerKey),
    };
}

// --- Enhanced Retry with Key+Model Rotation (Closed-loop) ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function withKeyModelRetry<T>(
    fn: (key: string, model: string) => Promise<T>,
    preferredModel: string,
    retries = 4,
    initialDelay = 1500,
    context = 'API call',
    onRetry?: (attempt: number, delay: number, error: any) => void,
    forceGemini = true
): Promise<T> {
    if (keyStates.length === 0) syncKeyStates();
    
    let lastError: unknown;
    // Max attempts = retries × total possible key+model combos (capped)
    const totalCombos = Math.max(keyStates.length, 1) * GEMINI_MODELS.length;
    const maxAttempts = Math.min(retries * totalCombos, retries * 6);

    for (let i = 0; i < maxAttempts; i++) {
        const combo = getAvailableKeyAndModel(preferredModel, forceGemini);
        if (!combo) throw new Error("Vui lòng cấu hình Gemini API Key hoặc Advanced Proxy API Key trong phần Cài đặt.");

        try {
            return await fn(combo.key, combo.model);
        } catch (error) {
            lastError = error;
            
            let errorMessage = '';
            if (error instanceof Error) errorMessage = error.message;
            else { try { errorMessage = JSON.stringify(error); } catch { errorMessage = String(error); } }
            errorMessage = errorMessage.toLowerCase();

            // Permission/Invalid/Unauthorized → mark key invalid, try next
            if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('403') || errorMessage.includes('permission_denied') || errorMessage.includes('leaked') || errorMessage.includes('api key not valid')) {
                markKeyInvalid(combo.key);
                if (keyStates.filter(s => !s.isInvalid).length === 0) {
                    throw new Error("Tất cả API Key đều không hợp lệ.");
                }
                console.warn(`🔄 Key invalid, switching... (${keyStates.filter(s => !s.isInvalid).length} keys left)`);
                continue;
            }

            // Quota exhausted → mark this model on this key exhausted
            // Closed-loop: getAvailableKeyAndModel sẽ tự động thử model tiếp theo trong cùng key
            if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('resource_exhausted')) {
                markModelExhausted(combo.key, combo.model);
                
                const nextCombo = getAvailableKeyAndModel(preferredModel);
                if (nextCombo && (nextCombo.key !== combo.key || nextCombo.model !== combo.model)) {
                    const sameKey = nextCombo.key === combo.key ? '(cùng key)' : `(key ...${nextCombo.key.slice(-6)})`;
                    console.log(`🔄 Chuyển → model "${nextCombo.model}" ${sameKey}`);
                    if (onRetry) onRetry(i + 1, 2000, error);
                    await sleep(2000);
                    continue;
                } else {
                    const waitTime = KEY_COOLDOWN_MS;
                    console.warn(`⏳ Tất cả combos exhausted. Đợi ${waitTime/1000}s cho quota reset...`);
                    if (onRetry) onRetry(i + 1, waitTime, error);
                    await sleep(waitTime);
                    continue;
                }
            }

            // 400/404 → model incompatibility, try other model on same key first
            if (errorMessage.includes('400') || errorMessage.includes('invalid argument') || errorMessage.includes('bad request') || errorMessage.includes('404') || errorMessage.includes('not found')) {
                markModelExhausted(combo.key, combo.model);
                console.warn(`Model "${combo.model}" returned error on key ...${combo.key.slice(-6)}, trying next model on same key...`);
                await sleep(1000);
                continue;
            }

            // 503 Overloaded → rotate to different model (same strategy as 429 but shorter cooldown)
            if (errorMessage.includes('503') || errorMessage.includes('unavailable') || errorMessage.includes('overloaded') || errorMessage.includes('high demand')) {
                markModelExhausted(combo.key, combo.model);
                
                const nextCombo = getAvailableKeyAndModel(preferredModel);
                if (nextCombo && (nextCombo.key !== combo.key || nextCombo.model !== combo.model)) {
                    const sameKey = nextCombo.key === combo.key ? '(cùng key)' : `(key ...${nextCombo.key.slice(-6)})`;
                    console.log(`🔄 Model "${combo.model}" quá tải (503). Chuyển → "${nextCombo.model}" ${sameKey}`);
                    if (onRetry) onRetry(i + 1, 5000, error);
                    await sleep(5000 + Math.random() * 3000); // 5-8s wait before trying different model
                    continue;
                } else {
                    // All models overloaded → wait 15s then retry
                    const waitTime = 15000;
                    console.warn(`⏳ Tất cả models đều quá tải (503). Đợi ${waitTime/1000}s...`);
                    if (onRetry) onRetry(i + 1, waitTime, error);
                    await sleep(waitTime);
                    continue;
                }
            }

            // Other server errors → backoff retry
            const delay = initialDelay * (2 ** Math.min(i, 4));
            console.warn(`Attempt ${i + 1}/${maxAttempts} failed in ${context}. Retrying in ${delay}ms...`);
            if (onRetry) onRetry(i + 1, delay, error);
            await sleep(delay + Math.random() * 500);
        }
    }

    throw lastError;
}

