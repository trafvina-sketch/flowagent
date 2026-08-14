import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { VideoDetails, OptimizedSEO, Settings } from '../types';
import { imageUrlToBase64 } from "../utils/helpers";
import { isProxyEnabled, withProxyRetry, proxyFetchCompletion } from "../../../services/openaiProxyService";

const languageMap: { [key: string]: string } = {
  'vi': 'Tiếng Việt',
  'en': 'English',
  'es': 'Español',
  'fr': 'Français',
  'de': 'Deutsch',
  'ja': '日本語',
  'ko': '한국어',
};

// Response schema for structured SEO content
const seoResponseSchema = {
  type: Type.OBJECT,
  properties: {
    titles: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Danh sách 3-5 gợi ý tiêu đề tối ưu SEO, giữ nguyên ngôn ngữ gốc hoặc dịch sang ngôn ngữ yêu cầu. Tiêu đề hấp dẫn, chứa từ khóa chính."
    },
    description: {
      type: Type.STRING,
      description: "Đoạn mô tả video hoàn chỉnh. Cần chèn từ khóa chính tự nhiên đúng 5 lần. Chèn tên thương hiệu/kênh của người dùng. Viết tự nhiên, cuốn hút."
    },
    tags: {
      type: Type.STRING,
      description: "Chuỗi chứa các thẻ tags, phân tách nhau bằng dấu phẩy, viết thường. Phải bao gồm cả tên kênh và các từ khóa phụ liên quan."
    },
    hashtags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Danh sách 8-12 hashtags liên quan nhất (không bao gồm ký tự #)."
    },
    chapters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          timestamp: { type: Type.STRING, description: "Mốc thời gian dạng MM:SS hoặc HH:MM:SS." },
          title: { type: Type.STRING, description: "Tiêu đề ngắn gọn cho phần thời lượng này." }
        },
        required: ["timestamp", "title"]
      },
      description: "Danh sách các mốc chương video phân bổ thông minh từ 00:00 cho đến hết thời lượng mong muốn của người dùng."
    },
    shortsTitles: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Danh sách 2-3 gợi ý tiêu đề giật gân, siêu ngắn dưới 60 ký tự dành riêng cho YouTube Shorts."
    },
    cta: {
      type: Type.STRING,
      description: "Lời kêu gọi hành động (Call To Action) tinh tế để tăng lượt đăng ký hoặc click vào liên kết."
    }
  },
  required: ["titles", "description", "tags", "hashtags", "chapters", "shortsTitles", "cta"]
};

// Helper for executing a function with API Key rotation/cycling
const runWithKeyRotation = async <T>(
  apiKeys: string[],
  currentKeyIndex: number,
  saveKeyIndex: (index: number) => void,
  task: (ai: GoogleGenAI) => Promise<T>
): Promise<T> => {
  if (!apiKeys || apiKeys.length === 0) {
    throw new Error("Vui lòng cung cấp ít nhất một Gemini API Key trong phần Cài đặt.");
  }

  let attempt = 0;
  let lastError: Error | null = null;
  const startIndex = currentKeyIndex;

  while (attempt < apiKeys.length) {
    const keyIndex = (startIndex + attempt) % apiKeys.length;
    const currentKey = apiKeys[keyIndex];

    try {
      const ai = new GoogleGenAI({ apiKey: currentKey });
      const result = await task(ai);
      
      // Save working key index
      saveKeyIndex(keyIndex);
      return result;
    } catch (error: any) {
      console.warn(`Gemini API key at index ${keyIndex} failed: ${error.message || error}`);
      lastError = error instanceof Error ? error : new Error(String(error));

      const errorMessage = error.message || '';
      const isQuotaOrAuthError = 
        errorMessage.includes('API key not valid') || 
        errorMessage.includes('quota') || 
        errorMessage.includes('exceeded') || 
        errorMessage.includes('429') || 
        errorMessage.includes('RESOURCE_EXHAUSTED');

      if (isQuotaOrAuthError && apiKeys.length > 1) {
        attempt++; // Try next key
      } else {
        throw lastError; // Throw immediately if only one key or not a key issue
      }
    }
  }

  throw new Error(`Tất cả ${apiKeys.length} API key đều không hoạt động. Lỗi cuối cùng: ${lastError?.message}`);
};

/**
 * STEP 1: SEO Content Optimization
 */

// ── Hàm chuẩn hóa từ đồng nghĩa và khôi phục dữ liệu SEO an toàn dùng chung ──
const normalizeSEOData = (parsed: any): OptimizedSEO => {
  if (!parsed || typeof parsed !== 'object') {
    return {
      titles: [],
      description: '',
      tags: '',
      hashtags: [],
      chapters: [],
      shortsTitles: [],
      cta: ''
    };
  }

  // ── Khôi phục đồng nghĩa (Synonyms Mapping) thông minh cho titles ──
  let rawTitles = parsed.titles || parsed.title || parsed.seo_titles || parsed.video_titles || parsed.tieu_de || parsed.tieu_de_video || parsed.danh_sach_tieu_de || parsed.suggested_titles || [];
  if (typeof rawTitles === 'string') {
    rawTitles = rawTitles.split(/\n|,/).map((t: any) => t.trim()).filter(Boolean);
  }
  const titles = Array.isArray(rawTitles) ? rawTitles.filter(Boolean) : [];

  // ── Khôi phục đồng nghĩa cho description ──
  const description = parsed.description || parsed.desc || parsed.seo_description || parsed.mo_ta || parsed.mo_ta_video || parsed.content_description || '';

  // ── Khôi phục đồng nghĩa cho tags ──
  let rawTags = parsed.tags || parsed.tag || parsed.keywords || parsed.the_tags || parsed.tu_khoa || parsed.tu_khoa_video || '';
  if (Array.isArray(rawTags)) rawTags = rawTags.join(', ');
  const tags = typeof rawTags === 'string' ? rawTags : '';

  // ── Khôi phục đồng nghĩa cho hashtags ──
  let rawHashtags = parsed.hashtags || parsed.hashtag || parsed.hash_tags || parsed.danh_sach_hashtag || parsed.hash || [];
  if (typeof rawHashtags === 'string') {
    rawHashtags = rawHashtags.split(/[\s,]+/).map((h: any) => h.replace('#', '').trim()).filter(Boolean);
  }
  const hashtags = Array.isArray(rawHashtags) ? rawHashtags.map((h: any) => String(h).replace('#', '')).filter(Boolean) : [];

  // ── Khôi phục đồng nghĩa cho chapters ──
  let rawChapters = parsed.chapters || parsed.chapter || parsed.timestamps || parsed.timeline || parsed.chuong || parsed.danh_sach_chuong || parsed.moc_thoi_gian || parsed.timeline_events || [];
  const chapters = Array.isArray(rawChapters) 
    ? rawChapters.map((ch: any) => {
        const timestamp = ch?.timestamp || ch?.time || ch?.moc || ch?.t || '00:00';
        const title = ch?.title || ch?.name || ch?.tieu_de || ch?.noi_dung || 'Chương mới';
        return { timestamp, title };
      }).filter((ch: any) => ch.timestamp && ch.title)
    : [];

  // ── Khôi phục đồng nghĩa cho shortsTitles ──
  let rawShortsTitles = parsed.shortsTitles || parsed.shorts_titles || parsed.shorts || parsed.tieu_de_shorts || parsed.shorts_tieu_de || [];
  if (typeof rawShortsTitles === 'string') {
    rawShortsTitles = rawShortsTitles.split(/\n|,/).map((t: any) => t.trim()).filter(Boolean);
  }
  const shortsTitles = Array.isArray(rawShortsTitles) ? rawShortsTitles.filter(Boolean) : [];

  // ── Khôi phục đồng nghĩa cho cta ──
  const cta = parsed.cta || parsed.call_to_action || parsed.callToAction || parsed.keu_goi_hanh_dong || parsed.hanh_dong || '';

  return {
    titles,
    description,
    tags,
    hashtags,
    chapters,
    shortsTitles,
    cta
  };
};

export const optimizeSEOContent = async (
  videoDetails: VideoDetails,
  settings: Settings,
  currentKeyIndex: number,
  saveKeyIndex: (index: number) => void
): Promise<OptimizedSEO> => {
  const languageName = languageMap[settings.outputLanguage] || 'Tiếng Việt';
  const toneInstruction = settings.tone !== 'Mặc định' ? `- Giọng điệu chủ đạo: "${settings.tone}".` : '';
  const emojiInstruction = settings.includeEmojis 
    ? '- Thêm 1-3 emojis thú vị, biểu cảm vào phần mô tả và tiêu đề để thu hút sự chú ý.' 
    : '- Tuyệt đối KHÔNG sử dụng bất kỳ icon hay emojis nào.';

  const channelNameInstruction = settings.channelName.trim()
    ? `- Bạn BẮT BUỘC phải chèn tên kênh thương hiệu của tôi là "${settings.channelName}" vào trong các thẻ tags quan trọng và lồng ghép khéo léo vào phần mô tả để làm nổi bật thương hiệu.`
    : '';

  const durationInstruction = settings.videoDuration.trim()
    ? `- Tổng thời lượng video mới của tôi sẽ kéo dài tầm "${settings.videoDuration}". Hãy tạo bảng phân bổ mốc thời gian (Chapters) bắt đầu từ 00:00 cho đến sát thời lượng này. Các mốc thời gian phải được phân bố khoa học, dựa trên nội dung gốc của đối thủ để phác thảo các phần hợp lý.`
    : `- Tổng thời lượng video của đối thủ là "${videoDetails.duration}". Nếu không có yêu cầu đặc biệt, hãy tạo mốc thời gian dựa theo cấu trúc hoặc độ dài này.`;

  const prompt = `
Bạn là một chuyên gia tối ưu hóa SEO YouTube cao cấp hàng đầu. Nhiệm vụ của bạn là nhận thông tin phân tích thô từ một video đối thủ thành công và tái cấu trúc nó thành một bộ tài nguyên SEO tối ưu hoàn toàn cho video của tôi.

**Ngôn ngữ đầu ra bắt buộc:** ${languageName}

**Thông tin video đối thủ thu thập được:**
- Tiêu đề gốc: "${videoDetails.title}"
- Tên kênh đối thủ: "${videoDetails.channelTitle}"
- Mô tả gốc:
"""
${videoDetails.description}
"""
- Từ khóa tags gốc: ${videoDetails.tags.length > 0 ? videoDetails.tags.join(', ') : 'Không có'}
- Lượt xem hiện tại: ${new Intl.NumberFormat().format(parseInt(videoDetails.viewCount))} lượt
- Lượt thích: ${new Intl.NumberFormat().format(parseInt(videoDetails.likeCount))} lượt
- Thời lượng gốc: ${videoDetails.duration}
- Chủ đề video: ${videoDetails.videoTopics.join(', ') || 'Không xác định'}

**Yêu cầu và Cấu hình tối ưu từ tôi:**
${toneInstruction}
${emojiInstruction}
${channelNameInstruction}
${durationInstruction}

**Hướng dẫn chi tiết:**
1. **Từ khóa chính:** Hãy phân tích tiêu đề và mô tả đối thủ để suy ra 1 từ khóa chính giá trị nhất (bằng ngôn ngữ gốc hoặc dịch phù hợp).
2. **Tiêu đề:** Tạo 3-5 tiêu đề giật gân, cuốn hút, chứa từ khóa chính ở những từ đầu tiên.
3. **Mô tả:** Viết một đoạn mô tả hoàn chỉnh, hấp dẫn. BẮT BUỘC chứa từ khóa chính xuất hiện chính xác đúng 5 lần (không thừa không thiếu). Từ khóa chính phải lồng ghép mượt mà, không gượng ép. Có chèn tên kênh thương hiệu của tôi và chèn các vị trí link placeholder dạng [Liên kết đăng ký], [Liên kết mạng xã hội] v.v.
4. **Mốc thời gian (Chapters):** Tạo 4-8 chương hợp lý. Phải bắt đầu bằng mốc "00:00 - Giới thiệu". Thời lượng phải khớp với hướng dẫn ở trên.
5. **Hashtags:** Cung cấp danh sách 8-12 hashtag liên quan, hashtag đầu tiên phải là từ khóa chính dạng viết liền không dấu.
6. **Thẻ Tags:** Tạo chuỗi tags viết thường cách nhau bằng dấu phẩy. Hãy đưa tên kênh của tôi vào danh sách này.

**ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (MẪU JSON):**
Bạn BẮT BUỘC phải trả về một đối tượng JSON hợp lệ (không chứa markdown bọc ngoài nếu có thể, hoặc chỉ bọc trong khối \`\`\`json) với cấu trúc các key chính xác như sau:
{
  "titles": [
    "Tiêu đề gợi ý 1",
    "Tiêu đề gợi ý 2",
    "Tiêu đề gợi ý 3"
  ],
  "description": "Đoạn mô tả video hoàn chỉnh chuẩn SEO...",
  "tags": "từ khóa 1, từ khóa 2, từ khóa 3, ...",
  "hashtags": [
    "hashtag1",
    "hashtag2",
    "hashtag3"
  ],
  "chapters": [
    { "timestamp": "00:00", "title": "Giới thiệu" },
    { "timestamp": "01:30", "title": "Phần tiếp theo" }
  ],
  "shortsTitles": [
    "Tiêu đề Shorts 1",
    "Tiêu đề Shorts 2"
  ],
  "cta": "Lời kêu gọi hành động tinh tế..."
}

TUYỆT ĐỐI KHÔNG thêm bất kỳ chữ giải thích nào ngoài khối JSON. Hãy đảm bảo các key JSON chính xác như mẫu trên.
`;

  if (isProxyEnabled()) {
    const proxyApiCall = async (currentModel: string): Promise<OptimizedSEO> => {
      const messages = [{ role: 'user', content: prompt }];
      const text = await proxyFetchCompletion(messages, currentModel, true);
      console.log("=== KEYTUBE GEMINI PROXY RESPONSE ===", text);
      const sanitized = text.trim();
      const jsonStart = sanitized.indexOf('{');
      const jsonEnd = sanitized.lastIndexOf('}') + 1;
      if (jsonStart === -1 || jsonEnd === 0) {
        throw new Error("Không nhận được JSON hợp lệ từ Proxy.");
      }
      
      const parsed = JSON.parse(sanitized.slice(jsonStart, jsonEnd));
      console.log("=== KEYTUBE PARSED PROXY ===", parsed);
      const normalized = normalizeSEOData(parsed);
      console.log("=== KEYTUBE NORMALIZED PROXY ===", normalized);
      return normalized;
    };
    return withProxyRetry(proxyApiCall, 3, 'optimizeSEOContent (Proxy)');
  }

  return runWithKeyRotation(
    settings.geminiApiKeys,
    currentKeyIndex,
    saveKeyIndex,
    async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-1.5-flash", // Chuyển sang model 1.5-flash vô cùng ổn định với API Key trực tiếp
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: seoResponseSchema,
          temperature: 0.75,
        }
      });
      const jsonText = response.text;
      console.log("=== KEYTUBE GEMINI DIRECT RESPONSE ===", jsonText);
      if (!jsonText) {
        throw new Error("Không nhận được phản hồi tối ưu SEO từ Gemini.");
      }
      
      const parsed = JSON.parse(jsonText.trim());
      console.log("=== KEYTUBE PARSED DIRECT ===", parsed);
      const normalized = normalizeSEOData(parsed);
      console.log("=== KEYTUBE NORMALIZED DIRECT ===", normalized);
      return normalized;
    }
  );
};


/**
 * STEP 2: Cinematic Thumbnail Prompt Generator
 */
export const generateThumbnailPrompt = async (
  chosenTitle: string,
  originalTheme: string,
  settings: Settings,
  currentKeyIndex: number,
  saveKeyIndex: (index: number) => void
): Promise<string> => {
  const systemInstruction = `
Bạn là một kỹ sư prompt ảnh điện ảnh chuyên nghiệp, chuyên chuyển đổi tiêu đề và nội dung video thành các prompt tạo ảnh cực kỳ kịch tính, nghệ thuật phục vụ cho mô hình AI tạo ảnh (như Meta AI, Flux, Nano Banana, Imagen).

QUY TẮC AN TOÀN & TRÁNH BỊ CHẶN BỘ LỌC (SFW Compliance):
- Tuyệt đối không mô tả máu me, vết thương rùng rợn, khỏa thân hay các tư thế nhạy cảm.
- Nếu chủ đề kinh dị/bạo lực: hãy chuyển sang mô tả "bầu không khí huyền bí", "ánh sáng đỏ sẫm kịch tính", "bóng tối bí ẩn", "vết rỉ sét", "khói mờ".
- Ngôn ngữ miêu tả chi tiết phải hoàn toàn bằng TIẾNG ANH để các mô hình tạo ảnh hiểu tốt nhất.

ĐỊNH DẠNG ĐẦU RA BẮT BUỘC:
Bạn BẮT BUỘC phải xuất ra văn bản theo mẫu chính xác sau:

Title: [Tiêu đề Tiếng Anh ngắn gọn, giật gân, cuốn hút]
Cinematic Description: [Đoạn mô tả chi tiết bằng Tiếng Anh về nhân vật chính, bối cảnh xung quanh, góc máy chụp, hiệu ứng ánh sáng như rim lighting, volumetric fog, v.v. Không sử dụng từ bạo lực trực tiếp]
Poster Text: [Nội dung văn bản sẽ in đè lên ảnh. Hãy lấy nguyên tiêu đề hoặc cụm từ ngắn gọn bằng Tiếng Việt nếu tiêu đề chính là Tiếng Việt]
Style: Cinematic, photorealistic, 8k, dramatic lighting, highly detailed, masterpiece, safe-rated.
`;

  const promptText = `
Hãy viết prompt tạo ảnh thumbnail đỉnh cao cho video có các thông tin sau:
- Tiêu đề tối ưu đã chọn: "${chosenTitle}"
- Chủ đề video gốc: "${originalTheme}"
`;

  if (isProxyEnabled()) {
    const proxyApiCall = async (currentModel: string): Promise<string> => {
      const messages = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: promptText }
      ];
      const text = await proxyFetchCompletion(messages, currentModel, false);
      return text.trim();
    };
    return withProxyRetry(proxyApiCall, 3, 'generateThumbnailPrompt (Proxy)');
  }

  return runWithKeyRotation(
    settings.geminiApiKeys,
    currentKeyIndex,
    saveKeyIndex,
    async (ai) => {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: promptText,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.7,
        }
      });
      
      const text = response.text;
      if (!text) {
        throw new Error("Không thể tạo prompt từ mô hình Gemini.");
      }
      
      return text.trim();
    }
  );
};

/**
 * STEP 3: Thumbnail Image Generation (Imagen API)
 */
export const generateThumbnailImage = async (
  prompt: string,
  referenceImageUrl: string | null,
  settings: Settings,
  currentKeyIndex: number,
  saveKeyIndex: (index: number) => void
): Promise<string> => {
  // Parse the structured prompt for optimization
  const titleMatch = prompt.match(/Title:\s*(.+)/);
  const descMatch = prompt.match(/Cinematic Description:\s*([\s\S]+?)(?=Poster Text:|$)/);
  const posterTextMatch = prompt.match(/Poster Text:\s*(.+)/);
  const styleMatch = prompt.match(/Style:\s*(.+)/);

  const parsed = {
    title: titleMatch ? titleMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : prompt,
    posterText: posterTextMatch ? posterTextMatch[1].trim() : '',
    style: styleMatch ? styleMatch[1].trim() : 'Cinematic, dramatic lighting, highly detailed.'
  };

  // Build the clean unified prompt string for Imagen
  const posterTextInstruction = parsed.posterText 
    ? ` With big bold graphic typography poster text overlay that says: "${parsed.posterText.replace(/"/g, '')}" in Vietnamese`
    : '';
  
  const finalPrompt = `A premium professional YouTube thumbnail showing: ${parsed.description}. ${posterTextInstruction}. Style: ${parsed.style}, cinematic composition, 16:9 aspect ratio, 8k, masterpiece.`;

  return runWithKeyRotation(
    settings.geminiApiKeys,
    currentKeyIndex,
    saveKeyIndex,
    async (ai) => {
      if (referenceImageUrl) {
        // Mode 1: Remix/Tái tạo từ ảnh đối thủ (Image-to-Image / reference image)
        try {
          const base64ImageData = await imageUrlToBase64(referenceImageUrl);
          
          const imagePart = {
            inlineData: {
              data: base64ImageData,
              mimeType: 'image/jpeg',
            },
          };

          const textPart = {
            text: `Recreate and transform this reference image into a clean cinematic YouTube thumbnail based on the new description. Maintain the overall composition, layout, and placement of elements, but transform the theme and details according to this prompt: ${finalPrompt}`,
          };

          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', // Model supporting image generation modality
            contents: {
              parts: [imagePart, textPart],
            },
            config: {
              responseModalities: [Modality.IMAGE],
            },
          });

          if (!response.candidates || response.candidates.length === 0) {
            throw new Error("AI không trả về kết quả hình ảnh nào. Nội dung có thể vi phạm bộ lọc.");
          }

          for (const part of response.candidates[0]?.content?.parts || []) {
            if (part.inlineData) {
              return `data:image/png;base64,${part.inlineData.data}`;
            }
          }
        } catch (err: any) {
          console.warn("Remix thumbnail failed, falling back to text-to-image", err);
          // Fallback to Text-to-Image if Remix fails (CORS or other reasons)
        }
      }

      // Mode 2: Tạo mới hoàn toàn (Text-to-Image)
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: finalPrompt,
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      if (!response.candidates || response.candidates.length === 0) {
        throw new Error("AI không thể vẽ ảnh từ prompt này. Có thể do chứa từ ngữ nhạy cảm.");
      }

      for (const part of response.candidates[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }

      throw new Error("Không nhận được dữ liệu base64 của hình ảnh.");
    }
  );
};
