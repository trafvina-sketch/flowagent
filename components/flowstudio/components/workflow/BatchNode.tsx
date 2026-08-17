import { useState, useRef, useContext, useEffect, useMemo } from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import {
  Film, Play, Square, Loader2, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronUp, Settings, Users, Camera, Shuffle, Mic, Volume2
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { API, resolveMediaUrl } from '../../config';
import { useProjectStore } from '../../store/useProjectStore';
import { WorkflowContext } from './WorkflowContext';

type PromptStatus = 'pending' | 'uploading' | 'creating' | 'submitted' | 'done' | 'error';
interface QueueItem { id: string; text: string; status: PromptStatus; jobId?: string; error?: string; stepLabel?: string }

// ── Model lookup table: mode → tier → duration → model_key ──
const MODEL_MAP: Record<string, Record<string, Record<string, string>>> = {
  i2v: {
    quality: { '8s': 'veo_3_1_i2v_s' },
    pro: { '8s': 'veo_3_1_i2v_s_fast', '4s': 'veo_3_1_i2v_s_fast_4s', '6s': 'veo_3_1_i2v_s_fast_6s' },
    lite: { '8s': 'veo_3_1_i2v_s_lite', '4s': 'veo_3_1_i2v_s_lite_4s', '6s': 'veo_3_1_i2v_s_lite_6s' },
    free: { '8s': 'veo_3_1_i2v_lite_low_priority', '4s': 'veo_3_1_i2v_s_lite_4s_low_priority', '6s': 'veo_3_1_i2v_s_lite_6s_low_priority' },
    omni: { '4s': 'abra_i2v_4s', '6s': 'abra_i2v_6s', '8s': 'abra_i2v_8s', '10s': 'abra_i2v_10s' },
  },
  t2v: {
    quality: { '8s': 'veo_3_1_t2v' },
    pro: { '8s': 'veo_3_1_t2v_fast', '4s': 'veo_3_1_t2v_fast_4s', '6s': 'veo_3_1_t2v_fast_6s' },
    lite: { '8s': 'veo_3_1_t2v_lite', '4s': 'veo_3_1_t2v_lite_4s', '6s': 'veo_3_1_t2v_lite_6s' },
    free: { '8s': 'veo_3_1_t2v_lite_low_priority', '4s': 'veo_3_1_t2v_lite_4s_low_priority', '6s': 'veo_3_1_t2v_lite_6s_low_priority' },
    omni: { '4s': 'abra_t2v_4s', '6s': 'abra_t2v_6s', '8s': 'abra_t2v_8s', '10s': 'abra_t2v_10s' },
  },
  r2v: {
    quality: { '8s': 'veo_3_1_r2v' },
    pro: { '8s': 'veo_3_1_r2v_fast_landscape' },
    lite: { '8s': 'veo_3_1_r2v_lite' },
    free: { '8s': 'veo_3_1_r2v_lite_low_priority' },
    omni: { '10s': 'abra_r2v_10s' },
  },
};

const BATCH_TIERS = [
  { key: 'quality', label: '💎', desc: '100cr', color: 'text-purple-300 bg-purple-500/25 border-purple-500/50' },
  { key: 'pro', label: '⭐', desc: '10cr', color: 'text-amber-300 bg-amber-500/25 border-amber-500/50' },
  { key: 'lite', label: '🔵', desc: '5cr', color: 'text-blue-300 bg-blue-500/25 border-blue-500/50' },
  { key: 'free', label: '🆓', desc: 'FREE', color: 'text-emerald-300 bg-emerald-500/25 border-emerald-500/50' },
  { key: 'omni', label: '⚡', desc: 'Omni', color: 'text-yellow-300 bg-yellow-500/25 border-yellow-500/50' },
];

const ALL_DURATIONS = ['4s', '6s', '8s', '10s'];

function getAvailDurations(m: string, t: string): string[] {
  return Object.keys(MODEL_MAP[m]?.[t] || {});
}

// Reverse lookup: model_key → { tier, duration }
function reverseModelLookup(modeKey: string, modelKey: string): { tier: string; duration: string } | null {
  const tiers = MODEL_MAP[modeKey];
  if (!tiers) return null;
  for (const [tier, durations] of Object.entries(tiers)) {
    for (const [duration, key] of Object.entries(durations)) {
      if (key === modelKey) return { tier, duration };
    }
  }
  return null;
}

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

    const isI2V = fallbackMode === 'i2v' || fallbackMode === 'image-to-video';

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
      return targetDuration === '8s' ? 'veo_3_1_t2v_lite_low_priority' : `veo_3_1_t2v_lite_${targetDuration}_low_priority`;
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

const VOICES = [
  { value: '', label: '🔇 Không voice' },
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

export default function BatchNode({ id, data, selected }: { id: string; data: any; selected?: boolean }) {
  const settings = useProjectStore((s) => s.settings);
  const flowkitStatus = useProjectStore((s) => s.flowkitStatus);
  const { onDeleteNode, onBatchVideoCreated } = useContext(WorkflowContext);
  const { setNodes } = useReactFlow();

  const [mode, setMode] = useState<'t2v' | 'i2v' | 'r2v'>(data.mode || 't2v');
  const [prompts, setPrompts] = useState(data.prompts || '');
  const [concurrent, setConcurrent] = useState(data.concurrent || 2);
  const [aspect, setAspect] = useState('VIDEO_ASPECT_RATIO_LANDSCAPE');
  const [upscaleQuality, setUpscaleQuality] = useState('720p'); // 720p = no upscale
  const [shouldAutoRun, setShouldAutoRun] = useState(false);
  const [autoClearCache, setAutoClearCache] = useState(() => {
    return localStorage.getItem('batch_auto_clear_cache') === 'true';
  });

  // Receive prompts + mode + model + aspect from AgentPanel
  useEffect(() => {
    if (data.agentPrompts && Array.isArray(data.agentPrompts) && data.agentPrompts.length > 0) {
      setPrompts(data.agentPrompts.join('\n'));
      if (data.mode) setMode(data.mode);
      if (data.agentModel) {
        const modeKey = data.mode || mode;
        const lookup = reverseModelLookup(modeKey, data.agentModel);
        if (lookup) {
          setBTier(lookup.tier);
          setBDuration(lookup.duration);
        }
      }
      if (data.agentAspect) setAspect(data.agentAspect);
      if (data.agentAutoExecute) setShouldAutoRun(true);
      data.agentPrompts = null;
      data.agentAutoExecute = null;
      data.agentModel = null;
      data.agentAspect = null;
    }
  }, [data.agentPrompts]);

  const [bTier, setBTier] = useState('free');
  const [bDuration, setBDuration] = useState<string>('8s');
  const [showSettings, setShowSettings] = useState(false);
  const [audioVoiceId, setAudioVoiceId] = useState((data.audioVoiceId as string) || '');
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };
  }, []);

  // Compute model key from mode + tier + duration
  const availDurations = useMemo(() => getAvailDurations(mode, bTier), [mode, bTier]);
  const model = useMemo(() => {
    if (bDuration === 'random') {
      // For random, resolve a random duration each render (will be re-resolved per prompt in generate)
      const avail = getAvailDurations(mode, bTier);
      if (avail.length > 0) {
        const d = avail[Math.floor(Math.random() * avail.length)];
        return MODEL_MAP[mode]?.[bTier]?.[d] || '';
      }
      return '';
    }
    return MODEL_MAP[mode]?.[bTier]?.[bDuration] || '';
  }, [mode, bTier, bDuration]);

  // Resolve model for a single prompt (handles random per-prompt)
  const resolveCurrentModel = (): string => {
    if (bDuration === 'random') {
      const avail = getAvailDurations(mode, bTier);
      if (avail.length > 0) {
        const d = avail[Math.floor(Math.random() * avail.length)];
        return MODEL_MAP[mode]?.[bTier]?.[d] || '';
      }
      return '';
    }
    return MODEL_MAP[mode]?.[bTier]?.[bDuration] || '';
  };

  // Helper: change mode and auto-fix tier/duration
  const handleModeChange = (newMode: 't2v' | 'i2v' | 'r2v') => {
    setMode(newMode);
    const avail = getAvailDurations(newMode, bTier);
    if (avail.length === 0) {
      // Current tier not available, find first available
      for (const t of BATCH_TIERS) {
        const ta = getAvailDurations(newMode, t.key);
        if (ta.length > 0) {
          setBTier(t.key);
          if (bDuration !== 'random' && !ta.includes(bDuration)) setBDuration(ta.includes('8s') ? '8s' : ta[0]);
          return;
        }
      }
    } else if (bDuration !== 'random' && !avail.includes(bDuration)) {
      setBDuration(avail.includes('8s') ? '8s' : avail[0]);
    }
  };

  const previewVoice = () => {
    if (!audioVoiceId) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
      return;
    }

    const audio = new Audio(resolveMediaUrl(`/voices/${audioVoiceId}.wav`));
    audioRef.current = audio;
    setIsPlaying(true);
    audio.play().catch(() => toast.error('Không phát được audio'));
    audio.onended = () => { setIsPlaying(false); audioRef.current = null; };
    audio.onerror = () => { setIsPlaying(false); audioRef.current = null; toast.error('File voice không tồn tại'); };
  };

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setIsPlaying(false);
  };

  const handleTierChange = (t: string) => {
    const avail = getAvailDurations(mode, t);
    if (avail.length === 0) return;
    setBTier(t);
    if (bDuration !== 'random' && !avail.includes(bDuration)) {
      setBDuration(avail.includes('8s') ? '8s' : avail[0]);
    }
  };

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const cancelRef = useRef(false);
  const lastStartTimeRef = useRef<number>(0);
  const lastCompletionTimeRef = useRef<number>(0);
  const fileMediaIdCache = useRef<Record<string, string>>({});

  // Poll job status for submitted queue items
  useEffect(() => {
    const submittedItems = queue.filter(q => q.status === 'submitted' && q.jobId);
    if (submittedItems.length === 0) return;

    const interval = setInterval(async () => {
      try {
        const res = await axios.get('/api/generate/jobs');
        const jobs = res.data?.jobs || [];
        
        let hasChanges = false;
        const updatedQueue = queue.map(q => {
          if (q.status === 'submitted' && q.jobId) {
            const job = jobs.find((j: any) => j.id === q.jobId);
            if (job) {
              if (job.status === 'DONE') {
                hasChanges = true;
                return {
                  ...q,
                  status: 'done' as PromptStatus,
                  stepLabel: '✅ Render hoàn tất!',
                };
              } else if (job.status === 'FAILED') {
                hasChanges = true;
                return {
                  ...q,
                  status: 'error' as PromptStatus,
                  stepLabel: `❌ Render thất bại!`,
                };
              }
            }
          }
          return q;
        });

        if (hasChanges) {
          setQueue(updatedQueue);
        }
      } catch (err) {
        console.warn('[BatchNode Poll] Error:', err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [queue]);

  const lines = prompts.split('\n').filter((l: string) => l.trim());
  // models variable no longer needed — model computed from MODEL_MAP
  const doneCount = queue.filter(q => q.status === 'done' || q.status === 'submitted').length;
  const progress = queue.length > 0 ? Math.round((doneCount / queue.length) * 100) : 0;

  // Get upstream character media IDs from connected CharacterNodes
  const getCharMediaIds = (): string[] => {
    return data.getUpstreamCharacters ? data.getUpstreamCharacters(id) : [];
  };

  // Get upstream entity IDs from connected CharacterNodes
  const getEntityIds = (): string[] => {
    return data.getUpstreamEntityIds ? data.getUpstreamEntityIds(id) : [];
  };

  // Get upstream image media IDs from connected ImageNodes (single)
  const getUpstreamImageMediaId = (): string | null => {
    return data.getUpstreamImageMediaId ? data.getUpstreamImageMediaId(id) : null;
  };

  // Get upstream ImageUploadNode ID
  const getUpstreamImageUploadNodeId = (): string | null => {
    return data.getUpstreamImageUploadNodeId ? data.getUpstreamImageUploadNodeId(id) : null;
  };

  // Get upstream character details (including media IDs and entities)
  const getCharacterDetails = (): { name: string; entityId: string; mediaIds: string[]; voice?: string }[] => {
    return data.getUpstreamCharacterDetails ? data.getUpstreamCharacterDetails(id) : [];
  };

  // Get upstream character entities with names (for name matching in prompt)
  const getCharacterEntities = (): { name: string; entityId: string }[] => {
    return data.getUpstreamCharacterEntities ? data.getUpstreamCharacterEntities(id) : [];
  };

  // Upload a single file and return media_id (unused)
  /*
  const uploadFile = async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', settings.flowkitProjectId);
    try {
      const res = await axios.post(API.uploadStartImage, formData);
      if (res.data.success && res.data.media_id) return res.data.media_id;
      console.warn('[I2V Upload] Failed:', res.data);
      return null;
    } catch (err: any) {
      console.warn('[I2V Upload] Error:', err?.response?.data || err.message);
      return null;
    }
  };
  */

  const generateOne = async (prompt: string, imageMediaId?: string, r2vRefMediaIds?: string[]): Promise<{ jobId?: string; error?: string }> => {
    const currentModel = resolveCurrentModel();
    const { cleanPrompt, model: resolvedModel } = parseModelOverride(prompt, currentModel, mode);
    console.log(`[BatchNode generateOne] defaultModel=${currentModel}, resolvedModel=${resolvedModel}, mode=${mode}`);
    const payload: Record<string, unknown> = {
      prompt: cleanPrompt,
      project_id: settings.flowkitProjectId,
      video_model: resolvedModel,
      aspect_ratio: aspect,
    };

    let endpoint: string = API.generateVideo;
    if (mode === 'r2v') {
      const promptLower = prompt.toLowerCase();
      let matchedVoice: string | undefined = undefined;

      // 1. Thu thập tất cả các Character Entity kết nối
      const selectedEntityIds: string[] = [];
      const charDetails = getCharacterDetails();
      charDetails.forEach(char => {
        if (char.entityId) {
          selectedEntityIds.push(char.entityId);
        }
        if (char.voice) {
          if (promptLower.includes(char.name.toLowerCase()) || !matchedVoice) {
            matchedVoice = char.voice;
          }
        }
      });

      // 2. Thu thập tất cả các ảnh trực tiếp được upload
      const selectedMediaIds: string[] = [];
      if (r2vRefMediaIds) {
        r2vRefMediaIds.forEach(mid => {
          if (mid) selectedMediaIds.push(mid);
        });
      }

      // Luôn áp dụng voice chung được chọn trên BatchNode cho tất cả các prompt
      if (audioVoiceId) {
        matchedVoice = audioVoiceId;
      }

      const deduplicatedEntities = [...new Set(selectedEntityIds)];
      const deduplicatedMedia = [...new Set(selectedMediaIds)];

      const limit = (resolvedModel as string || '').startsWith('abra_') ? 7 : 3;
      if (deduplicatedEntities.length > 0) {
        payload.entity_ids = deduplicatedEntities.slice(0, limit);
      }
      if (deduplicatedMedia.length > 0) {
        payload.reference_media_ids = deduplicatedMedia.slice(0, limit);
      }
      if (matchedVoice) {
        payload.audio_voice_id = matchedVoice;
      }
      endpoint = API.generateR2V;
    } else if (mode === 'i2v') {
      const mid = imageMediaId || getUpstreamImageMediaId();
      if (mid) payload.start_image_media_id = mid;
    }

    try {
      const res = await axios.post(endpoint, payload);
      if (res.data.success) return { jobId: res.data.job_id };
      return { error: typeof res.data.error === 'object' ? JSON.stringify(res.data.error) : (res.data.error || 'Unknown') };
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

  // Helper to F5 reload Flow tab (no cache clearing) and wait for extension reconnection
  const reloadFlowTabAndWait = async () => {
    toast('🔄 F5 reload Flow tab sau 3 video...', { icon: '🔄', duration: 3000 });
    try {
      await axios.post('/api/flowkit/reload-tab', { project_id: settings.flowkitProjectId });
    } catch (e) {
      console.error('Failed to trigger reload-tab:', e);
    }

    // Wait for extension to reconnect and capture token
    const maxPollAttempts = 24; // 2 minutes max
    for (let i = 0; i < maxPollAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        const res = await axios.get(API.flowkitStatus);
        if (res.data.connected && res.data.flowKeyPresent) {
          toast.success('✅ FlowAgent reconnected!', { duration: 2000 });
          return true;
        }
      } catch (err) {
        console.error('Error checking status after reload:', err);
      }
    }
    throw new Error('Không thể kết nối lại với FlowAgent sau khi F5 reload.');
  };

  // ─── Batch runner ─────────────────────────────────────
  // ─── Batch runner ─────────────────────────────────────
  const startBatch = async () => {
    if (lines.length === 0) { toast.error('Nhập prompt'); return; }
    if (flowkitStatus !== 'connected') { toast.error('FlowAgent chưa kết nối'); return; }

    let refFiles: File[] = [];
    const uploadNodeId = getUpstreamImageUploadNodeId();

    if (mode === 'r2v') {
      if (uploadNodeId) {
        const { getImageFiles } = await import('../../stores/imageFileStore');
        refFiles = getImageFiles(uploadNodeId);
      }
      if (refFiles.length === 0 && getCharacterDetails().length === 0) {
        toast.error('Nối CharacterNode (nhân vật) hoặc Ảnh I2V (ảnh tham chiếu) vào đầu vào');
        return;
      }
    }

    // For I2V: get image files from imageFileStore
    let imageFiles: File[] = [];
    if (mode === 'i2v') {
      if (uploadNodeId) {
        const { getImageFiles } = await import('../../stores/imageFileStore');
        imageFiles = getImageFiles(uploadNodeId);
      }
      const singleImageId = getUpstreamImageMediaId();
      if (imageFiles.length === 0 && !singleImageId) {
        toast.error('Nối node Ảnh I2V (có ảnh) hoặc ImageNode vào đầu vào');
        return;
      }
      if (imageFiles.length > 0 && imageFiles.length < lines.length) {
        toast.error(`Có ${imageFiles.length} ảnh nhưng ${lines.length} prompt. Cần ≥ số prompt!`);
        return;
      }
    }

    const items: QueueItem[] = lines.map((t: string, i: number) => ({
      id: `q_${Date.now()}_${i}`, text: t.trim(), status: 'pending' as PromptStatus,
    }));
    setQueue(items);
    setIsRunning(true);
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, isRunning: true } } : n));
    cancelRef.current = false;

    if (autoClearCache) {
      try {
        await clearCacheAndWaitForReady();
      } catch (err: any) {
        toast.error(err.message);
        setIsRunning(false);
        setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, isRunning: false } } : n));
        return;
      }
    }

    let idx = 0;
    let running = 0;
    const effectiveConcurrent = concurrent;
    let successesSinceLastClear = 0;
    let isPausingForClearCache = false;
    let successesSinceLastReload = 0;
    let isPausingForReload = false;

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

    let consecutiveFailures = 0;
    let consecutive403 = 0;

    await new Promise<void>((resolve) => {
      const tick = async () => {
        if (isPausingForClearCache || isPausingForReload) return;
        while (idx < items.length && running < effectiveConcurrent && !cancelRef.current && !isPausingForClearCache && !isPausingForReload) {
          const cur = idx++;
          running++;
          setQueue(prev => prev.map((p, i) => i === cur ? { ...p, status: 'creating' } : p));

          (async () => {
            // 1. Thread Start Spacing (5s)
            if (running > 1) {
              const elapsed = Date.now() - lastStartTimeRef.current;
              if (elapsed < 5000) {
                await new Promise(r => setTimeout(r, 5000 - elapsed));
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
                setQueue(prev => prev.map((p, i) => i === cur
                  ? { ...p, status: 'creating', stepLabel: `⏳ Thử lại lần ${attempt + 1}/${maxAttempts} (chờ 10s)...` }
                  : p
                ));
                await new Promise(r => setTimeout(r, 10000));
              }

              // 1. Submit job (with internal retry for temp errors like 403 or 429)
              let submissionSuccess = false;
              let subAttempts = 0;
              const maxSubAttempts = 5;
              jobId = '';

              let r2vUploadedIds: string[] = [];
              let targetIndices: number[] = [];

              while (subAttempts < maxSubAttempts) {
                if (cancelRef.current) break;

                // Parallel Coordination check (5s since last completed request)
                if (lastCompletionTimeRef.current > 0) {
                  const elapsed = Date.now() - lastCompletionTimeRef.current;
                  if (elapsed < 5000) {
                    await new Promise(r => setTimeout(r, 5000 - elapsed));
                  }
                }

                try {
                  if (mode === 'i2v' && imageFiles.length > 0 && imageFiles[cur]) {
                    setQueue(prev => prev.map((p, i) => i === cur
                      ? { ...p, status: 'uploading', stepLabel: `📤 Đang tải ảnh ${cur + 1} lên...` }
                      : p
                    ));
                    const currentModel2 = resolveCurrentModel();
                    const { cleanPrompt, model: resolvedModel } = parseModelOverride(items[cur].text, currentModel2, mode);
                    console.log(`[BatchNode I2V] defaultModel=${currentModel2}, resolvedModel=${resolvedModel}, prompt="${items[cur].text.slice(-30)}"`);
                    const formData = new FormData();
                    formData.append('file', imageFiles[cur]);
                    formData.append('prompt', cleanPrompt);
                    formData.append('project_id', settings.flowkitProjectId);
                    formData.append('video_model', resolvedModel);
                    formData.append('aspect_ratio', aspect);

                    const uploadTimer = setTimeout(() => {
                      setQueue(prev => prev.map((p, i) => i === cur
                        ? { ...p, status: 'creating', stepLabel: `🎬 Đang tạo video ${cur + 1}...` }
                        : p
                      ));
                    }, 5000);

                    const res = await axios.post(API.i2vFile, formData, { timeout: 120000 });
                    clearTimeout(uploadTimer);

                    if (res.data.success && res.data.job_id) {
                      jobId = res.data.job_id;
                      consecutive403 = 0;
                      submissionSuccess = true;
                      toast.success(`📤 Ảnh ${cur + 1} → đã gửi render`);
                      break;
                    } else {
                      const apiError = res.data.error;
                      let errStr = "";
                      if (typeof apiError === 'string') {
                        errStr = apiError;
                      } else if (apiError && typeof apiError === 'object') {
                        const errObj = apiError.data?.error || apiError.error || apiError;
                        errStr = errObj.message || JSON.stringify(errObj);
                      }
                      throw new Error(errStr || 'Upload failed');
                    }
                  } else {
                    r2vUploadedIds = [];
                    if (mode === 'r2v' && refFiles.length > 0) {
                      const promptText = items[cur].text.toLowerCase();
                      const indices: number[] = [];
                      for (let i = 0; i < refFiles.length; i++) {
                        const pattern = new RegExp(`\\[ref_${i}\\]|\\bref_${i}\\b|image_${i}\\.png`, 'i');
                        if (pattern.test(promptText)) {
                          indices.push(i);
                        }
                      }

                      if (promptText.includes('product') || promptText.includes('sản phẩm')) {
                        indices.push(0);
                      }
                      if (promptText.includes('model') || promptText.includes('người mẫu')) {
                        indices.push(1);
                      }

                      targetIndices = [...new Set(indices)].sort((a, b) => a - b).slice(0, 7);
                      if (targetIndices.length === 0) {
                        targetIndices = [0, 1, 2, 3, 4, 5, 6].slice(0, refFiles.length);
                      }

                      if (targetIndices.length > 0) {
                        setQueue(prev => prev.map((p, i) => i === cur
                          ? { ...p, status: 'uploading', stepLabel: `📤 Đang tải ${targetIndices.length} ảnh tham chiếu...` }
                          : p
                        ));
                        
                        for (const idxVal of targetIndices) {
                          if (refFiles[idxVal]) {
                            const file = refFiles[idxVal];
                            const cacheKey = `${uploadNodeId}_${file.name}_${file.size}`;
                            let mediaId = fileMediaIdCache.current[cacheKey];
                            if (!mediaId) {
                              const formData = new FormData();
                              formData.append('file', file);
                              formData.append('project_id', settings.flowkitProjectId);
                              const uploadRes = await axios.post(API.uploadReference, formData);
                              if (uploadRes.data.success && uploadRes.data.media_id) {
                                mediaId = uploadRes.data.media_id;
                                fileMediaIdCache.current[cacheKey] = mediaId;
                              }
                            }
                            if (mediaId) {
                              r2vUploadedIds.push(mediaId);
                            }
                          }
                        }
                      }
                    }

                    setQueue(prev => prev.map((p, i) => i === cur
                      ? { ...p, status: 'creating', stepLabel: mode === 'r2v' ? `🎭 Đang tạo video nhân vật...` : `🎬 Đang tạo video...` }
                      : p
                    ));
                    const res = await generateOne(items[cur].text, undefined, r2vUploadedIds);
                    if (res.jobId) {
                      jobId = res.jobId;
                      consecutive403 = 0;
                      submissionSuccess = true;
                      break;
                    } else {
                      throw new Error(res.error || 'Generation failed');
                    }
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
                    setQueue(prev => prev.map((p, i) => i === cur
                      ? { ...p, stepLabel: `⏳ Server quá tải. Chờ 30s để thử lại...` }
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
              setQueue(prev => prev.map((p, i) => i === cur
                ? { ...p, status: 'submitted', jobId, stepLabel: `⏳ Đã gửi — đang render trên máy chủ...` }
                : p
              ));

              if (onBatchVideoCreated) {
                const currentModel2 = resolveCurrentModel();
                const charDetails = getCharacterDetails();
                const selectedEntityIds = charDetails.map(c => c.entityId).filter(Boolean);
                const selectedMediaIds = r2vUploadedIds || [];
                const matchedVoice = audioVoiceId || (charDetails.find(c => c.voice)?.voice) || undefined;
                const refUrls = targetIndices.map(idx => {
                  const file = refFiles[idx];
                  if (file) {
                    try {
                      return URL.createObjectURL(file);
                    } catch {
                      return '';
                    }
                  }
                  return '';
                }).filter(Boolean);

                onBatchVideoCreated(id, jobId, items[cur].text, {
                  videoModel: currentModel2,
                  audioVoiceId: matchedVoice,
                  entityIds: selectedEntityIds,
                  sourceRefMediaIds: selectedMediaIds,
                  referenceUrls: refUrls,
                });
              }

              // Increase timeout to 480000ms (8 minutes) — Veo 3.1 can take 4-8 min
              const status = await waitForJob(jobId, cur, 480000);
              lastCompletionTimeRef.current = Date.now();

              if (status === 'DONE') {
                consecutiveFailures = 0;
                successesSinceLastClear++;
                successesSinceLastReload++;

                if (autoClearCache && successesSinceLastClear >= 50) {
                  isPausingForClearCache = true;
                  toast('⏸️ Đạt 50 video. Đang đợi các luồng hiện tại hoàn thành để xoá cache...', { icon: '⏳' });
                } else if (successesSinceLastReload >= 3 && idx < items.length) {
                  isPausingForReload = true;
                  toast('⏸️ Đạt 3 video — đợi luồng xong để F5 reload...', { icon: '🔄', duration: 3000 });
                }

                // Auto-upscale if quality > 720p
                if (upscaleQuality !== '720p' && jobId) {
                  try {
                    const jobRes = await axios.get(`/api/generate/jobs/${jobId}`);
                    const mediaId = jobRes.data?.media_id || jobRes.data?.primary_media_id;
                    if (mediaId) {
                      setQueue(prev => prev.map((p, i) => i === cur
                        ? { ...p, stepLabel: `📈 Upscale → ${upscaleQuality}...` }
                        : p
                      ));
                      const upRes = await axios.post('/api/generate/upscale-video', {
                        media_id: mediaId,
                        project_id: settings.flowkitProjectId,
                        resolution: upscaleQuality,
                        aspect_ratio: aspect,
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
                            toast.success(`✅ Video ${cur + 1} upscale ${upscaleQuality} xong!`);
                            break;
                          } else if (stRes.data?.status === 'failed') {
                            toast.error(`⚠️ Video ${cur + 1} upscale thất bại`);
                            break;
                          }
                          await new Promise(r => setTimeout(r, 5000));
                        }
                      }
                    }
                  } catch (upErr) {
                    console.error('Auto-upscale error:', upErr);
                  }
                }

                setQueue(prev => prev.map((p, i) => i === cur
                  ? { ...p, status: 'done', stepLabel: `✅ Render hoàn tất!` }
                  : p
                ));
                toast.success(`✅ Video ${cur + 1} xong!`);
                renderSuccess = true;
                await new Promise(r => setTimeout(r, 5000));
              } else {
                consecutiveFailures++;
                errorText = `Render ${status === 'FAILED' ? 'thất bại' : 'quá hạn (5 phút)'}`;
                toast.error(`❌ Video ${cur + 1} render ${status === 'FAILED' ? 'thất bại' : 'quá hạn'}!`);

                if (consecutiveFailures >= 3) {
                  cancelRef.current = true;
                  toast.error(`❌ Dừng workflow ngay lập tức do 3 video liên tiếp thất bại!`);
                  break;
                } else {
                  attempt++;
                  await new Promise(r => setTimeout(r, 15000));
                }
              }
            }

            if (!renderSuccess && !cancelRef.current) {
              setQueue(prev => prev.map((p, i) => i === cur
                ? { ...p, status: 'error', error: errorText, stepLabel: `❌ Lỗi sau 3 lần tạo lại: ${errorText.slice(0, 45)}` }
                : p
              ));
              toast.error(`❌ Video ${cur + 1} lỗi sau 3 lần tạo lại: ${errorText}`);
            }

            running--;
            if (isPausingForClearCache && running === 0) {
              try {
                await clearCacheAndWaitForReady();
                successesSinceLastClear = 0;
                isPausingForClearCache = false;
                successesSinceLastReload = 0; // also reset reload counter after full cache clear
                isPausingForReload = false;
                tick();
              } catch (err: any) {
                toast.error(err.message);
                cancelRef.current = true;
                resolve();
                return;
              }
            } else if (isPausingForReload && running === 0) {
              try {
                await reloadFlowTabAndWait();
                successesSinceLastReload = 0;
                isPausingForReload = false;
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
            if (running === 0 && (idx >= items.length || cancelRef.current)) resolve();
          })();
        }
        if (running === 0) resolve();
      };
      tick();
    });

    setIsRunning(false);
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, isRunning: false } } : n));
    if (!cancelRef.current) toast.success(`📤 Batch đã gửi ${items.length} video lên render!`);
  };

  // Auto-execute from AgentPanel (1-chạm)
  useEffect(() => {
    if (shouldAutoRun && !isRunning && lines.length > 0) {
      setShouldAutoRun(false);
      // Delay to let state settle
      const timer = setTimeout(() => {
        startBatch();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [shouldAutoRun, isRunning, lines.length]);
  // Auto-execute when triggered from sequential queue
  useEffect(() => {
    if (data.triggerRun && !isRunning) {
      // Clear trigger flag first to prevent loop
      setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, triggerRun: false } } : n));
      startBatch();
    }
  }, [data.triggerRun, isRunning, id, setNodes]);
  return (
    <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl shadow-xl shadow-emerald-500/10 overflow-hidden h-full w-full flex flex-col">
      <NodeResizer
        isVisible={!!selected}
        minWidth={250}
        minHeight={150}
        lineClassName="!border-emerald-500/50"
        handleClassName="!w-2.5 !h-2.5 !bg-emerald-500 !border-2 !border-slate-900 !rounded"
      />
      {/* Input handle — connect CharacterNode here */}
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-rose-400 !border-rose-600" />
      {/* Output handle */}
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-emerald-400 !border-emerald-600" />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/20">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-emerald-300">Batch Video</span>
          <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{lines.length}</span>
        </div>
        <button onClick={() => onDeleteNode(id)} className="text-slate-500 hover:text-red-400 text-[10px]">✕</button>
      </div>

      {/* Mode toggle */}
      <div className="flex mx-3 mt-2 rounded-lg overflow-hidden border border-slate-700">
        <button
          onClick={() => handleModeChange('t2v')}
          className={`flex-1 py-1.5 text-[10px] font-bold transition-all ${mode === 't2v' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <Film className="w-3 h-3 inline mr-1" />T2V
        </button>
        <button
          onClick={() => handleModeChange('i2v')}
          className={`flex-1 py-1.5 text-[10px] font-bold transition-all ${mode === 'i2v' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <Camera className="w-3 h-3 inline mr-1" />I2V
        </button>
        <button
          onClick={() => handleModeChange('r2v')}
          className={`flex-1 py-1.5 text-[10px] font-bold transition-all ${mode === 'r2v' ? 'bg-rose-500/20 text-rose-300' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <Users className="w-3 h-3 inline mr-1" />R2V
        </button>
      </div>

      {mode === 'r2v' && (
        <div className="mx-3 mt-1">
          <p className="text-[9px] text-rose-400/70">← Nối <b>CharacterNode</b> hoặc node <b>Ảnh I2V</b> vào đầu vào bên trái</p>
          {(getUpstreamImageUploadNodeId() || getCharacterEntities().length > 0 || getEntityIds().length > 0 || getCharMediaIds().length > 0) && (
            <p className="text-[9px] text-emerald-400 mt-0.5">✅ Đầu vào đã nối</p>
          )}
        </div>
      )}
      {mode === 'i2v' && (
        <div className="mx-3 mt-1">
          <p className="text-[9px] text-amber-400/70">← Nối node <b>Ảnh I2V</b> vào bên trái (upload tự động khi chạy)</p>
          {getUpstreamImageUploadNodeId() && (
            <p className="text-[9px] text-emerald-400 mt-0.5">✅ Node ảnh đã nối</p>
          )}
        </div>
      )}

      {/* Prompts */}
      <div className="px-3 py-2">
        <textarea
          value={prompts}
          onChange={(e) => setPrompts(e.target.value)}
          rows={5}
          className="nodrag nowheel w-full bg-slate-950 text-slate-200 text-[11px] p-2 rounded-lg border border-slate-700 focus:border-emerald-500 focus:outline-none resize-none font-mono leading-relaxed placeholder:text-slate-600"
          placeholder={"Cảnh 1: ...\nCảnh 2: ...\nCảnh 3: ..."}
        />
      </div>

      {/* Settings toggle */}
      <div className="px-3">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="w-full flex items-center justify-between text-[9px] font-bold text-slate-500 uppercase"
        >
          <span className="flex items-center gap-1"><Settings className="w-3 h-3" /> Cài đặt</span>
          {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {showSettings && (
          <div className="mt-1.5 space-y-1.5 pb-1">
            {/* Concurrent */}
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-slate-400">Luồng:</span>
              <div className="flex items-center gap-0.5 bg-slate-800 rounded px-1.5 py-0.5" title="Số luồng chạy song song (1-30)">
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="nodrag bg-transparent text-[9px] text-amber-300 font-bold outline-none w-7 text-center appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  value={concurrent}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(30, Number(e.target.value) || 1));
                    setConcurrent(v);
                    data.concurrent = v;
                  }}
                />
              </div>
            </div>

            {/* Voice Selection for R2V */}
            {mode === 'r2v' && (
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[9px] text-slate-400 flex items-center gap-0.5"><Mic className="w-2.5 h-2.5 text-rose-400" /> Voice:</span>
                <div className="flex gap-1 flex-1 justify-end max-w-[150px]">
                  <select
                    value={audioVoiceId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAudioVoiceId(val);
                      stopAudio();
                      data.audioVoiceId = val;
                    }}
                    className="nodrag bg-slate-950 text-slate-300 text-[9px] px-1 py-[3px] rounded border border-slate-700 focus:outline-none flex-1 min-w-0"
                  >
                    {VOICES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                  </select>
                  {audioVoiceId && (
                    <button
                      onClick={isPlaying ? stopAudio : previewVoice}
                      className={`nodrag px-1.5 py-1 rounded text-[9px] transition-all flex-shrink-0 ${
                        isPlaying
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 animate-pulse'
                          : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30'
                      }`}
                      title={isPlaying ? 'Dừng' : 'Nghe thử'}
                    >
                      {isPlaying ? <Square className="w-2.5 h-2.5" /> : <Volume2 className="w-2.5 h-2.5" />}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Aspect */}
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-slate-400">Tỷ lệ:</span>
              <div className="flex gap-0.5">
                {ASPECTS.map(a => (
                  <button key={a.value} onClick={() => setAspect(a.value)}
                    className={`nodrag px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      aspect === a.value ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}
                  >{a.label}</button>
                ))}
              </div>
            </div>

            {/* Model — Tier + Duration buttons */}
            <div className="space-y-1">
              {/* Tier row */}
              <div className="flex items-center gap-0.5">
                <span className="text-[7px] text-slate-600 w-5 shrink-0 font-bold">Tier</span>
                <div className="flex gap-0.5 flex-1">
                  {BATCH_TIERS.map(t => {
                    const avail = getAvailDurations(mode, t.key).length > 0;
                    const isActive = bTier === t.key;
                    return (
                      <button key={t.key}
                        onClick={() => avail && handleTierChange(t.key)}
                        disabled={!avail}
                        className={`nodrag flex-1 flex flex-col items-center px-0.5 py-[2px] rounded text-[8px] font-bold transition-all border leading-tight ${
                          isActive
                            ? t.color
                            : avail
                              ? 'bg-slate-800/60 text-slate-500 border-slate-700/40 hover:text-slate-300'
                              : 'bg-slate-900/30 text-slate-700/40 border-slate-800/20 cursor-not-allowed'
                        }`}
                        title={`${t.desc}${!avail ? ' (không khả dụng)' : ''}`}
                      >
                        <span>{t.label}</span>
                        <span className="text-[6px] font-normal opacity-70">{t.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Duration row */}
              <div className="flex items-center gap-0.5">
                <span className="text-[7px] text-slate-600 w-5 shrink-0 font-bold">Time</span>
                <div className="flex gap-0.5 flex-1">
                  {ALL_DURATIONS.map(d => {
                    const avail = availDurations.includes(d);
                    const isActive = bDuration === d;
                    return (
                      <button key={d}
                        onClick={() => avail && setBDuration(d)}
                        disabled={!avail}
                        className={`nodrag flex-1 px-0.5 py-[3px] rounded text-[9px] font-bold transition-all border ${
                          isActive
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-500/30'
                            : avail
                              ? 'bg-slate-800/60 text-slate-400 border-slate-700/40 hover:text-white hover:border-slate-500'
                              : 'bg-slate-900/30 text-slate-700/40 border-slate-800/20 cursor-not-allowed'
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                  {/* Random */}
                  <button
                    onClick={() => setBDuration('random')}
                    className={`nodrag px-1.5 py-[3px] rounded text-[9px] font-bold transition-all border ${
                      bDuration === 'random'
                        ? 'bg-pink-600/30 text-pink-300 border-pink-500/50 shadow-sm shadow-pink-500/20'
                        : 'bg-slate-800/60 text-slate-500 border-slate-700/40 hover:text-pink-300 hover:border-pink-500/30'
                    }`}
                    title={`Ngẫu nhiên: ${availDurations.join(' / ')}`}
                  >
                    <Shuffle className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Model key preview */}
              <div className="text-[7px] text-center font-mono truncate">
                {bDuration === 'random'
                  ? <span className="text-pink-400/70">🎲 Random {availDurations.join('/')}</span>
                  : <span className="text-slate-500">{model || '—'}</span>
                }
              </div>
            </div>

            {/* Upscale Quality */}
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-slate-400">Chất lượng:</span>
              <div className="flex gap-0.5">
                {[{v: '720p', l: '720p'}, {v: '1080p', l: '1080p'}, {v: '4K', l: '4K'}].map(q => (
                  <button key={q.v} onClick={() => setUpscaleQuality(q.v)}
                    className={`nodrag px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      upscaleQuality === q.v
                        ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                        : 'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}
                  >{q.l}</button>
                ))}
              </div>
            </div>

            {/* Auto Clear Cache */}
            <div className="flex items-center justify-between border-t border-slate-800/50 pt-1.5 mt-1">
              <div className="flex flex-col">
                <span className="text-[9px] text-slate-300 font-medium">Auto xoá cache captcha</span>
                <span className="text-[7px] text-slate-500">Mỗi 50 video & trước khi chạy</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const newVal = !autoClearCache;
                  setAutoClearCache(newVal);
                  localStorage.setItem('batch_auto_clear_cache', String(newVal));
                }}
                className={`nodrag relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  autoClearCache ? 'bg-emerald-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    autoClearCache ? 'translate-x-3' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Queue progress */}
      {queue.length > 0 && (
        <div className="px-3 pb-1">
          {/* Progress bar header */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-slate-400">
              {isRunning ? (
                <span className="flex items-center gap-1 text-amber-400">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  Đang xử lý {doneCount}/{queue.length}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  Hoàn tất {doneCount}/{queue.length}
                </span>
              )}
            </span>
            <span className="text-[9px] font-mono text-slate-500">{progress}%</span>
          </div>

          {/* Animated progress bar */}
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background: progress === 100
                  ? 'linear-gradient(90deg, #3b82f6, #60a5fa)'
                  : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                boxShadow: progress < 100 ? '0 0 8px rgba(245,158,11,0.5)' : '0 0 8px rgba(59,130,246,0.4)',
              }}
            />
          </div>

          {/* Step-by-step queue list */}
          <div className="max-h-32 overflow-y-auto space-y-1 nowheel">
            {queue.map((q, idx) => (
              <div
                key={q.id}
                className={`flex items-start gap-1.5 text-[10px] py-1 px-2 rounded-lg transition-all ${
                  q.status === 'uploading' ? 'bg-blue-500/10 border border-blue-500/20' :
                  q.status === 'creating' ? 'bg-amber-500/10 border border-amber-500/20' :
                  q.status === 'submitted' ? 'bg-blue-500/10 border border-blue-500/20' :
                  q.status === 'done' ? 'bg-emerald-500/10 border border-emerald-500/20' :
                  q.status === 'error' ? 'bg-red-500/10 border border-red-500/20' :
                  'bg-slate-950/50 border border-transparent'
                }`}
              >
                {/* Icon */}
                <div className="shrink-0 mt-0.5">
                  {q.status === 'pending' && <Clock className="w-2.5 h-2.5 text-slate-500" />}
                  {q.status === 'uploading' && <Loader2 className="w-2.5 h-2.5 text-blue-400 animate-spin" />}
                  {q.status === 'creating' && <Loader2 className="w-2.5 h-2.5 text-amber-400 animate-spin" />}
                  {q.status === 'submitted' && <Loader2 className="w-2.5 h-2.5 text-blue-400 animate-spin" />}
                  {q.status === 'done' && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />}
                  {q.status === 'error' && <XCircle className="w-2.5 h-2.5 text-red-400" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] font-mono text-slate-500">#{idx + 1}</span>
                    {q.status === 'uploading' && <span className="text-[8px] text-blue-300 animate-pulse">Tải lên...</span>}
                    {q.status === 'creating' && <span className="text-[8px] text-amber-300 animate-pulse">Đang tạo...</span>}
                    {q.status === 'submitted' && <span className="text-[8px] text-blue-300 animate-pulse">⏳ Đang render...</span>}
                    {q.status === 'done' && <span className="text-[8px] text-emerald-300">✓ Xong</span>}
                    {q.status === 'error' && <span className="text-[8px] text-red-300">✗ Lỗi</span>}
                  </div>
                  {/* Step label */}
                  {q.stepLabel && (
                    <p className={`text-[9px] mt-0.5 font-medium ${
                      q.status === 'uploading' ? 'text-blue-400' :
                      q.status === 'creating' ? 'text-amber-400' :
                      q.status === 'submitted' ? 'text-blue-400' :
                      q.status === 'done' ? 'text-emerald-400' :
                      q.status === 'error' ? 'text-red-400' : 'text-slate-400'
                    }`}>
                      {q.stepLabel}
                    </p>
                  )}
                  <p className="text-[9px] text-slate-500 truncate mt-0.5">{q.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run / Stop */}
      <div className="px-3 pb-3 pt-1">
        {isRunning ? (
          <button onClick={() => { cancelRef.current = true; setIsRunning(false); setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, isRunning: false } } : n)); }}
            className="nodrag w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-600/20 border border-red-500/40 text-red-300 text-[11px] font-bold hover:bg-red-600/30 transition-all"
          >
            <Square className="w-3 h-3" /> Dừng
          </button>
        ) : (
          <button onClick={startBatch}
            disabled={lines.length === 0 || flowkitStatus !== 'connected'}
            className="nodrag w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40"
          >
            <Play className="w-3 h-3" /> Chạy ({lines.length} video)
          </button>
        )}
      </div>
    </div>
  );
}
