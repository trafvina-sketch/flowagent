import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Clapperboard, Loader2, X, Send, Bot, User, Film, CheckCircle,
  ImagePlus, Zap, Eye,
  Minus, BookOpen, ChevronRight, SquarePen, Square, Music
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { API } from '../../config';
import { useProjectStore } from '../../store/useProjectStore';
import { useStoryMemory, type StorySummary, type StoryCharacter, type StoryEpisode } from '../../hooks/useStoryMemory';

interface ChatMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
  actions?: any[];
  imagePreview?: string;  // thumbnail for uploaded image
  imagePreviews?: string[];  // all uploaded image thumbnails
  timestamp: number;
}

interface Scene {
  number: number;
  prompt: string;
  image_prompt?: string;   // For I2V: prompt to create image first
  video_prompt?: string;   // For I2V: prompt to animate image
  video_prompts?: string[]; // For I2V: list of prompts to animate image (camera angles/mouth/etc)
  description: string;
}

type PendingActionType = 'generate_scenes' | 'i2v_pipeline' | 'generate_images' | 'story';

interface AgentPanelProps {
  characterNames: string[];
  canvasState: string;  // summary of current canvas nodes
  onFillPrompts: (prompts: string[], mode: string, autoExecute: boolean, model?: string, aspectRatio?: string) => void;
  onT2VPipeline: (scenes: Scene[], autoExecute: boolean, model?: string, aspectRatio?: string) => Promise<any>;
  onI2VPipeline: (scenes: Scene[], autoExecute: boolean, model?: string, aspectRatio?: string, refMediaIds?: string[]) => Promise<any>;
  onGenerateImages: (imagePromptsOrScenes: any[], autoExecute: boolean, useReference: boolean, aspectRatio?: string, refMediaIds?: string[]) => Promise<any>;
  onStoryPipeline: (storyAction: any, autoExecute: boolean, refMediaIds?: string[]) => Promise<any>;
  onMergeVideos: (transition?: string, transitionDuration?: number) => Promise<string | null>;
  onGenAllVideoFromImages: () => void;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  '📖 Tạo story 5 cảnh',
  '🏖️ Du lịch biển 2 phút',
  '💼 Phim tổng tài 3 phút',
  '🎓 Tình yêu học đường',
  '🗡️ Wuxia 1 phút',
  '📦 Quảng cáo sản phẩm',
  '🎬 Tạo tự động luôn 1 phút cinematic',
];

export default function AgentPanel({ characterNames, canvasState, onFillPrompts, onT2VPipeline, onI2VPipeline, onGenerateImages, onStoryPipeline, onMergeVideos, onGenAllVideoFromImages, onClose }: AgentPanelProps) {
  const settings = useProjectStore((s) => s.settings);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      content: `Xin chào! Tôi là **Agent** 🎬\n\nMô tả ý tưởng — tôi sẽ phân tích và chọn pipeline phù hợp:\n• **T2V** — text thuần → video\n• **I2V** — tải ảnh lên → tham chiếu tạo ảnh mới → animate video\n• **R2V** — nhân vật tham chiếu → video\n\n${characterNames.length > 0 ? `📌 Có **${characterNames.length} nhân vật**: ${characterNames.join(', ')}` : '📸 Tải ảnh sản phẩm để tạo video quảng cáo!'}`,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingScenes, setPendingScenes] = useState<Scene[] | null>(null);
  const [originalScenes, setOriginalScenes] = useState<Scene[]>([]);
  const [pendingMode, setPendingMode] = useState<string>('t2v');
  const [pendingTitle, setPendingTitle] = useState('');
  const [pendingAutoExec, setPendingAutoExec] = useState(false);
  const [pendingActionType, setPendingActionType] = useState<PendingActionType>('generate_scenes');
  const [pendingUseRef, setPendingUseRef] = useState(false);
  const [pendingModel, setPendingModel] = useState('pro');
  const [pendingAspect, setPendingAspect] = useState('16:9');
  const [autoClearCache, setAutoClearCache] = useState(() => {
    const saved = localStorage.getItem('auto_clear_cache');
    return saved !== null ? saved === 'true' : true;
  });

  useEffect(() => {
    localStorage.setItem('auto_clear_cache', String(autoClearCache));
  }, [autoClearCache]);
  const [pendingStoryAction, setPendingStoryAction] = useState<any>(null); // Full story action for multi-step pipeline
  const [storyRefMediaIds, setStoryRefMediaIds] = useState<string[]>([]); // Character/BG ref IDs from story pipeline for retry
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);      // base64 array
  const [uploadedAudios, setUploadedAudios] = useState<{ name: string; b64: string }[]>([]); // base64 array for audios
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);        // dataUrl array
  const [uploadedMediaIds, setUploadedMediaIds] = useState<string[]>([]);  // Flow API media IDs
  const [showStoryPicker, setShowStoryPicker] = useState(false);
  const [savedStories, setSavedStories] = useState<StorySummary[]>([]);
  const [continueDirection, setContinueDirection] = useState('');
  const [continueSceneCount, setContinueSceneCount] = useState(5);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stop all running agent operations
  const handleStop = useCallback(() => {
    // Abort any pending API call
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Reset all states
    setIsLoading(false);
    setIsGenerating(false);
    setGenProgress('');
    setGenPercent(0);
    setMessages(prev => [...prev, {
      role: 'system',
      content: '🛑 **Đã dừng** — Agent đã bị dừng bởi người dùng.',
      timestamp: Date.now(),
    }]);
    toast.success('🛑 Agent đã dừng');
  }, []);

  const { listStories, saveStory, buildContinueContext, deleteStory } = useStoryMemory();

  const hasKey = !!settings.aiProxyKey;

  // Upload images to Flow API for R2I reference
  const uploadImagesToFlow = useCallback(async (b64Images: string[]): Promise<string[]> => {
    const mediaIds: string[] = [];
    for (const b64 of b64Images) {
      try {
        const formData = new FormData();
        // Convert base64 to blob
        const byteChars = atob(b64);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArr], { type: 'image/png' });
        formData.append('file', blob, 'ref_image.png');
        formData.append('project_id', settings.flowkitProjectId || '');

        const res = await axios.post('/api/generate/upload-reference', formData);
        if (res.data.media_id) {
          mediaIds.push(res.data.media_id);
        }
      } catch (err: any) {
        console.error('Upload ref failed:', err);
      }
    }
    return mediaIds;
  }, [settings.flowkitProjectId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Multi-image/audio upload handler
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    let loaded = 0;
    const newPreviews: string[] = [];
    const newB64s: string[] = [];
    const newAudios: { name: string; b64: string }[] = [];

    const onFileLoaded = () => {
      loaded++;
      if (loaded === files.length) {
        if (newPreviews.length > 0) {
          setImagePreviews(prev => [...prev, ...newPreviews]);
          setUploadedImages(prev => [...prev, ...newB64s]);
        }
        if (newAudios.length > 0) {
          setUploadedAudios(prev => [...prev, ...newAudios]);
        }
      }
    };

    for (const file of files) {
      if (file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav') || file.name.endsWith('.m4a')) {
        if (file.size > 25 * 1024 * 1024) { 
          toast.error(`${file.name}: file âm thanh vượt quá 25MB`); 
          loaded++;
          continue; 
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const b64 = dataUrl.split(',')[1];
          newAudios.push({ name: file.name, b64 });
          onFileLoaded();
        };
        reader.readAsDataURL(file);
      } else if (file.type.startsWith('image/')) {
        if (file.size > 10 * 1024 * 1024) { 
          toast.error(`${file.name}: ảnh vượt quá 10MB`); 
          loaded++;
          continue; 
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const b64 = dataUrl.split(',')[1];
          newPreviews.push(dataUrl);
          newB64s.push(b64);
          onFileLoaded();
        };
        reader.readAsDataURL(file);
      } else {
        toast.error(`${file.name}: định dạng không được hỗ trợ (chỉ chọn ảnh hoặc mp3/wav)`);
        loaded++;
      }
    }
    e.target.value = '';
  }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg && uploadedImages.length === 0 && uploadedAudios.length === 0) return;
    if (!hasKey) { toast.error('Cấu hình API key trong Settings → AI Director'); return; }

    // Format content with audio indicators
    let contentFormatted = msg;
    if (uploadedAudios.length > 0) {
      const audioList = uploadedAudios.map(a => `🎵 [Âm thanh: ${a.name}]`).join(', ');
      contentFormatted = msg ? `${msg}\n${audioList}` : `🎙️ Phân tích file âm thanh: ${audioList}`;
    }

    const userMsg: ChatMsg = {
      role: 'user',
      content: uploadedImages.length > 0 
        ? `${contentFormatted || '📸 Phân tích ảnh'} (${uploadedImages.length} ảnh)` 
        : contentFormatted,
      imagePreviews: imagePreviews.length > 0 ? [...imagePreviews] : undefined,
      imagePreview: imagePreviews[0] || undefined,
      timestamp: Date.now(),
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    const currentImages = [...uploadedImages];
    const currentAudios = [...uploadedAudios];
    setUploadedImages([]);
    setImagePreviews([]);
    setUploadedAudios([]);

    // ─── Smart shortcut: detect merge intent → execute directly ───
    const lowerMsg = msg.toLowerCase();
    const isMergeIntent = /\b(nối|ghép|merge|gộp|kết hợp)\b.*\b(video|clip)\b|\b(video|clip)\b.*\b(nối|ghép|merge|gộp|kết hợp)\b/i.test(lowerMsg)
      || /^(nối|ghép|merge|gộp)\s*(video|lại|hết|tất cả)?$/i.test(lowerMsg.trim());
    const hasVideosOnCanvas = canvasState?.includes('video đã tạo');
    
    if (isMergeIntent && hasVideosOnCanvas) {
      // Detect transition from message
      let transition = 'dissolve';
      if (/fade/i.test(lowerMsg)) transition = 'fade';
      else if (/wipe/i.test(lowerMsg)) transition = 'wipeleft';
      else if (/zoom/i.test(lowerMsg)) transition = 'zoomin';
      else if (/slide/i.test(lowerMsg)) transition = 'slideleft';
      else if (/fadeblack|đen/i.test(lowerMsg)) transition = 'fadeblack';
      else if (/none|không/i.test(lowerMsg)) transition = 'none';

      setMessages(prev => [...prev, {
        role: 'system',
        content: `🔗 Đang nối video theo thứ tự prompt (chuyển cảnh: ${transition})...`,
        timestamp: Date.now(),
      }]);
      setIsLoading(false);
      setIsGenerating(true);
      setGenProgress('🔗 Đang nối video...');
      setGenPercent(0);

      try {
        const mergedUrl = await onMergeVideos(transition, 0.5);
        if (mergedUrl) {
          setMessages(prev => [...prev, {
            role: 'system',
            content: `✅ **Video đã nối thành công!**\n\nNode "Video đã nối" đã được tạo trên canvas.\n📥 Bấm **Tải về** trên toolbar để download.`,
            timestamp: Date.now(),
          }]);
        } else {
          setMessages(prev => [...prev, {
            role: 'system',
            content: `❌ Nối video thất bại. Kiểm tra lại các video trên canvas.`,
            timestamp: Date.now(),
          }]);
        }
      } catch (err: any) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `❌ Lỗi nối video: ${err?.message || 'unknown'}`,
          timestamp: Date.now(),
        }]);
      }
      setIsGenerating(false);
      setGenProgress('');
      setGenPercent(0);
      return;
    }

    // ─── Smart shortcut: detect I2V intent → use existing scene images ───
    const isVideoIntent = /\b(tạo|tao|render|generate|make|animate)\b.*\b(video|clip|i2v|animation)\b|\b(video|clip)\b.*\b(tạo|tao|từ|cho|render)\b/i.test(lowerMsg)
      || /^(tạo|render|generate)\s*(video|clip)\s*(cho|từ|tất cả)?/i.test(lowerMsg.trim());
    const hasImagesWithoutVideo = canvasState?.includes('CHƯA CÓ VIDEO');

    if (isVideoIntent && hasImagesWithoutVideo && !isMergeIntent) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `🎬 Phát hiện **ảnh cảnh trên canvas chưa có video** → tự động dùng **I2V** (Image-to-Video) từ ảnh cảnh, không tạo T2V mới.\n\nĐang tạo video cho tất cả ảnh...`,
        timestamp: Date.now(),
      }]);
      setIsLoading(false);
      onGenAllVideoFromImages();
      return;
    }

    // Upload images to Flow API for R2I reference
    let refMediaIds: string[] = [];
    if (currentImages.length > 0) {
      refMediaIds = await uploadImagesToFlow(currentImages);
      if (refMediaIds.length > 0) {
        setUploadedMediaIds(refMediaIds);
      }
    }

    try {
      // Inject canvas context so AI understands what already exists
      const contextMsg = canvasState ? `[CANVAS STATE: ${canvasState}]` : '';
      const apiMessages = newMessages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));
      
      // Prepend canvas context to the latest user message
      if (contextMsg && apiMessages.length > 0) {
        const lastIdx = apiMessages.length - 1;
        if (apiMessages[lastIdx].role === 'user') {
          apiMessages[lastIdx] = {
            ...apiMessages[lastIdx],
            content: `${contextMsg}\n\n${apiMessages[lastIdx].content}`,
          };
        }
      }
      const lowerMsg = msg.toLowerCase();
      const isT2VExplicit = /\b(text to video|t2v|không dùng ảnh|không tham chiếu|tạo từ text|tao tu text)\b/i.test(lowerMsg);

      const res = await axios.post(API.agentChat, {
        messages: apiMessages,
        characters: characterNames,
        images_base64: isT2VExplicit ? [] : currentImages,  // Skip current images if explicit T2V requested
        audios_base64: currentAudios.map(a => a.b64), // ALL uploaded audios
        ai_endpoint: settings.aiProxyEndpoint,
        ai_key: settings.aiProxyKey,
        ai_model: settings.aiProxyModel,
        has_references: isT2VExplicit ? false : (uploadedMediaIds.length > 0 || refMediaIds.length > 0),
        global_art_style: settings.globalArtStyle || '',
      }, { timeout: 90000 });

      if (res.data.success) {
        // Show which agents were used
        const agentsUsed = res.data.agents_used || [];
        const agentBadges = agentsUsed.length > 0
          ? `\n\n🤖 _${agentsUsed.map((a: string) => {
              if (a === 'director') return '🎬 Director';
              if (a === 'music') return '🎵 Music MV';
              if (a === 'script') return '📝 Script';
              if (a === 'prompt_enhancer') return '✨ Enhancer';
              return a;
            }).join(' → ')}_`
          : '';

        const assistantMsg: ChatMsg = {
          role: 'assistant',
          content: (res.data.message || '') + agentBadges,
          actions: res.data.actions,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMsg]);

        // Process actions — use refMediaIds (local, fresh) or fallback to uploadedMediaIds (previous turns)
        if (res.data.actions?.length > 0) {
          const currentRefMediaIds = refMediaIds.length > 0 ? refMediaIds : uploadedMediaIds;
          for (const action of res.data.actions) {
            // T2V / R2V — direct video from text
            if (action.type === 'generate_scenes' && action.scenes) {
              setPendingScenes(action.scenes);
              setOriginalScenes(action.scenes);
              setPendingMode(action.mode || 't2v');
              setPendingTitle(action.title || '');
              setPendingActionType('generate_scenes');
              setPendingModel(action.model || 'pro');
              setPendingAspect(action.aspect_ratio || '16:9');
              const autoExec = action.auto_execute === true;
              setPendingAutoExec(autoExec);

              if (autoExec) {
                if ((action.mode || 't2v') === 't2v') {
                  setTimeout(() => {
                    setIsGenerating(true);
                    setGenProgress(`⚡ Auto T2V: Tạo ${action.scenes.length} video từ text trực tiếp...`);
                    setGenPercent(0);
                    onT2VPipeline(action.scenes, true, action.model, action.aspect_ratio)
                      .then(() => {
                        setIsGenerating(false); setGenProgress('');
                      })
                      .catch(() => {
                        setIsGenerating(false); setGenProgress('');
                      });
                    setPendingScenes(null);
                  }, 500);
                } else {
                  const prompts = action.scenes.map((s: Scene) => s.prompt || s.image_prompt || (s.video_prompts ? s.video_prompts[0] : ''));
                  setTimeout(() => {
                    onFillPrompts(prompts, action.mode || 't2v', true);
                    setMessages(prev => [...prev, {
                      role: 'system',
                      content: `⚡ Auto: ${prompts.length} prompt → ${(action.mode || 't2v').toUpperCase()} đang chạy...`,
                      timestamp: Date.now(),
                    }]);
                    setPendingScenes(null);
                  }, 500);
                }
              }
            }

            // I2V Pipeline — create images first, then animate to video
            if (action.type === 'i2v_pipeline' && action.scenes) {
              setPendingScenes(action.scenes);
              setOriginalScenes(action.scenes);
              setPendingMode('i2v');
              setPendingTitle(action.title || 'I2V Pipeline');
              setPendingActionType('i2v_pipeline');
              setPendingModel(action.model || 'pro');
              setPendingAspect(action.aspect_ratio || '16:9');
              const autoExec = action.auto_execute === true;
              setPendingAutoExec(autoExec);

              if (autoExec) {
                setTimeout(() => {
                  setIsGenerating(true);
                  setGenProgress(`⚡ Auto I2V: Tạo ${action.scenes.length} ảnh → video...`);
                  setGenPercent(0);
                  onI2VPipeline(action.scenes, true, action.model, action.aspect_ratio, currentRefMediaIds)
                    .then((res: any) => {
                      if (res) {
                        if (res.stoppedAt) {
                          setMessages(prev => [...prev, { role: 'system', content: `🛑 **Pipeline dừng tại: ${res.stoppedAt}**\n\n${res.stoppedReason || ''}`, timestamp: Date.now() }]);
                        } else if (res.failed > 0) {
                          setFailedPrompts(res.failedPrompts || []);
                          setMessages(prev => [...prev, { role: 'system', content: `⚠️ Kết quả: **${res.success}/${res.total}** thành công, **${res.failed}** thất bại`, timestamp: Date.now() }]);
                        } else {
                          setMessages(prev => [...prev, { role: 'system', content: `✅ Hoàn thành! **${res.success}/${res.total}** tạo xong 🎉`, timestamp: Date.now() }]);
                        }
                      }
                      setIsGenerating(false); setGenProgress(''); setGenPercent(0);
                    })
                    .catch(() => { setIsGenerating(false); setGenProgress(''); });
                  setMessages(prev => [...prev, {
                    role: 'system',
                    content: `⚡ Auto I2V: Tạo ${action.scenes.length} ảnh → animate video...`,
                    timestamp: Date.now(),
                  }]);
                  setPendingScenes(null);
                }, 500);
              }
            }

            // Generate images (T2I or R2I with reference)
            if (action.type === 'generate_images' && action.images) {
              const useRef = action.use_reference === true;
              const imgs = action.images.map((img: any) => ({
                number: img.number, prompt: img.prompt, description: img.description,
              }));
              setPendingScenes(imgs);
              setOriginalScenes(imgs);
              setPendingMode(useRef ? 'r2i' : 't2i');
              setPendingTitle(action.title || (useRef ? 'Ảnh tham chiếu' : 'Tạo ảnh'));
              setPendingActionType('generate_images');
              setPendingUseRef(useRef);
              setPendingModel(action.model || 'pro');
              setPendingAspect(action.aspect_ratio || '16:9');
              const autoExec = action.auto_execute === true;
              setPendingAutoExec(autoExec);

              if (autoExec) {
                setTimeout(() => {
                  setIsGenerating(true);
                  setGenProgress(`⚡ Auto: Tạo ${imgs.length} ảnh ${useRef ? '(tham chiếu)' : '(text)'}...`);
                  setGenPercent(0);
                  onGenerateImages(imgs.map((s: Scene) => s.prompt), true, useRef, action.aspect_ratio, currentRefMediaIds)
                    .then((res: any) => {
                      if (res) {
                        if (res.stoppedAt) {
                          setMessages(prev => [...prev, { role: 'system', content: `🛑 **Pipeline dừng: ${res.stoppedReason || ''}**`, timestamp: Date.now() }]);
                        } else if (res.failed > 0) {
                          setFailedPrompts(res.failedPrompts || []);
                          setMessages(prev => [...prev, { role: 'system', content: `⚠️ **${res.success}/${res.total}** thành công`, timestamp: Date.now() }]);
                        } else {
                          setMessages(prev => [...prev, { role: 'system', content: `✅ Hoàn thành! **${res.success}/${res.total}** ảnh 🎉`, timestamp: Date.now() }]);
                        }
                      }
                      setIsGenerating(false); setGenProgress(''); setGenPercent(0);
                    })
                    .catch(() => { setIsGenerating(false); setGenProgress(''); });
                  setMessages(prev => [...prev, {
                    role: 'system',
                    content: `⚡ Auto: Tạo ${imgs.length} ảnh ${useRef ? '(tham chiếu)' : '(text)'}...`,
                    timestamp: Date.now(),
                  }]);
                  setPendingScenes(null);
                }, 500);
              }
            }

            // Story Mode — multi-step: Characters → Backgrounds → Scenes R2I → Videos
            if (action.type === 'story' && action.scenes) {
              const chars = action.characters || [];
              const bgs = action.backgrounds || [];
              const prps = action.props || [];
              const autoVideo = action.auto_video === true;

              // Store the FULL action for multi-step pipeline
              setPendingStoryAction(action);
              setPendingScenes(action.scenes);
              setOriginalScenes(action.scenes);

              setPendingTitle(action.title || 'Story');
              setPendingActionType('story');
              setPendingModel(action.model || 'pro');
              setPendingAspect(action.aspect_ratio || '16:9');
              setPendingAutoExec(false);

              const parts = [
                chars.length > 0 ? `👤 ${chars.length} nhân vật` : '',
                bgs.length > 0 ? `🏞️ ${bgs.length} bối cảnh` : '',
                prps.length > 0 ? `🎭 ${prps.length} đạo cụ` : '',
                `🎬 ${action.scenes.length} cảnh`,
                autoVideo ? '📹 + video' : '',
              ].filter(Boolean).join(' → ');

              setMessages(prev => [...prev, {
                role: 'system',
                content: `📖 Story \"${action.title}\"\n\n${parts}\n\n**Pipeline**: ${chars.length > 0 ? 'Tạo nhân vật → ' : ''}${bgs.length > 0 ? 'Bối cảnh → ' : ''}Tạo cảnh (R2I) ${autoVideo ? '→ Video' : ''}\n\nBấm **▶ Tạo** để bắt đầu!`,
                timestamp: Date.now(),
              }]);
            }

            // ─── Merge Videos action ───
            if (action.type === 'merge_videos') {
              const transition = action.transition || 'none';
              const duration = action.transition_duration || 0.5;
              setMessages(prev => [...prev, {
                role: 'system',
                content: `🔗 Đang nối video theo thứ tự prompt${transition !== 'none' ? ` (chuyển cảnh: ${transition})` : ''}...`,
                timestamp: Date.now(),
              }]);
              setIsGenerating(true);
              setGenProgress('🔗 Đang nối video...');
              setGenPercent(0);
              // Execute merge
              const mergedUrl = await onMergeVideos(transition, duration);
              if (mergedUrl) {
                setMessages(prev => [...prev, {
                  role: 'system',
                  content: `✅ **Video đã nối thành công!**\n\nNode "Video đã nối" đã được tạo trên canvas.\n📥 Bấm **Tải về** trên toolbar để download.`,
                  timestamp: Date.now(),
                }]);
              }
              setIsGenerating(false); setGenProgress(''); setGenPercent(0);
            }
          }
        }
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ ${res.data.error}`,
          timestamp: Date.now(),
        }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Lỗi: ${err.message}`,
        timestamp: Date.now(),
      }]);
    }
    setIsLoading(false);
  }, [input, messages, characterNames, settings, hasKey, uploadedImages, imagePreviews, uploadedMediaIds, onFillPrompts, uploadImagesToFlow, onMergeVideos, canvasState]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // Action buttons for pending scenes
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState('');
  const [genPercent, setGenPercent] = useState(0);

  // Listen for real-time progress events from pipeline
  useEffect(() => {
    const handleProgress = (e: any) => {
      const { message, current, total, phase } = e.detail || {};
      if (message) setGenProgress(message);
      if (typeof current === 'number' && typeof total === 'number' && total > 0) {
        setGenPercent(Math.round((current / total) * 100));
      }
      if (phase === 'done') {
        // Auto-clear after done
        setTimeout(() => { setGenPercent(0); }, 2000);
      }
    };
    window.addEventListener('pipeline-progress', handleProgress);
    return () => window.removeEventListener('pipeline-progress', handleProgress);
  }, []);
  const [failedPrompts, setFailedPrompts] = useState<string[]>([]);

  const handleAutoRun = async () => {
    if (!pendingScenes) return;
    if (pendingAutoExec) {
      // Dummy check to bypass strict tsc warning
    }
    const total = pendingScenes.length;
    const scenesBackup = [...pendingScenes];
    setOriginalScenes(scenesBackup);
    setIsGenerating(true);
    setFailedPrompts([]);
    setPendingScenes(null);


    let result: any;

    if (pendingActionType === 'story' && pendingStoryAction) {
      setLastStoryAction(pendingStoryAction);
      const chars = pendingStoryAction.characters || [];
      const bgs = pendingStoryAction.backgrounds || [];
      const scenes = pendingStoryAction.scenes || [];
      setGenProgress(`📖 Story: ${chars.length} nhân vật → ${scenes.length} cảnh...`);
      setMessages(prev => [...prev, { role: 'system', content: `⚡ Story Pipeline bắt đầu!\n👤 ${chars.length} nhân vật → 🏞️ ${bgs.length} bối cảnh → 🎬 ${scenes.length} cảnh...`, timestamp: Date.now() }]);
      result = await onStoryPipeline(pendingStoryAction, true, uploadedMediaIds);
      setPendingStoryAction(null);
    } else if (pendingActionType === 'i2v_pipeline') {
      setGenProgress(`🎨 R2I → I2V: đang tạo ${total} ảnh...`);
      setMessages(prev => [...prev, { role: 'system', content: `⚡ Đang tạo ${total} ảnh R2I + video [${pendingModel.toUpperCase()}|${pendingAspect}]...`, timestamp: Date.now() }]);
      result = await onI2VPipeline(scenesBackup, true, pendingModel, pendingAspect, uploadedMediaIds);
    } else if (pendingActionType === 'generate_images') {
      setGenProgress(`🎨 Tạo ảnh: đang tạo ${total}...`);
      setMessages(prev => [...prev, { role: 'system', content: `⚡ Đang tạo ${total} ảnh ${pendingUseRef ? 'R2I' : 'T2I'} [${pendingAspect}]...`, timestamp: Date.now() }]);
      result = await onGenerateImages(scenesBackup.map(s => s.prompt || s.image_prompt || ''), true, pendingUseRef, pendingAspect, uploadedMediaIds);
    } else {
      if (pendingMode === 't2v') {
        setGenProgress(`⚡ Auto T2V: Tạo ${total} video từ text trực tiếp...`);
        setMessages(prev => [...prev, { role: 'system', content: `⚡ Đang tạo ${total} video T2V trực tiếp [${pendingModel.toUpperCase()}|${pendingAspect}]...`, timestamp: Date.now() }]);
        result = await onT2VPipeline(scenesBackup, true, pendingModel, pendingAspect);
      } else {
        const prompts = scenesBackup.map(s => s.prompt || s.image_prompt || (s.video_prompts ? s.video_prompts[0] : ''));
        setGenProgress(`🎬 Đang điền ${total} prompt...`);
        onFillPrompts(prompts, pendingMode, true, pendingModel, pendingAspect);
        setMessages(prev => [...prev, { role: 'system', content: `✅ ${total} video đang chạy [${pendingModel.toUpperCase()}|${pendingAspect}]`, timestamp: Date.now() }]);
      }
    }

    // Show accurate result
    if (result) {
      // Pipeline stopped early (e.g., character creation failed)
      if (result.stoppedAt) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `🛑 **Pipeline dừng tại: ${result.stoppedAt}**\n\n${result.stoppedReason || 'Có lỗi xảy ra.'}\n\n❌ Prompt lỗi:\n${result.failedPrompts.map((p: string, i: number) => `${i + 1}. ${p.slice(0, 80)}...`).join('\n')}`,
          timestamp: Date.now(),
        }]);
      } else if (result.failed > 0) {
        setFailedPrompts(result.failedPrompts);
        // Save ref media IDs from story pipeline for retry
        if ((pendingActionType === 'story' || pendingActionType === 'i2v_pipeline') && result.charMediaIds) {
          setStoryRefMediaIds(result.charMediaIds.filter(Boolean));
        }
        const failedList = result.failedPrompts.map((p: string, i: number) => `${i + 1}. ${p.slice(0, 60)}...`).join('\n');
        setMessages(prev => [...prev, {
          role: 'system',
          content: `⚠️ Kết quả: **${result!.success}/${result!.total}** thành công, **${result!.failed}** thất bại\n\n❌ Prompt lỗi:\n${failedList}\n\nBấm **🔄 Tạo lại** để thử lại các prompt thất bại.`,
          timestamp: Date.now(),
        }]);
      } else {
        const hasVideo = !!(result && (result as any).hasVideos);
        const videoMsg = hasVideo ? '\n\n⏳ **Video đang render trên máy chủ** — theo dõi tiến trình tại tab Video hoặc Gallery.' : '';
        const doneLabel = hasVideo
          ? `📤 Đã gửi xong! **${result!.success}/${result!.total}** ảnh tạo xong, video đang render...`
          : `✅ Hoàn thành! **${result!.success}/${result!.total}** ảnh kịch bản đã tạo xong 🎉`;
        setMessages(prev => [...prev, {
          role: 'system',
          content: `${doneLabel}${videoMsg}${pendingActionType === 'generate_images' ? '\n\nBấm **Gen All Video** trên toolbar để tạo video.' : ''}`,
          timestamp: Date.now(),
        }]);
      }

      // Auto clear cache and reload if enabled
      if (autoClearCache) {
        const isFailedMultipleTimes = result.failed >= 2 || (result.stoppedAt && result.failed > 0);
        const isCompletedFully = result.failed === 0;
        if (isFailedMultipleTimes || isCompletedFully) {
          setTimeout(async () => {
            try {
              await axios.post('/api/flowkit/clear-cache', {
                project_id: settings.flowkitProjectId || ''
              });
              toast.success('🧹 Đã xóa cache Chrome (2h) & Tự động load lại link Google Flow!');
            } catch (err) {
              console.error('Failed to clear cache:', err);
            }
          }, 3000);
        }
      }

      // ─── Auto-save Story Memory ───
      if (pendingActionType === 'story' && lastStoryAction) {
        const storyAction = lastStoryAction;
        const pid = `story_${Date.now()}`;
        const chars: StoryCharacter[] = (storyAction.characters || []).map((c: any, idx: number) => ({
          name: c.name,
          role: c.role || '',
          description: c.description || '',
          design_prompt: c.design_prompt || '',
          media_ids: result.charMediaIds ? [result.charMediaIds[idx]].filter(Boolean) : [],
        }));
        const ep: StoryEpisode = {
          ep: 1,
          title: storyAction.title || 'Tập 1',
          summary: (storyAction.scenes || []).map((s: any) => s.description || s.narration || '').join('. '),
          key_events: (storyAction.scenes || []).map((s: any) => s.scene_title || `Cảnh ${s.number}`),
          cliffhanger: '',
          scene_count: (storyAction.scenes || []).length,
        };
        await saveStory(pid, storyAction.title || 'Untitled', chars, ep,
          { aspect_ratio: storyAction.aspect_ratio, model: storyAction.model },
          { art_style: 'cinematic', auto_video: storyAction.auto_video },
          (storyAction.scenes || []).length
        );
        setMessages(prev => [...prev, {
          role: 'system',
          content: `📚 **Story đã lưu!** Bấm 📖 để tải tập tiếp theo bất kỳ lúc nào.`,
          timestamp: Date.now(),
        }]);
      }
    }

    setIsGenerating(false);
    setGenProgress('');
  };

  // Keep reference to last story action for auto-save
  const [lastStoryAction, setLastStoryAction] = useState<any>(null);

  // Continue story from memory
  const handleContinueStory = useCallback(async (projectId: string) => {
    if (!hasKey) return;
    setIsLoading(true);
    setShowStoryPicker(false);

    const ctx = await buildContinueContext(projectId, continueDirection, continueSceneCount);
    if (!ctx) {
      setIsLoading(false);
      return;
    }

    setMessages(prev => [...prev, {
      role: 'system',
      content: `📖 Đang tạo **Tập ${ctx.nextEpisode}**...\n👤 ${ctx.characters.length} nhân vật sẵn có\n🔗 ${ctx.characterMediaIds.length} ảnh tham chiếu`,
      timestamp: Date.now(),
    }]);

    // Inject previous media IDs as reference
    if (ctx.characterMediaIds.length > 0) {
      setUploadedMediaIds(prev => [...new Set([...prev, ...ctx.characterMediaIds])]);
    }

    // Send context to AI as a user message
    const contextMsg = ctx.context + (continueDirection ? `\n\nUser muốn: ${continueDirection}` : '');
    setInput(contextMsg);
    setContinueDirection('');

    // Auto-send
    setTimeout(() => {
      sendMessage(contextMsg);
    }, 200);
  }, [hasKey, buildContinueContext, continueDirection, continueSceneCount]);

  // Open story picker
  const handleOpenStoryPicker = useCallback(async () => {
    const stories = await listStories();
    setSavedStories(stories);
    setShowStoryPicker(true);
  }, [listStories]);

  // Retry failed prompts
  const retryFailed = async () => {
    if (failedPrompts.length === 0) return;
    const retryCount = failedPrompts.length;
    setIsGenerating(true);

    // Map failed prompts to original scene objects using originalScenes backup
    const failedScenes: Scene[] = [];
    failedPrompts.forEach((failedP) => {
      const matched = originalScenes.find(
        (s) =>
          (s.prompt || s.image_prompt || (s.video_prompts && s.video_prompts[0]) || '') === failedP
      );
      if (matched) {
        failedScenes.push(matched);
      } else {
        // Fallback: construct standard scene
        failedScenes.push({
          number: failedScenes.length + 1,
          prompt: failedP,
          description: 'Cảnh tạo lại',
        });
      }
    });

    // Detect which pipeline mode we are currently retrying
    const isT2V = pendingActionType === 'generate_scenes' && pendingMode === 't2v';
    const isI2VorStory = pendingActionType === 'i2v_pipeline' || pendingActionType === 'story';

    const retryRefIds = storyRefMediaIds.length > 0 ? [...new Set([...uploadedMediaIds, ...storyRefMediaIds])] : uploadedMediaIds;
    const retryUseRef = storyRefMediaIds.length > 0 ? true : pendingUseRef;

    let result: { success: number; failed: number; total: number; failedPrompts: string[] } | undefined;

    if (isT2V) {
      setGenProgress(`🔄 Tạo lại ${retryCount} video T2V trực tiếp...`);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `🔄 Đang tạo lại ${retryCount} video T2V trực tiếp thất bại [${pendingModel.toUpperCase()}|${pendingAspect}]...`,
        timestamp: Date.now()
      }]);
      result = await onT2VPipeline(failedScenes, true, pendingModel, pendingAspect);
    } else if (isI2VorStory) {
      setGenProgress(`🔄 Tạo lại ${retryCount} ảnh và video I2V thất bại...`);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `🔄 Đang tạo lại ${retryCount} ảnh → video I2V thất bại [${pendingModel.toUpperCase()}|${pendingAspect}]...`,
        timestamp: Date.now()
      }]);
      result = await onI2VPipeline(failedScenes, true, pendingModel, pendingAspect, retryRefIds);
    } else {
      // Just image retry
      setGenProgress(`🔄 Tạo lại ${retryCount} ảnh thất bại...`);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `🔄 Đang tạo lại ${retryCount} ảnh thất bại...${retryUseRef ? ' (R2I với tham chiếu nhân vật)' : ''}`,
        timestamp: Date.now()
      }]);
      result = await onGenerateImages(failedScenes, true, retryUseRef, pendingAspect, retryRefIds);
    }

    if (result && result.failed > 0) {
      setFailedPrompts(result.failedPrompts);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `⚠️ Retry: **${result.success}/${retryCount}** thành công, **${result.failed}** vẫn lỗi. Có thể thử lại lần nữa.`,
        timestamp: Date.now(),
      }]);
    } else {
      setFailedPrompts([]);
      setStoryRefMediaIds([]);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `✅ Retry thành công! Tất cả ${retryCount} cảnh đã tạo xong 🎉`,
        timestamp: Date.now(),
      }]);
    }

    if (result) {
      if (autoClearCache) {
        const isFailedMultipleTimes = result.failed >= 2;
        const isCompletedFully = result.failed === 0;
        if (isFailedMultipleTimes || isCompletedFully) {
          setTimeout(async () => {
            try {
              await axios.post('/api/flowkit/clear-cache', {
                project_id: settings.flowkitProjectId || ''
              });
              toast.success('🧹 Đã xóa cache Chrome (2h) & Tự động load lại link Google Flow!');
            } catch (err) {
              console.error('Failed to clear cache:', err);
            }
          }, 3000);
        }
      }
    }

    setIsGenerating(false);
    setGenProgress('');
  };


  const handleReview = () => {
    if (!pendingScenes) return;
    if (pendingActionType === 'i2v_pipeline') {
      onI2VPipeline(pendingScenes, false, pendingModel, pendingAspect, uploadedMediaIds);
      setMessages(prev => [...prev, { role: 'system', content: `📋 I2V [${pendingModel.toUpperCase()}|${pendingAspect}]: ${pendingScenes.length} cảnh — review trên canvas`, timestamp: Date.now() }]);
    } else if (pendingActionType === 'generate_images') {
      onGenerateImages(pendingScenes.map(s => s.prompt || s.image_prompt || ''), false, pendingUseRef, pendingAspect, uploadedMediaIds);
      setMessages(prev => [...prev, { role: 'system', content: `📋 ${pendingScenes.length} ảnh ${pendingUseRef ? '(R2I)' : '(T2I)'} → review trên canvas`, timestamp: Date.now() }]);
    } else {
      if (pendingMode === 't2v') {
        onT2VPipeline(pendingScenes, false, pendingModel, pendingAspect);
        setMessages(prev => [...prev, { role: 'system', content: `📋 T2V Direct [${pendingModel.toUpperCase()}|${pendingAspect}]: ${pendingScenes.length} cảnh — review trên canvas`, timestamp: Date.now() }]);
      } else {
        const prompts = pendingScenes.map(s => s.prompt || s.image_prompt || (s.video_prompts ? s.video_prompts[0] : ''));
        onFillPrompts(prompts, pendingMode, false, pendingModel, pendingAspect);
        setMessages(prev => [...prev, { role: 'system', content: `📋 ${prompts.length} prompt [${pendingModel.toUpperCase()}|${pendingAspect}] → review`, timestamp: Date.now() }]);
      }
    }
    setPendingScenes(null);
  };

  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      const parsed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return <span key={i} className="block" dangerouslySetInnerHTML={{ __html: parsed || '&nbsp;' }} />;
    });
  };

  const [isMinimized, setIsMinimized] = useState(false);

  // Minimized bubble
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 shadow-2xl shadow-violet-500/40 flex items-center justify-center hover:scale-110 transition-all relative cursor-pointer animate-bounce-subtle"
        title="Mở Agent Chat"
      >
        <Clapperboard className="w-6 h-6 text-white" />
        {messages.length > 1 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow-lg">
            {messages.filter(m => m.role === 'assistant').length}
          </span>
        )}
        {isGenerating && (
          <span className="absolute -bottom-0.5 -left-0.5 w-4 h-4 bg-emerald-500 rounded-full animate-pulse" />
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl overflow-hidden shadow-2xl shadow-black/50" style={{ width: 380, height: 520, maxHeight: '80vh' }}>
      <div className="bg-slate-900/98 backdrop-blur-xl border border-violet-500/30 rounded-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20 border-b border-violet-500/20 flex-shrink-0 cursor-grab">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Clapperboard className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <span className="text-xs font-bold text-violet-300">Agent</span>
              <span className="text-[8px] text-slate-500 block">{characterNames.length > 0 ? `${characterNames.length} nhân vật` : 'Chat AI'}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleOpenStoryPicker} className="text-amber-400 hover:text-amber-300 transition-colors p-1 rounded hover:bg-slate-800" title="Tải tập tiếp theo">
              <BookOpen className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { setMessages([]); setFailedPrompts([]); setStoryRefMediaIds([]); setIsGenerating(false); setGenProgress(''); setGenPercent(0); setLastStoryAction(null); }} className="text-emerald-400 hover:text-emerald-300 transition-colors p-1 rounded hover:bg-slate-800" title="Chat mới">
              <SquarePen className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setIsMinimized(true)} className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded hover:bg-slate-800" title="Thu nhỏ">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded hover:bg-slate-800" title="Đóng">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Chat */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 custom-scrollbar">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-violet-400" />
                </div>
              )}
              {msg.role === 'system' && (
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                </div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : msg.role === 'system'
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded-bl-sm'
                    : 'bg-slate-800 text-slate-200 border border-slate-700/50 rounded-bl-sm'
              }`}>
                {msg.imagePreview && (
                  <img src={msg.imagePreview} alt="uploaded" className="w-full max-h-32 object-cover rounded-lg mb-1.5" />
                )}
                {renderContent(msg.content)}
              </div>
              {msg.role === 'user' && (
                <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-indigo-400" />
                </div>
              )}
            </div>
          ))}

          {/* Loading */}
          {isLoading && (
            <div className="flex gap-2 items-start">
              <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                <Bot className="w-3.5 h-3.5 text-violet-400" />
              </div>
              <div className="bg-slate-800 rounded-2xl rounded-bl-sm px-3 py-2 border border-slate-700/50 flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <button onClick={handleStop} className="ml-2 px-2 py-0.5 bg-red-500/20 hover:bg-red-500/40 border border-red-500/40 rounded text-[10px] text-red-400 hover:text-red-300 font-semibold transition-all flex items-center gap-1" title="Dừng Agent">
                  <Square className="w-2.5 h-2.5 fill-current" /> Dừng
                </button>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Pending scenes with action buttons */}
        {pendingScenes && (
          <div className="px-3 py-2 border-t border-violet-500/20 bg-violet-500/5 flex-shrink-0 max-h-[250px] overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-violet-400 flex items-center gap-1">
                <Film className="w-3 h-3" />
                {pendingTitle || 'Kịch bản'} — {pendingScenes.length} {pendingActionType === 'generate_images' ? 'ảnh' : 'cảnh'}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">{pendingModel.toUpperCase()}</span>
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold">{pendingAspect}</span>
              </div>
            </div>

            <div className="space-y-1 mb-2">
              {pendingScenes.slice(0, 4).map((scene, idx) => (
                <div key={idx} className="flex gap-1.5 items-start">
                  <span className="text-[9px] text-violet-500 font-bold w-4 flex-shrink-0">{scene.number || idx + 1}</span>
                  <span className="text-[9px] text-slate-400 line-clamp-1">
                    {scene.description || (scene.image_prompt ? `🖼️ ${scene.image_prompt.slice(0, 50)}...` : scene.prompt?.slice(0, 70))}
                  </span>
                </div>
              ))}
              {pendingScenes.length > 4 && (
                <span className="text-[9px] text-slate-600 italic">... +{pendingScenes.length - 4} nữa</span>
              )}
            </div>

            <div className="flex items-center gap-1.5 mb-2 px-1">
              <input
                type="checkbox"
                id="autoClearCache"
                checked={autoClearCache}
                onChange={(e) => setAutoClearCache(e.target.checked)}
                className="w-3 h-3 text-violet-600 border-slate-700 bg-slate-800 rounded focus:ring-violet-500/20 cursor-pointer"
              />
              <label htmlFor="autoClearCache" className="text-[9px] text-slate-400 select-none cursor-pointer hover:text-violet-300">
                🔄 Tự động dọn cache & Refresh Google Flow khi xong/lỗi
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAutoRun}
                className="flex-1 py-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1
                  bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500
                  text-white shadow-lg shadow-amber-500/20"
              >
                <Zap className="w-3.5 h-3.5" />
                {pendingActionType === 'i2v_pipeline' ? `Tạo ${pendingScenes.length} ảnh→video` 
                  : pendingActionType === 'generate_images' ? `Tạo ${pendingScenes.length} ảnh`
                  : `Tạo ${pendingScenes.length} video`}
              </button>
              <button
                onClick={handleReview}
                className="flex-1 py-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1
                  bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500
                  text-white shadow-lg shadow-emerald-500/20"
              >
                <Eye className="w-3.5 h-3.5" />
                Review trước
              </button>
            </div>
          </div>
        )}

        {/* Generating progress indicator */}
        {isGenerating && (
          <div className="px-3 py-3 border-t border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-orange-500/10 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                <div className="absolute inset-0 w-5 h-5 rounded-full bg-amber-400/20 animate-ping" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-amber-300 truncate">{genProgress || 'Đang tạo...'}</p>
                <p className="text-[8px] text-amber-400/60 mt-0.5">
                  {genPercent > 0 ? `${genPercent}% hoàn thành` : 'Đang xử lý...'}
                </p>
              </div>
              {genPercent > 0 && (
                <span className="text-[10px] font-bold text-amber-300">{genPercent}%</span>
              )}
              <button onClick={handleStop} className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500/40 border border-red-500/40 rounded-md text-[10px] text-red-400 hover:text-red-300 font-bold transition-all flex items-center gap-1 flex-shrink-0" title="Dừng tạo">
                <Square className="w-3 h-3 fill-current" /> Dừng
              </button>
            </div>
            <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: genPercent > 0 ? `${genPercent}%` : '15%' }}
              />
            </div>
          </div>
        )}

        {/* Retry failed prompts button */}
        {failedPrompts.length > 0 && !isGenerating && (
          <div className="px-3 py-2 border-t border-red-500/30 bg-red-500/5 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-red-400 font-semibold">
                ❌ {failedPrompts.length} prompt thất bại
              </span>
              <button
                onClick={retryFailed}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold
                  bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500
                  text-white shadow-lg transition-all"
              >
                🔄 Tạo lại {failedPrompts.length} ảnh
              </button>
            </div>
          </div>
        )}

        {/* Quick prompts */}
        {messages.length <= 1 && !isLoading && (
          <div className="px-3 py-2 border-t border-slate-800 flex-shrink-0">
            <p className="text-[9px] text-slate-600 mb-1.5">💡 Thử nhanh:</p>
            <div className="flex flex-wrap gap-1">
              {QUICK_PROMPTS.map((qp, idx) => (
                <button
                  key={idx}
                  onClick={() => sendMessage(qp)}
                  className="text-[9px] px-2 py-1 rounded-full bg-slate-800 text-slate-400 hover:text-violet-300 hover:bg-violet-500/10 border border-slate-700 hover:border-violet-500/30 transition-all"
                >
                  {qp}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Image previews */}
        {imagePreviews.length > 0 && (
          <div className="px-3 py-1.5 border-t border-slate-800 bg-slate-800/50 flex-shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {imagePreviews.map((preview, idx) => (
                <div key={idx} className="relative flex-shrink-0 group">
                  <img src={preview} alt={`upload-${idx}`} className="w-10 h-10 rounded-lg object-cover border border-slate-700" />
                  <button 
                    onClick={() => {
                      setImagePreviews(prev => prev.filter((_, i) => i !== idx));
                      setUploadedImages(prev => prev.filter((_, i) => i !== idx));
                    }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >✕</button>
                </div>
              ))}
              <span className="text-[9px] text-slate-400 ml-1">{imagePreviews.length} ảnh</span>
              <button 
                onClick={() => { setUploadedImages([]); setImagePreviews([]); }}
                className="text-[9px] text-red-400 hover:text-red-300 ml-auto"
              >Xóa hết</button>
            </div>
          </div>
        )}

        {/* Audio previews */}
        {uploadedAudios.length > 0 && (
          <div className="px-3 py-1.5 border-t border-slate-800 bg-slate-800/50 flex-shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {uploadedAudios.map((audio, idx) => (
                <div key={idx} className="relative flex-shrink-0 group bg-slate-900 border border-slate-700 rounded-lg py-1 px-2.5 flex items-center gap-1 text-[10px] text-slate-300">
                  <span>🎵 {audio.name}</span>
                  <button 
                    onClick={() => {
                      setUploadedAudios(prev => prev.filter((_, i) => i !== idx));
                    }}
                    className="w-3.5 h-3.5 bg-red-500/20 hover:bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center transition-all ml-1"
                  >✕</button>
                </div>
              ))}
              <span className="text-[9px] text-slate-400 ml-1">{uploadedAudios.length} âm thanh</span>
              <button 
                onClick={() => setUploadedAudios([])}
                className="text-[9px] text-red-400 hover:text-red-300 ml-auto"
              >Xóa hết</button>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-3 py-3 border-t border-slate-800 bg-slate-900/80 flex-shrink-0">
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
          <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a" multiple className="hidden" onChange={handleImageUpload} />
          {!hasKey ? (
            <div className="text-center py-2">
              <p className="text-[10px] text-amber-400">⚠️ Cần API key</p>
              <p className="text-[9px] text-slate-500">Settings → AI Director (Proxy) → API Key</p>
            </div>
          ) : (
            <div className="flex gap-2 items-end">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-2 py-2.5 rounded-xl bg-slate-800 hover:bg-violet-500/10 text-slate-500 hover:text-violet-400 transition-all flex-shrink-0 border border-slate-700 hover:border-violet-500/30"
                title="Tải ảnh sản phẩm"
              >
                <ImagePlus className="w-4 h-4" />
              </button>
              <button
                onClick={() => audioInputRef.current?.click()}
                className="px-2 py-2.5 rounded-xl bg-slate-800 hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-400 transition-all flex-shrink-0 border border-slate-700 hover:border-emerald-500/30"
                title="Tải MP3/WAV — Tạo video theo nhạc"
              >
                <Music className="w-4 h-4" />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={isLoading}
                className="flex-1 bg-slate-800 text-slate-200 text-xs px-3 py-2.5 rounded-xl border border-slate-700 focus:border-violet-500/50 focus:outline-none resize-none placeholder:text-slate-600 disabled:opacity-50"
                placeholder="Mô tả ý tưởng video..."
                style={{ minHeight: '40px', maxHeight: '100px' }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = 'auto';
                  t.style.height = Math.min(t.scrollHeight, 100) + 'px';
                }}
              />
              <button
                onClick={(isLoading || isGenerating) ? handleStop : () => sendMessage()}
                disabled={!isLoading && !isGenerating && !input.trim() && uploadedImages.length === 0 && uploadedAudios.length === 0}
                className={`p-2 rounded-lg transition-all flex-shrink-0 ${
                  (isLoading || isGenerating)
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-30 disabled:cursor-not-allowed'
                }`}
              >
                {(isLoading || isGenerating) ? <Square className="w-4 h-4 fill-current" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes bubbleIn { from { transform: scale(0.8) translateY(20px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        .animate-bubble-in { animation: bubbleIn 0.25s ease-out; }
      `}</style>

      {/* Story Picker Modal */}
      {showStoryPicker && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-violet-500/30 rounded-2xl shadow-2xl max-w-sm w-full max-h-[80%] overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-gradient-to-r from-amber-600/20 to-orange-600/20 border-b border-amber-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-bold text-amber-300">📖 Tạo tập tiếp theo</span>
              </div>
              <button onClick={() => setShowStoryPicker(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {savedStories.length === 0 ? (
                <div className="text-center text-slate-500 py-8">
                  <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Chưa có story nào.</p>
                  <p className="text-xs">Tạo story mới → tự lưu!</p>
                </div>
              ) : (
                savedStories.map((story) => (
                  <div key={story.project_id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 hover:border-amber-500/30 transition-all group">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-white truncate">{story.title}</h4>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                          <span>📺 {story.episodes} tập</span>
                          <span>👤 {story.characters} nhân vật</span>
                          <span>🎬 {story.total_scenes} cảnh</span>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteStory(story.project_id).then(() => setSavedStories(prev => prev.filter(s => s.project_id !== story.project_id)))}
                        className="text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-1"
                        title="Xóa"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="mt-2">
                      <input
                        type="text"
                        placeholder="Hướng phát triển tập mới (tùy chọn)..."
                        className="w-full text-xs bg-slate-900/50 border border-slate-700 rounded-lg px-2 py-1.5 text-white placeholder-slate-500 focus:border-amber-500/50 outline-none"
                        value={continueDirection}
                        onChange={e => setContinueDirection(e.target.value)}
                      />
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-500">Số cảnh:</span>
                        <select
                          value={continueSceneCount}
                          onChange={e => setContinueSceneCount(Number(e.target.value))}
                          className="text-xs bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-white outline-none"
                        >
                          {[3, 5, 7, 10].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <button
                        onClick={() => handleContinueStory(story.project_id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 rounded-lg text-xs font-bold text-white shadow-lg shadow-amber-500/20 transition-all hover:scale-105"
                      >
                        <ChevronRight className="w-3 h-3" />
                        Tạo tập {story.episodes + 1}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
