import { useState, useRef, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  Film, Users, Play, Square, Loader2, CheckCircle2, XCircle,
  Clock, Upload, X, Trash2, Plus, UserPlus, ChevronDown, ChevronUp,
} from 'lucide-react';
import { API } from '../../config';
import { useProjectStore } from '../../store/useProjectStore';

// ─── Types ──────────────────────────────────────────────
type BatchMode = 'text-to-video' | 'ref-to-video';

type PromptStatus = 'pending' | 'running' | 'done' | 'error';

interface BatchPrompt {
  id: string;
  text: string;
  status: PromptStatus;
  jobId?: string;
  error?: string;
}

interface ReferenceImage {
  file: File;
  preview: string;
  mediaId?: string;
  uploading?: boolean;
}

interface Character {
  id: string;
  name: string;
  images: ReferenceImage[];
  voice?: string;
  personality?: string;
  dialogSample?: string;
  entityId?: string;     // Created entity ID for R2V (from create-character API)
  creatingEntity?: boolean; // Whether entity creation is in progress
}

// ─── Constants ──────────────────────────────────────────
const VOICES = [
  { value: '', label: '🔇 Không có' },
  { value: 'Achernar', label: '🎤 Achernar' },
  { value: 'Achird', label: '🎤 Achird' },
  { value: 'Algenib', label: '🎤 Algenib' },
  { value: 'Algieba', label: '🎤 Algieba' },
  { value: 'Alnilam', label: '🎤 Alnilam' },
  { value: 'Aoede', label: '🎤 Aoede' },
  { value: 'Autonoe', label: '🎤 Autonoe' },
  { value: 'Callirrhoe', label: '🎤 Callirrhoe' },
  { value: 'Charon', label: '🎤 Charon' },
  { value: 'Despina', label: '🎤 Despina' },
  { value: 'Enceladus', label: '🎤 Enceladus' },
];

const T2V_MODELS = [
  // Quality
  { value: 'veo_3_1_t2v', label: '💎 Veo 3.1 Quality 8s (100cr)' },
  // Fast / Pro
  { value: 'veo_3_1_t2v_fast', label: '⭐ Veo 3.1 Pro (Fast) 8s (10cr)' },
  { value: 'veo_3_1_t2v_fast_4s', label: '⭐ Veo 3.1 Pro (Fast) 4s (10cr)' },
  { value: 'veo_3_1_t2v_fast_6s', label: '⭐ Veo 3.1 Pro (Fast) 6s (10cr)' },
  // Lite (5cr)
  { value: 'veo_3_1_t2v_lite', label: '🔵 Veo 3.1 Lite 8s (5cr)' },
  { value: 'veo_3_1_t2v_lite_4s', label: '🔵 Veo 3.1 Lite 4s (5cr)' },
  { value: 'veo_3_1_t2v_lite_6s', label: '🔵 Veo 3.1 Lite 6s (5cr)' },
  // Lite Low
  { value: 'veo_3_1_t2v_lite_low_priority', label: '🆓 Veo 3.1 Lite Low 8s (FREE)' },
  { value: 'veo_3_1_t2v_lite_4s_low_priority', label: '🆓 Veo 3.1 Lite Low 4s (FREE)' },
  { value: 'veo_3_1_t2v_lite_6s_low_priority', label: '🆓 Veo 3.1 Lite Low 6s (FREE)' },
  // Omni
  { value: 'abra_t2v_4s', label: '⚡ Omni Flash 4s' },
  { value: 'abra_t2v_6s', label: '⚡ Omni Flash 6s' },
  { value: 'abra_t2v_8s', label: '⚡ Omni Flash 8s' },
  { value: 'abra_t2v_10s', label: '⚡ Omni Flash 10s' },
];

const R2V_MODELS = [
  // Quality
  { value: 'veo_3_1_r2v', label: '💎 Veo 3.1 Quality 8s (100cr)' },
  // Fast / Pro
  { value: 'veo_3_1_r2v_fast_landscape', label: '⭐ Veo 3.1 Pro (Fast) 8s (10cr)' },
  // Lite (5cr)
  { value: 'veo_3_1_r2v_lite', label: '🔵 Veo 3.1 Lite 8s (5cr)' },
  // Lite Low
  { value: 'veo_3_1_r2v_lite_low_priority', label: '🆓 Veo 3.1 Lite Low 8s (FREE)' },
  // Omni
  { value: 'abra_r2v_10s', label: '⚡ Omni Flash 10s' },
];

const ASPECTS = [
  { value: 'VIDEO_ASPECT_RATIO_LANDSCAPE', label: '16:9' },
  { value: 'VIDEO_ASPECT_RATIO_PORTRAIT', label: '9:16' },
  { value: 'VIDEO_ASPECT_RATIO_SQUARE', label: '1:1' },
];

const parseModelOverride = (promptText: string, defaultModel: string, fallbackMode: string = 't2v'): { cleanPrompt: string; model: string } => {
  let cleanPrompt = promptText.trim();
  let model = defaultModel;

  const flagRegex = /\s*--(4s|5s|6s|8s|10s)\b/i;
  const bracketRegex = /\s*\[(4s|5s|6s|8s|10s)\]\s*/i;

  const resolveModelKey = (duration: string) => {
    let targetDuration = duration;
    if (targetDuration === '5s') {
      targetDuration = '6s';
    }

    // R2V mode only supports 8s (Veo 3.1) or 10s (Omni Flash)
    if (fallbackMode === 'r2v' || fallbackMode === 'ref-to-video') {
      if (!defaultModel) {
        return 'veo_3_1_r2v_lite_low_priority';
      }
      if (defaultModel.startsWith('abra_')) {
        return 'abra_r2v_10s';
      }
      return defaultModel.replace(/_(4s|6s)(_low_priority)?$/, '$2');
    }

    const isI2V = fallbackMode === 'i2v' || fallbackMode === 'image-to-video';

    // I2V FREE (low_priority) — inconsistent naming, use direct lookup
    if (isI2V && (!defaultModel || defaultModel.includes('low_priority'))) {
      const I2V_FREE: Record<string, string> = {
        '4s': 'veo_3_1_i2v_s_lite_4s_low_priority',
        '6s': 'veo_3_1_i2v_s_lite_6s_low_priority',
        '8s': 'veo_3_1_i2v_lite_low_priority',
      };
      return I2V_FREE[targetDuration] || defaultModel || 'veo_3_1_i2v_lite_low_priority';
    }

    // I2V paid lite — consistent _s_lite naming
    if (isI2V && defaultModel?.includes('_lite')) {
      const base = defaultModel.replace(/_s_lite(?:_4s|_6s)?/, '');
      return targetDuration === '8s' ? `${base}_s_lite` : `${base}_s_lite_${targetDuration}`;
    }

    if (!defaultModel) {
      // Determine standard Lite Low priority default model based on fallbackMode
      let base = 'veo_3_1_t2v_lite';
      if (fallbackMode === 'i2v' || fallbackMode === 'image-to-video') {
        base = 'veo_3_1_i2v_lite';
      }
      return targetDuration === '8s' ? `${base}_low_priority` : `${base}_${targetDuration}_low_priority`;
    }
    if (defaultModel.startsWith('abra_')) {
      return defaultModel.replace(/_(4s|6s|8s|10s)$/, `_${targetDuration}`);
    }
    if (defaultModel.includes('low_priority')) {
      const base = defaultModel.replace(/_lite(?:_4s|_6s)?_low_priority/, '');
      return targetDuration === '8s' ? `${base}_lite_low_priority` : `${base}_lite_${targetDuration}_low_priority`;
    }
    if (defaultModel.includes('_lite')) {
      const base = defaultModel.replace(/_lite(?:_4s|_6s)?/, '');
      return targetDuration === '8s' ? `${base}_lite` : `${base}_lite_${targetDuration}`;
    }
    if (defaultModel.includes('_fast')) {
      const base = defaultModel.replace(/(?:_ultra(?:_relaxed)?|_(4s|6s))$/, '');
      return targetDuration === '8s' ? base : `${base}_${targetDuration}`;
    }
    return defaultModel;
  };

  let match = cleanPrompt.match(flagRegex) || cleanPrompt.match(bracketRegex);
  if (match) {
    model = resolveModelKey(match[1].toLowerCase());
    // Strip the match from cleanPrompt
    cleanPrompt = cleanPrompt.replace(flagRegex, '').replace(bracketRegex, '').trim();
  }

  return { cleanPrompt, model };
};

// ─── Props ──────────────────────────────────────────────
interface BatchVideoPanelProps {
  onVideoCreated?: (jobId: string, prompt: string) => void;
}

// ─── Component ──────────────────────────────────────────
export default function BatchVideoPanel({ onVideoCreated }: BatchVideoPanelProps) {
  const settings = useProjectStore((s) => s.settings);
  const flowkitStatus = useProjectStore((s) => s.flowkitStatus);

  // Core state
  const [mode, setMode] = useState<BatchMode>('text-to-video');
  const [promptsText, setPromptsText] = useState('');
  const [concurrent, setConcurrent] = useState(2);
  const [aspectRatio, setAspectRatio] = useState('VIDEO_ASPECT_RATIO_LANDSCAPE');
  const [videoModel, setVideoModel] = useState('veo_3_1_t2v_fast_ultra_relaxed');
  const [upscaleQuality, setUpscaleQuality] = useState('720p'); // 720p = no upscale, 1080p, 4K
  const [autoClearCache, setAutoClearCache] = useState(() => {
    return localStorage.getItem('batch_auto_clear_cache') === 'true';
  });

  // Batch state
  const [queue, setQueue] = useState<BatchPrompt[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const cancelRef = useRef(false);
  const lastStartTimeRef = useRef<number>(0);
  const lastCompletionTimeRef = useRef<number>(0);

  // R2V Character state
  const [characters, setCharacters] = useState<Character[]>([]);
  const [newCharName, setNewCharName] = useState('');
  const [activeCharId, setActiveCharId] = useState<string | null>(null);
  const charImgRef = useRef<HTMLInputElement>(null);

  // Direct R2V reference images
  const [refImages, setRefImages] = useState<ReferenceImage[]>([]);
  const directRefImgRef = useRef<HTMLInputElement>(null);

  // Sections toggle
  const [showCharSection, setShowCharSection] = useState(true);
  const [showRefImgSection, setShowRefImgSection] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const models = mode === 'text-to-video' ? T2V_MODELS : R2V_MODELS;
  const promptLines = promptsText.split('\n').filter(l => l.trim());

  // ─── Upload ref image (for direct reference images only) ────
  const uploadRef = useCallback(async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', settings.flowkitProjectId);
    try {
      const res = await axios.post(API.uploadReference, formData);
      return res.data.success ? res.data.media_id : null;
    } catch {
      return null;
    }
  }, [settings.flowkitProjectId]);

  // ─── Character handlers ───────────────────────────────
  const addCharacter = () => {
    const name = newCharName.trim();
    if (!name) return;
    setCharacters(prev => [...prev, { id: `c_${Date.now()}`, name, images: [] }]);
    setNewCharName('');
  };

  const removeCharacter = (id: string) => setCharacters(prev => prev.filter(c => c.id !== id));

  // Add images to character: preview + upload as plain reference (mediaId fallback)
  const handleCharImages = useCallback(async (files: FileList | null) => {
    if (!files || !activeCharId) return;
    for (const file of Array.from(files)) {
      const preview = URL.createObjectURL(file);
      // Add image with uploading state
      setCharacters(prev => prev.map(c =>
        c.id === activeCharId ? { ...c, images: [...c.images, { file, preview, uploading: true }], entityId: undefined } : c
      ));
      // Upload as plain reference to get mediaId
      const mediaId = await uploadRef(file);
      setCharacters(prev => prev.map(c =>
        c.id === activeCharId
          ? { ...c, images: c.images.map(img => img.preview === preview ? { ...img, mediaId: mediaId || undefined, uploading: false } : img) }
          : c
      ));
    }
  }, [activeCharId, uploadRef]);

  // Create character entity via API (create-character endpoint)
  const createCharacterEntity = useCallback(async (charId: string) => {
    const char = characters.find(c => c.id === charId);
    if (!char || char.images.length === 0) {
      toast.error('Cần ít nhất 1 ảnh để tạo nhân vật');
      return;
    }

    setCharacters(prev => prev.map(c =>
      c.id === charId ? { ...c, creatingEntity: true, entityId: undefined } : c
    ));

    const toastId = toast.loading(`🎭 Tạo nhân vật "${char.name}"...`);

    try {
      const formData = new FormData();
      // Send all images as files
      char.images.forEach(img => {
        formData.append('files', img.file);
      });
      formData.append('display_name', char.name);
      formData.append('project_id', settings.flowkitProjectId);
      if (char.voice) {
        formData.append('voice', char.voice);
      }

      const res = await axios.post(API.createCharacter, formData, { timeout: 120000 });
      toast.dismiss(toastId);

      if (res.data.success && res.data.entity_id) {
        setCharacters(prev => prev.map(c =>
          c.id === charId ? { ...c, entityId: res.data.entity_id, creatingEntity: false } : c
        ));
        toast.success(`✅ Nhân vật "${char.name}" đã tạo!`);
      } else {
        const errMsg = typeof res.data.error === 'object' ? JSON.stringify(res.data.error) : res.data.error;
        toast.error(`❌ Lỗi: ${errMsg}`);
        setCharacters(prev => prev.map(c =>
          c.id === charId ? { ...c, creatingEntity: false } : c
        ));
      }
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(`❌ ${err?.response?.data?.detail || err.message}`);
      setCharacters(prev => prev.map(c =>
        c.id === charId ? { ...c, creatingEntity: false } : c
      ));
    }
  }, [characters, settings.flowkitProjectId]);

  const removeCharImage = (charId: string, preview: string) => {
    setCharacters(prev => prev.map(c =>
      c.id === charId ? { ...c, images: c.images.filter(img => img.preview !== preview), entityId: undefined } : c
    ));
  };

  const handleRefImageChange = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const preview = URL.createObjectURL(file);
      setRefImages(prev => [...prev, { file, preview, uploading: true }]);
      const mediaId = await uploadRef(file);
      setRefImages(prev => prev.map(img =>
        img.preview === preview ? { ...img, mediaId: mediaId || undefined, uploading: false } : img
      ));
    }
  }, [uploadRef]);

  const removeRefImage = (preview: string) => {
    setRefImages(prev => prev.filter(img => img.preview !== preview));
  };

  // ─── Generate single video ────────────────────────────
  const generateOne = async (prompt: string): Promise<{ jobId?: string; error?: string }> => {
    const { cleanPrompt, model: resolvedModel } = parseModelOverride(prompt, videoModel, mode);
    const payload: Record<string, unknown> = {
      prompt: cleanPrompt,
      project_id: settings.flowkitProjectId,
      video_model: resolvedModel,
      aspect_ratio: aspectRatio,
    };

    let endpoint: string = API.generateVideo;

    if (mode === 'ref-to-video') {
      const promptLower = prompt.toLowerCase();
      const matchedEntityIds: string[] = [];   // Character entities
      const matchedMediaIds: string[] = [];    // Plain image refs (direct + char images fallback)
      let matchedVoice: string | undefined = undefined;

      // 1. Check characters by name → entityId if available, else their image mediaIds
      characters.forEach(char => {
        if (promptLower.includes(char.name.toLowerCase())) {
          if (char.entityId) {
            matchedEntityIds.push(char.entityId);
          } else {
            // No entity → use uploaded image mediaIds as plain references
            char.images.forEach(img => {
              if (img.mediaId) matchedMediaIds.push(img.mediaId);
            });
          }
          if (char.voice) {
            matchedVoice = char.voice;
          }
        }
      });

      // 2. Check direct refImages by index or filename → collect media_ids
      refImages.forEach((img, idx) => {
        const indexPattern = new RegExp(`\\[ref_${idx}\\]|\\bref_${idx}\\b|image_${idx}\\.png|\\bimage_${idx}\\b`, 'i');
        const namePattern = img.file?.name ? promptLower.includes(img.file.name.toLowerCase()) : false;

        if (indexPattern.test(promptLower) || namePattern) {
          if (img.mediaId) matchedMediaIds.push(img.mediaId);
        }
      });

      // 3. Generic product/model placeholders
      if (promptLower.includes('product') || promptLower.includes('sản phẩm')) {
        if (refImages[0]?.mediaId) matchedMediaIds.push(refImages[0].mediaId);
      }
      if (promptLower.includes('model') || promptLower.includes('người mẫu')) {
        if (refImages[1]?.mediaId) matchedMediaIds.push(refImages[1].mediaId);
      }

      // Deduplicate
      let selectedEntityIds = [...new Set(matchedEntityIds)];
      let selectedMediaIds = [...new Set(matchedMediaIds)];

      // 4. Fallback if no matching refs found in prompt text
      if (selectedEntityIds.length === 0 && selectedMediaIds.length === 0) {
        // Collect all character entities or their image mediaIds
        characters.forEach(char => {
          if (char.entityId) {
            selectedEntityIds.push(char.entityId);
          } else {
            char.images.forEach(img => {
              if (img.mediaId) selectedMediaIds.push(img.mediaId);
            });
          }
        });
        // Collect all direct refImage media IDs
        refImages.forEach(img => {
          if (img.mediaId) selectedMediaIds.push(img.mediaId);
        });
        selectedEntityIds = [...new Set(selectedEntityIds)];
        selectedMediaIds = [...new Set(selectedMediaIds)];
      }

      const limit = (resolvedModel as string || '').startsWith('abra_') ? 7 : 3;
      if (selectedEntityIds.length > 0) {
        payload.entity_ids = selectedEntityIds.slice(0, limit);
      }
      if (selectedMediaIds.length > 0) {
        payload.reference_media_ids = selectedMediaIds.slice(0, limit);
      }
      if (matchedVoice) {
        payload.audio_voice_id = matchedVoice;
      }
      endpoint = API.generateR2V;
    }

    try {
      const res = await axios.post(endpoint, payload);
      if (res.data.success) {
        return { jobId: res.data.job_id };
      }
      const errMsg = typeof res.data.error === 'object' ? JSON.stringify(res.data.error) : (res.data.error || 'Unknown');
      return { error: errMsg };
    } catch (err: any) {
      return { error: err?.response?.data?.detail || err.message };
    }
  };

  // Helper to clear captcha cache and reload Flow tab
  const clearCacheAndWaitForReady = async () => {
    toast('⏳ Đang xoá cache và reload Flow tab...', { icon: '🔄' });
    try {
      await axios.post('/api/flowkit/clear-cache', { project_id: settings.flowkitProjectId });
    } catch (e) {
      console.error('Failed to trigger clear-cache:', e);
    }
    
    // Wait for extension to disconnect, reconnect and capture token
    toast('⏳ Đang chờ FlowAgent kết nối lại và lấy token...', { icon: '🔌' });
    
    const maxPollAttempts = 24; // 2 minutes max
    for (let i = 0; i < maxPollAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        const res = await axios.get(API.flowkitStatus);
        if (res.data.connected && res.data.flowKeyPresent) {
          toast.success('✅ FlowAgent đã kết nối và có token!');
          return true;
        }
      } catch (err) {
        console.error('Error checking status:', err);
      }
    }
    throw new Error('Không thể kết nối lại với FlowAgent hoặc thiếu token sau khi reload.');
  };

  // ─── Batch runner ─────────────────────────────────────
  // ─── Batch runner ─────────────────────────────────────
  const startBatch = async () => {
    if (promptLines.length === 0) { toast.error('Nhập ít nhất 1 prompt'); return; }
    if (flowkitStatus !== 'connected') { toast.error('FlowAgent chưa kết nối'); return; }

    if (mode === 'ref-to-video') {
      // Check for any available references: char entities, char images, or direct ref images
      const hasCharEntities = characters.some(c => c.entityId);
      const hasCharImages = characters.some(c => c.images.some(img => img.mediaId));
      const hasDirectImages = refImages.some(img => img.mediaId);
      if (!hasCharEntities && !hasCharImages && !hasDirectImages) {
        toast.error('Cần ít nhất 1 ảnh tham chiếu đã tải lên cho R2V');
        return;
      }
      const charsCreating = characters.some(c => c.creatingEntity);
      const charImagesUploading = characters.some(c => c.images.some(img => img.uploading));
      const directImagesUploading = refImages.some(img => img.uploading);
      if (charsCreating || charImagesUploading || directImagesUploading) {
        toast.error('Đang tải ảnh / tạo nhân vật, vui lòng đợi...');
        return;
      }
    }

    // Build queue
    const items: BatchPrompt[] = promptLines.map((text, i) => ({
      id: `bp_${Date.now()}_${i}`,
      text: text.trim(),
      status: 'pending' as PromptStatus,
    }));
    setQueue(items);
    setIsRunning(true);
    cancelRef.current = false;

    if (autoClearCache) {
      try {
        await clearCacheAndWaitForReady();
      } catch (err: any) {
        toast.error(err.message);
        setIsRunning(false);
        return;
      }
    }

    let idx = 0;
    let running = 0;
    const total = items.length;
    let consecutiveFailures = 0;
    let successesSinceLastClear = 0;
    let consecutive403 = 0;
    let isPausingForClearCache = false;

    const isOverloadMsg = (errText: any): boolean => {
      if (!errText) return false;
      const msg = String(errText).toLowerCase();
      return msg.includes('429') ||
             msg.includes('503') ||
             msg.includes('too many') ||
             msg.includes('rate limit') ||
             msg.includes('exhausted') ||
             msg.includes('overloaded') ||
             msg.includes('quota') ||
             msg.includes('capacity') ||
             msg.includes('busy') ||
             msg.includes('overload') ||
             msg.includes('resource');
    };

    const waitForJob = async (jobId: string, _itemIdx: number, timeoutMs = 180000): Promise<string> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (cancelRef.current) return 'CANCELLED';
        try {
          const res = await axios.get(`/api/generate/jobs/${jobId}`);
          const status = res.data.status;
          if (status === 'DONE' || status === 'FAILED') {
            return status;
          }
        } catch (err: any) {
          const errMsg = err?.response?.data?.detail || err.message || '';
          if (isOverloadMsg(errMsg) || err?.response?.status === 429 || err?.response?.status === 503) {
            await new Promise(r => setTimeout(r, 10000));
            continue;
          }
        }
        await new Promise(r => setTimeout(r, 5000));
      }
      return 'TIMEOUT';
    };

    const processNext = (): Promise<void> => {
      return new Promise<void>((resolve) => {
        const tick = async () => {
          if (isPausingForClearCache) return;
          while (idx < total && running < concurrent && !cancelRef.current && !isPausingForClearCache) {
            const current = idx;
            idx++;
            running++;

            // Mark running
            setQueue(prev => prev.map((p, i) => i === current ? { ...p, status: 'running' } : p));

            // Thread execution
            (async () => {
              // Space starting of parallel threads by 10s
              if (running > 1) {
                const elapsed = Date.now() - lastStartTimeRef.current;
                if (elapsed < 10000) {
                  await new Promise(r => setTimeout(r, 10000 - elapsed));
                }
              }
              lastStartTimeRef.current = Date.now();

              let jobId = '';
              let errorText = '';
              let renderSuccess = false;
              let attempt = 0;
              const maxAttempts = 3; // Max 3 render/polling retries

              while (attempt < maxAttempts && !renderSuccess) {
                if (cancelRef.current) break;

                if (attempt > 0) {
                  setQueue(prev => prev.map((p, i) => i === current
                    ? { ...p, error: `⏳ Thử lại lần ${attempt + 1}/${maxAttempts} (chờ 10s)...` }
                    : p
                  ));
                  await new Promise(r => setTimeout(r, 10000));
                }

                // 1. Submit job (with internal retry for temp errors like 403 or 429)
                let submissionSuccess = false;
                let subAttempts = 0;
                const maxSubAttempts = 5;
                jobId = '';

                while (subAttempts < maxSubAttempts) {
                  if (cancelRef.current) break;

                  // Space starting of parallel threads by 10s
                  if (running > 1) {
                    const elapsed = Date.now() - lastStartTimeRef.current;
                    if (elapsed < 10000) {
                      await new Promise(r => setTimeout(r, 10000 - elapsed));
                    }
                  }
                  lastStartTimeRef.current = Date.now();

                  // Parallel coordination: wait 15s since last completed request
                  if (lastCompletionTimeRef.current > 0) {
                    const elapsed = Date.now() - lastCompletionTimeRef.current;
                    if (elapsed < 15000) {
                      await new Promise(r => setTimeout(r, 15000 - elapsed));
                    }
                  }

                  try {
                    const res = await generateOne(items[current].text);
                    if (res.jobId) {
                      jobId = res.jobId;
                      consecutive403 = 0;
                      submissionSuccess = true;
                      break;
                    } else {
                      throw new Error(res.error || 'Generation failed');
                    }
                  } catch (err: any) {
                    const errMsg = err?.response?.data?.detail || err.message || '';
                    const is403 = err?.response?.status === 403 || String(errMsg).includes('403');
                    
                    if (is403) {
                      consecutive403++;
                      if (consecutive403 >= 5) {
                        toast('⚠️ Phát hiện lỗi 403 captcha 5 lần liên tiếp. Đang dọn cache & reload...', { duration: 5000 });
                        try {
                          await clearCacheAndWaitForReady();
                          consecutive403 = 0;
                          subAttempts--;
                          continue;
                        } catch (clearErr: any) {
                          toast.error('Lỗi khi tự dọn cache captcha: ' + clearErr.message);
                        }
                      }
                    } else {
                      consecutive403 = 0;
                    }

                    if (isOverloadMsg(errMsg) || err?.response?.status === 429 || err?.response?.status === 503) {
                      setQueue(prev => prev.map((p, i) => i === current
                        ? { ...p, error: `⏳ Server quá tải. Chờ 30s...` }
                        : p
                      ));
                      await new Promise(r => setTimeout(r, 30000));
                      subAttempts--;
                      continue;
                    }
                    errorText = errMsg;
                    subAttempts++;
                    if (subAttempts < maxSubAttempts) {
                      await new Promise(r => setTimeout(r, 10000));
                    }
                  }
                }

                lastCompletionTimeRef.current = Date.now();

                if (!submissionSuccess || !jobId) {
                  attempt++;
                  continue;
                }

                // 2. Poll for job status
                setQueue(prev => prev.map((p, i) => i === current
                  ? { ...p, status: 'running', jobId, error: `⏳ Đã gửi — đang render trên máy chủ...` }
                  : p
                ));

                onVideoCreated?.(jobId, items[current].text);

                // Increase timeout to 300000ms (5 minutes)
                const status = await waitForJob(jobId, current, 300000);
                lastCompletionTimeRef.current = Date.now();

                if (status === 'DONE') {
                  consecutiveFailures = 0;
                  successesSinceLastClear++;

                  if (autoClearCache && successesSinceLastClear >= 50) {
                    isPausingForClearCache = true;
                    toast('⏸️ Đạt 50 video. Đang đợi các luồng hiện tại hoàn thành để xoá cache...', { icon: '⏳' });
                  }

                  // Auto-upscale if quality > 720p
                  if (upscaleQuality !== '720p' && jobId) {
                    try {
                      const jobRes = await axios.get(`/api/generate/jobs/${jobId}`);
                      const mediaId = jobRes.data?.media_id || jobRes.data?.primary_media_id;
                      if (mediaId) {
                        setQueue(prev => prev.map((p, i) => i === current
                          ? { ...p, error: `📈 Upscale → ${upscaleQuality}...` }
                          : p
                        ));
                        const upRes = await axios.post('/api/generate/upscale-video', {
                          media_id: mediaId,
                          project_id: settings.flowkitProjectId,
                          resolution: upscaleQuality,
                          aspect_ratio: aspectRatio,
                        });
                        if (upRes.data?.success) {
                          const upStart = Date.now();
                          while (Date.now() - upStart < 300000) {
                            if (cancelRef.current) break;
                            const stRes = await axios.post('/api/generate/upscale-video/status', {
                              media_id: mediaId,
                              project_id: settings.flowkitProjectId,
                              resolution: upscaleQuality,
                            });
                            if (stRes.data?.status === 'done') {
                              toast.success(`✅ Video ${current + 1} upscale ${upscaleQuality} xong!`);
                              break;
                            } else if (stRes.data?.status === 'failed') {
                              toast.error(`⚠️ Video ${current + 1} upscale thất bại`);
                              break;
                            }
                            await new Promise(r => setTimeout(r, 5000));
                          }
                        }
                      }
                    } catch (upErr: any) {
                      console.error('Auto-upscale error:', upErr);
                    }
                  }

                  setQueue(prev => prev.map((p, i) => i === current
                    ? { ...p, status: 'done', error: undefined }
                    : p
                  ));
                  toast.success(`✅ Video ${current + 1} xong!`);
                  renderSuccess = true;
                  await new Promise(r => setTimeout(r, 5000));
                } else {
                  consecutiveFailures++;
                  errorText = `Render ${status === 'FAILED' ? 'thất bại' : 'quá hạn (5 phút)'}`;
                  toast.error(`❌ Video ${current + 1} render ${status === 'FAILED' ? 'thất bại' : 'quá hạn'}!`);

                  if (consecutiveFailures >= 3) {
                    cancelRef.current = true;
                    toast.error('❌ Dừng Batch ngay lập tức do 3 prompt liên tiếp thất bại!');
                    break;
                  } else {
                    attempt++;
                    await new Promise(r => setTimeout(r, 15000));
                  }
                }
              }

              if (!renderSuccess && !cancelRef.current) {
                setQueue(prev => prev.map((p, i) => i === current
                  ? { ...p, status: 'error', error: errorText }
                  : p
                ));
                toast.error(`❌ Video ${current + 1} lỗi sau 3 lần tạo lại: ${errorText}`);
              }

              running--;
              if (isPausingForClearCache && running === 0) {
                try {
                  await clearCacheAndWaitForReady();
                  successesSinceLastClear = 0;
                  isPausingForClearCache = false;
                  tick();
                } catch (err: any) {
                  toast.error(err.message);
                  cancelRef.current = true;
                  resolve();
                  return;
                }
              } else if (!cancelRef.current) {
                tick();
              }
              if (running === 0 && (idx >= total || cancelRef.current)) resolve();
            })();
          }

          if (running === 0) resolve();
        };
        tick();
      });
    };

    await processNext();
    setIsRunning(false);
    if (!cancelRef.current) {
      toast.success(`Batch xong! ${items.length} video`);
    }
  };

  const cancelBatch = () => {
    cancelRef.current = true;
    setIsRunning(false);
    toast('Đã dừng batch');
  };

  const doneCount = queue.filter(p => p.status === 'done').length;
  const errorCount = queue.filter(p => p.status === 'error').length;
  const progress = queue.length > 0 ? Math.round((doneCount / queue.length) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-slate-900/80 border-l border-slate-800/80">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex items-center gap-2">
        <Film className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-bold text-slate-200">Batch Video</span>
        <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded ml-auto">
          {promptLines.length} prompts
        </span>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Mode selector */}
        <div className="flex rounded-lg overflow-hidden border border-slate-700">
          <button
            onClick={() => { setMode('text-to-video'); setVideoModel('veo_3_1_t2v_fast_ultra_relaxed'); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all ${
              mode === 'text-to-video'
                ? 'bg-emerald-500/20 text-emerald-300 border-r border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-300 border-r border-slate-700'
            }`}
          >
            <Film className="w-3.5 h-3.5" /> T2V
          </button>
          <button
            onClick={() => { setMode('ref-to-video'); setVideoModel('veo_3_1_r2v_fast_landscape_ultra_relaxed'); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all ${
              mode === 'ref-to-video'
                ? 'bg-rose-500/20 text-rose-300'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> R2V
          </button>
        </div>

        {/* R2V Characters and Reference Images */}
        {mode === 'ref-to-video' && (
          <div className="space-y-3">
            {/* Characters section */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowCharSection(!showCharSection)}
                className="w-full flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider"
              >
                <span className="flex items-center gap-1.5"><UserPlus className="w-3 h-3" /> Nhân vật ({characters.length})</span>
                {showCharSection ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              {showCharSection && (
                <div className="space-y-2">
                  {/* Add character */}
                  <div className="flex gap-1.5">
                    <input
                      value={newCharName}
                      onChange={(e) => setNewCharName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addCharacter()}
                      className="flex-1 bg-slate-950 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 focus:border-rose-500 focus:outline-none placeholder:text-slate-600"
                      placeholder="Tên nhân vật..."
                    />
                    <button
                      type="button"
                      onClick={addCharacter}
                      disabled={!newCharName.trim()}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25 text-xs disabled:opacity-40 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Character cards */}
                  {characters.map((char) => (
                    <div key={char.id} className={`bg-slate-950/60 rounded-lg border p-2.5 space-y-2 ${char.entityId ? 'border-emerald-500/40' : 'border-slate-700/50'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${char.entityId ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                          <span className="text-xs font-medium text-slate-200">{char.name}</span>
                          {char.entityId && <span className="text-[8px] bg-emerald-500/20 text-emerald-300 px-1 py-0.5 rounded">✅</span>}
                          {char.voice && <span className="text-[8px] bg-indigo-500/20 text-indigo-300 px-1 py-0.5 rounded">🎤</span>}
                        </div>
                        <button type="button" onClick={() => removeCharacter(char.id)} className="p-0.5 text-slate-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                      </div>

                      {/* Images */}
                      <div className="flex flex-wrap gap-1">
                        {char.images.map((img) => (
                          <div key={img.preview} className="relative group w-12 h-12 rounded overflow-hidden border border-slate-700">
                            <img src={img.preview} className="w-full h-full object-cover" alt="" />
                            {img.uploading && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <Loader2 className="w-3 h-3 text-rose-400 animate-spin" />
                              </div>
                            )}
                            {img.mediaId && <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400" />}
                            <button
                              type="button"
                              onClick={() => removeCharImage(char.id, img.preview)}
                              className="absolute top-0.5 left-0.5 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100"
                            >
                              <X className="w-2 h-2" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => { setActiveCharId(char.id); charImgRef.current?.click(); }}
                          className="w-12 h-12 rounded border-2 border-dashed border-slate-700 hover:border-rose-500/50 flex flex-col items-center justify-center text-slate-500 hover:text-rose-400 text-[7px]"
                        >
                          <Upload className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Create Entity Button (optional - for voice/reuse) */}
                      {char.images.length > 0 && !char.entityId && char.images.every(img => img.mediaId) && (
                        <button
                          type="button"
                          onClick={() => createCharacterEntity(char.id)}
                          disabled={char.creatingEntity}
                          title="Tùy chọn: Tạo entity để dùng voice/reuse. Nếu không tạo, ảnh vẫn được dùng làm tham chiếu."
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 text-[10px] font-medium disabled:opacity-50 transition-all"
                        >
                          {char.creatingEntity ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Đang tạo...</>
                          ) : (
                            <><UserPlus className="w-3 h-3" /> Tạo Entity (có Voice)</>
                          )}
                        </button>
                      )}
                      {char.entityId && (
                        <p className="text-[8px] text-emerald-400/70 font-mono truncate">Entity: {char.entityId.slice(0, 20)}...</p>
                      )}

                      {/* Voice & Personality */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={char.voice || ''}
                          onChange={(e) => setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, voice: e.target.value || undefined } : c))}
                          className="bg-slate-950 text-slate-300 text-[10px] px-1.5 py-1 rounded border border-slate-700 focus:outline-none"
                        >
                          {VOICES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                        </select>
                        <input
                          value={char.personality || ''}
                          onChange={(e) => setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, personality: e.target.value } : c))}
                          className="bg-slate-950 text-slate-300 text-[10px] px-1.5 py-1 rounded border border-slate-700 focus:outline-none placeholder:text-slate-600"
                          placeholder="Tính cách..."
                        />
                      </div>
                    </div>
                  ))}

                  <input
                    ref={charImgRef}
                    type="file" className="hidden" accept="image/*" multiple
                    onChange={(e) => { handleCharImages(e.target.files); if (e.target) e.target.value = ''; }}
                  />
                </div>
              )}
            </div>

            {/* Direct Reference Images Section */}
            <div className="space-y-2 border-t border-slate-800/40 pt-2.5">
              <button
                type="button"
                onClick={() => setShowRefImgSection(!showRefImgSection)}
                className="w-full flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider"
              >
                <span className="flex items-center gap-1.5">
                  <Upload className="w-3 h-3" /> Ảnh tham chiếu ({refImages.length})
                </span>
                {showRefImgSection ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              {showRefImgSection && (
                <div className="bg-slate-950/40 rounded-lg border border-slate-700/30 p-2.5 space-y-2">
                  <p className="text-[9px] text-slate-500 leading-normal">
                    Gõ <code className="text-rose-400/90 font-mono">ref_0</code>, <code className="text-rose-400/90 font-mono">ref_1</code>,... hoặc tên file trong prompt để lấy tối đa 3 ảnh/video.
                  </p>
                  
                  <div className="flex flex-wrap gap-1">
                    {refImages.map((img, idx) => (
                      <div key={img.preview} className="relative group w-12 h-12 rounded overflow-hidden border border-slate-700" title={img.file?.name}>
                        <img src={img.preview} className="w-full h-full object-cover" alt="" />
                        {img.uploading && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <Loader2 className="w-3 h-3 text-rose-400 animate-spin" />
                          </div>
                        )}
                        {img.mediaId && <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400" />}
                        <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-[8px] text-slate-300 px-1 py-0.2 rounded font-mono">
                          ref_{idx}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeRefImage(img.preview)}
                          className="absolute top-0.5 left-0.5 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    
                    <button
                      type="button"
                      onClick={() => directRefImgRef.current?.click()}
                      className="w-12 h-12 rounded border-2 border-dashed border-slate-700 hover:border-rose-500/50 flex flex-col items-center justify-center text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  <input
                    ref={directRefImgRef}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    multiple
                    onChange={(e) => { handleRefImageChange(e.target.files); if (e.target) e.target.value = ''; }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Prompts textarea */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">
            Prompts (mỗi dòng 1 video)
          </label>
          <textarea
            value={promptsText}
            onChange={(e) => setPromptsText(e.target.value)}
            rows={6}
            className="w-full bg-slate-950 text-slate-200 text-xs p-2.5 rounded-lg border border-slate-700 focus:border-indigo-500 focus:outline-none resize-none font-mono leading-relaxed placeholder:text-slate-600"
            placeholder={"Cảnh 1: Nhân vật đi trong mưa...\nCảnh 2: Nhân vật ngồi quán café...\nCảnh 3: Nhân vật chạy dọc bờ biển..."}
          />
        </div>

        {/* Settings */}
        <div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider"
          >
            <span>⚙️ Cài đặt</span>
            {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showSettings && (
            <div className="mt-2 space-y-2">
              {/* Concurrent */}
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-400">Số luồng:</label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setConcurrent(n)}
                      className={`w-6 h-6 rounded text-[10px] font-bold transition-all ${
                        concurrent === n
                          ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/50'
                          : 'bg-slate-800 text-slate-500 border border-slate-700 hover:text-slate-300'
                      }`}
                    >{n}</button>
                  ))}
                </div>
              </div>

              {/* Aspect Ratio */}
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-400">Tỷ lệ:</label>
                <div className="flex gap-1">
                  {ASPECTS.map(a => (
                    <button
                      key={a.value}
                      onClick={() => setAspectRatio(a.value)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        aspectRatio === a.value
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800 text-slate-500 border border-slate-700 hover:text-slate-300'
                      }`}
                    >{a.label}</button>
                  ))}
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">Model:</label>
                <select
                  value={videoModel}
                  onChange={(e) => setVideoModel(e.target.value)}
                  className="w-full bg-slate-950 text-slate-300 text-[11px] px-2 py-1.5 rounded-lg border border-slate-700 focus:outline-none"
                >
                  {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>

              {/* Upscale Quality */}
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-slate-400">Chất lượng:</label>
                <div className="flex gap-1">
                  {[{v: '720p', l: '720p'}, {v: '1080p', l: '1080p'}, {v: '4K', l: '4K'}].map(q => (
                    <button
                      key={q.v}
                      onClick={() => setUpscaleQuality(q.v)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        upscaleQuality === q.v
                          ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                          : 'bg-slate-800 text-slate-500 border border-slate-700 hover:text-slate-300'
                      }`}
                    >{q.l}</button>
                  ))}
                </div>
              </div>

              {/* Auto Clear Cache */}
              <div className="flex items-center justify-between border-t border-slate-800/30 pt-2">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-300 font-medium">Auto xoá cache captcha</span>
                  <span className="text-[8px] text-slate-500">Mỗi 50 video & trước khi chạy</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newVal = !autoClearCache;
                    setAutoClearCache(newVal);
                    localStorage.setItem('batch_auto_clear_cache', String(newVal));
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    autoClearCache ? 'bg-indigo-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      autoClearCache ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Queue / Progress */}
        {queue.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase">
                Progress: {doneCount}/{queue.length}
              </span>
              {errorCount > 0 && (
                <span className="text-[10px] text-red-400">{errorCount} lỗi</span>
              )}
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500 ease-out rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Prompt list */}
            <div className="max-h-40 overflow-y-auto space-y-1">
              {queue.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-[11px] py-1 px-2 rounded bg-slate-950/50">
                  {p.status === 'pending' && <Clock className="w-3 h-3 text-slate-500 shrink-0" />}
                  {p.status === 'running' && <Loader2 className="w-3 h-3 text-amber-400 animate-spin shrink-0" />}
                  {p.status === 'done' && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                  {p.status === 'error' && <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                  <span className={`truncate ${p.status === 'done' ? 'text-slate-400' : p.status === 'error' ? 'text-red-300' : 'text-slate-300'}`}>
                    {p.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer — Start/Cancel */}
      <div className="px-4 py-3 border-t border-slate-800/80">
        {isRunning ? (
          <button
            onClick={cancelBatch}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600/20 border border-red-500/40 text-red-300 hover:bg-red-600/30 text-xs font-semibold transition-all"
          >
            <Square className="w-3.5 h-3.5" /> Dừng Batch
          </button>
        ) : (
          <button
            onClick={startBatch}
            disabled={promptLines.length === 0 || flowkitStatus !== 'connected'}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5" /> Bắt đầu ({promptLines.length} video)
          </button>
        )}
      </div>
    </div>
  );
}
