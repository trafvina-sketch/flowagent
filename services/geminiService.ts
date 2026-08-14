
import { GoogleGenAI, Chat, Type } from "@google/genai";
import { fetchVideoMetadata } from './youtubeService';
import { getActiveApiKey, rotateApiKey, withKeyModelRetry } from './apiKeyService';
import { isProxyEnabled, startProxyChat, sendProxyChatMessage, withProxyRetry, proxyFetchCompletion } from './openaiProxyService';

let chat: Chat | null = null;

const getAIInstance = (forceNewKey = false) => {
    const apiKey = forceNewKey ? rotateApiKey() : getActiveApiKey();
    if (!apiKey) {
        throw new Error("Vui lòng cấu hình Gemini API Key hoặc Advanced Proxy API Key trong phần Cài đặt.");
    }
    return new GoogleGenAI({ apiKey });
};

export const startChat = (context: string, modelId: string = 'gemini-2.5-flash', languageName: string = 'Tiếng Việt') => {
    if (isProxyEnabled()) {
        try {
            startProxyChat(context, languageName);
        } catch (e) {
            console.error("Error starting proxy chat:", e);
        }
        return;
    }
    try {
        const ai = getAIInstance();
        chat = ai.chats.create({
            model: modelId,
            config: {
                systemInstruction: `Bạn là một trợ lý AI hữu ích. Nhiệm vụ của bạn là trả lời các câu hỏi về một video đã được phân tích. Đây là bản phân tích video ở định dạng JSON:\n\n${context}\n\nDựa vào thông tin này, hãy trả lời câu hỏi của người dùng một cách ngắn gọn và chính xác bằng tiếng ${languageName}.`,
            },
        });
    } catch (e) {
        console.error("Error starting chat:", e);
    }
};

export const sendChatMessage = async (message: string): Promise<string> => {
    if (isProxyEnabled()) {
        return sendProxyChatMessage(message);
    }
    if (!chat) {
        throw new Error("Chat not initialized. Call startChat first.");
    }
    
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
        try {
            const response = await chat.sendMessage({ message });
            return response.text;
        } catch (error: any) {
            console.error(`Error sending chat message (attempt ${retryCount + 1}):`, error);
            const msg = error?.message?.toLowerCase() || '';
            if (msg.includes('quota') || msg.includes('429')) {
                if (retryCount < maxRetries) {
                    console.log("Quota exceeded, rotating API key and retrying chat...");
                    rotateApiKey();
                    retryCount++;
                    continue;
                }
                throw new Error("Hết hạn mức API trên tất cả các key. Vui lòng thêm key mới.");
            }
            throw new Error("Không thể gửi tin nhắn đến AI. Vui lòng thử lại.");
        }
    }
    throw new Error("Không thể gửi tin nhắn đến AI sau nhiều lần thử.");
};


export const generateStoryIdeas = async (videoUrl: string, modelId: string = 'gemini-2.5-flash', languageName: string = 'Tiếng Việt'): Promise<string[]> => {
    let metadata;
    try {
        metadata = await fetchVideoMetadata(videoUrl);
        if (!metadata || !metadata.videoId) {
            throw new Error("Không thể lấy siêu dữ liệu video để tạo gợi ý.");
        }
    } catch (metaError) {
         console.error("Error fetching video metadata for story ideas:", metaError);
         throw new Error("Không thể lấy siêu dữ liệu video để tạo gợi ý.");
    }

    const prompt = `Dựa trên video có tiêu đề "${metadata.title}", hãy đề xuất 3 ý tưởng ngắn gọn, trong một câu cho một cuộc phiêu lưu hoặc câu chuyện hoàn toàn mới có các nhân vật chính. Chỉ trả về một mảng chuỗi JSON hợp lệ bằng tiếng ${languageName}.`;
    
    if (isProxyEnabled()) {
        const proxyApiCall = async (currentModel: string): Promise<string[]> => {
            const messages = [{ role: 'user', content: prompt }];
            const text = await proxyFetchCompletion(messages, currentModel, true);
            const sanitized = text.trim();
            const jsonStart = sanitized.indexOf('[');
            const jsonEnd = sanitized.lastIndexOf(']') + 1;
            if (jsonStart === -1 || jsonEnd === 0) {
                throw new Error("Không nhận được JSON Array hợp lệ từ Proxy.");
            }
            const ideas = JSON.parse(sanitized.slice(jsonStart, jsonEnd));
            if (Array.isArray(ideas) && ideas.every(item => typeof item === 'string')) {
                return ideas;
            }
            throw new Error("Phản hồi AI không phải là một mảng chuỗi hợp lệ.");
        };
        return withProxyRetry(proxyApiCall, 3, 'generateStoryIdeas (Proxy)');
    }

    const apiCall = async (key: string, model: string): Promise<string[]> => {
        const ai = new GoogleGenAI({ apiKey: key });
        
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                },
            },
        });
        
        const jsonString = response.text;
        const ideas = JSON.parse(jsonString);
        
        if (Array.isArray(ideas) && ideas.every(item => typeof item === 'string')) {
            return ideas;
        } else {
            throw new Error("Phản hồi AI không phải là một mảng chuỗi hợp lệ.");
        }
    };

    return withKeyModelRetry(apiCall, modelId, 3, 1500, 'generateStoryIdeas');
};
