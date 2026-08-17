import React, { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  RefreshCw, Play, Square, Loader2, CheckCircle2, XCircle,
  Clock, Upload, X, Trash2, Plus, Image as ImageIcon, Film,
  Layers, Copy, Sparkles, Settings2, Download, ExternalLink, ChevronDown, ChevronUp, ArrowRight,
  Mic, Eraser, Zap, Volume2
} from 'lucide-react';
import { API, resolveMediaUrl } from '../../config';
import { useProjectStore } from '../../store/useProjectStore';

// ─── Types ──────────────────────────────────────────────
export type PipelineMode = 'ref_image_video' | 'ref_to_video';
export type WorkflowStatus = 'idle' | 'generating_image' | 'generating_video' | 'completed' | 'error';

export interface SharedRefImage {
  id: string;
  file: File;
  preview: string;
  mediaId?: string;
}

export interface WorkflowItem {
  id: string;
  index: number;
  refImageFile?: File;
  refImagePreview?: string;
  refImageMediaId?: string;
  scenePrompt: string;
  sceneImageMediaId?: string;
  sceneImageUrl?: string;
  videoPrompt: string;
  videoModel: string;
  imageAspectRatio: string;
  videoAspectRatio: string;
  voice?: string;
  clearCache?: boolean;
  videoJobId?: string;
  videoMediaId?: string;
  videoUrl?: string;
  status: WorkflowStatus;
  progressMessage?: string;
  error?: string;
}

// ── Model lookup table: type → tier → duration → model_key ──
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

const IMAGE_ASPECT_RATIOS = [
  { value: 'IMAGE_ASPECT_RATIO_LANDSCAPE', label: '16:9 (Ngang)' },
  { value: 'IMAGE_ASPECT_RATIO_PORTRAIT', label: '9:16 (Dọc)' },
  { value: 'IMAGE_ASPECT_RATIO_SQUARE', label: '1:1 (Vuông)' },
];

const VIDEO_ASPECT_RATIOS = [
  { value: 'VIDEO_ASPECT_RATIO_LANDSCAPE', label: '16:9 (Ngang)' },
  { value: 'VIDEO_ASPECT_RATIO_PORTRAIT', label: '9:16 (Dọc)' },
  { value: 'VIDEO_ASPECT_RATIO_SQUARE', label: '1:1 (Vuông)' },
];

const TYPES = [
  { key: 'i2v', label: '🖼️ I2V' },
  { key: 't2v', label: '✍️ T2V' },
  { key: 'r2v', label: '🎭 R2V' },
];

const TIERS = [
  { key: 'quality', label: '💎 Quality' },
  { key: 'pro', label: '⭐ Pro' },
  { key: 'lite', label: '🔵 Lite' },
  { key: 'free', label: '🆓 FREE' },
  { key: 'omni', label: '⚡ Omni' },
];

const DURATIONS = ['4s', '6s', '8s', '10s'];

const VOICES = [
  { value: '', label: '🔇 Không Voice' },
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

interface MultiWorkflowPanelProps {
  onClose?: () => void;
  onExportToCanvas?: (
    workflows: WorkflowItem[],
    pipelineMode: PipelineMode,
    sharedRefImages: SharedRefImage[],
    settingsExtra?: {
      voice: string;
      clearCache: boolean;
      concurrent: number;
      vType: string;
      vTier: string;
      vDuration: string;
      imageAspect: string;
      videoAspect: string;
    }
  ) => void;
}

export const MultiWorkflowPanel: React.FC<MultiWorkflowPanelProps> = ({ onClose, onExportToCanvas }) => {
  const settings = useProjectStore((s) => s.settings);
  const addMedia = useProjectStore((s) => s.addMedia);

  // Pipeline Mode
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('ref_image_video');

  // Video Generation Config matching VideoPromptNode features
  const [workflowCount, setWorkflowCount] = useState<number>(3);
  const [vType, setVType] = useState<string>('i2v');
  const [vTier, setVTier] = useState<string>('free');
  const [vDuration, setVDuration] = useState<string>('8s');

  // Independent Aspect Ratios for Image and Video
  const [defaultImageAspect, setDefaultImageAspect] = useState<string>('IMAGE_ASPECT_RATIO_LANDSCAPE');
  const [defaultVideoAspect, setDefaultVideoAspect] = useState<string>('VIDEO_ASPECT_RATIO_LANDSCAPE');

  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [clearCache, setClearCache] = useState<boolean>(false);
  const [concurrentThreads, setConcurrentThreads] = useState<number>(1);
  const [sharedRefImages, setSharedRefImages] = useState<SharedRefImage[]>([]);

  // Voice player preview
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);

  // Workflows list
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const abortRef = useRef<boolean>(false);

  // Auto-resolve model from Type, Tier, Duration
  const getComputedModel = useCallback((type: string, tier: string, duration: string) => {
    const tierMap = MODEL_MAP[type];
    if (!tierMap) return '';
    const durMap = tierMap[tier];
    if (!durMap) return '';
    if (durMap[duration]) return durMap[duration];
    const keys = Object.keys(durMap);
    return keys.length > 0 ? durMap[keys[0]] : '';
  }, []);

  // Update pipelineMode when vType changes
  useEffect(() => {
    if (vType === 'r2v') {
      setPipelineMode('ref_to_video');
    } else {
      setPipelineMode('ref_image_video');
    }
  }, [vType]);

  // Clean up audio player on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  // Initialize N workflows
  const handleGenerateWorkflows = useCallback(() => {
    const count = Math.max(1, Math.min(50, workflowCount));
    const newItems: WorkflowItem[] = [];
    const computedModel = getComputedModel(vType, vTier, vDuration);

    for (let i = 1; i <= count; i++) {
      newItems.push({
        id: `wf-${Date.now()}-${i}`,
        index: i,
        scenePrompt: `Cảnh ${i}: Một khung cảnh điện ảnh ấn tượng, chi tiết cao, ánh sáng kịch tính.`,
        videoPrompt: vType === 'r2v'
          ? `Góc quay chuyển động từ ảnh tham chiếu, chân thực, cinematic.`
          : `Góc quay camera chuyển động mượt mà, chân thực, độ phân giải cao.`,
        videoModel: computedModel || 'veo_3_1_i2v_lite_low_priority',
        imageAspectRatio: defaultImageAspect,
        videoAspectRatio: defaultVideoAspect,
        voice: selectedVoice,
        clearCache: clearCache,
        status: 'idle',
      });
    }

    setWorkflows(newItems);
    toast.success(`Đã khởi tạo thành công ${count} Workflow!`);
  }, [workflowCount, vType, vTier, vDuration, defaultImageAspect, defaultVideoAspect, selectedVoice, clearCache, getComputedModel]);

  // Play audio sample preview of selected voice
  const togglePlayVoiceDemo = (voiceId: string) => {
    if (!voiceId) return;

    if (playingVoice === voiceId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingVoice(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audioUrl = resolveMediaUrl(`/voices/${voiceId}.wav`);
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setPlayingVoice(voiceId);
    audio.play().catch(() => toast.error('Không phát được âm thanh thử giọng'));
    
    audio.onended = () => {
      setPlayingVoice(null);
      audioRef.current = null;
    };
    audio.onerror = () => {
      setPlayingVoice(null);
      audioRef.current = null;
      toast.error('Tệp âm thanh thử giọng không tồn tại trên server');
    };
  };

  // Upload multiple shared reference images
  const handleSharedRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newItems: SharedRefImage[] = files.map((file) => ({
      id: `shared-ref-${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
    }));

    setSharedRefImages((prev) => [...prev, ...newItems]);
    toast.success(`Đã thêm ${files.length} ảnh tham chiếu chung!`);
  };

  const removeSharedRefImage = (id: string) => {
    setSharedRefImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleCardRefUpload = (id: string, file: File) => {
    const preview = URL.createObjectURL(file);
    setWorkflows((prev) =>
      prev.map((wf) => (wf.id === id ? { ...wf, refImageFile: file, refImagePreview: preview } : wf))
    );
  };

  const handleRemoveCardRef = (id: string) => {
    setWorkflows((prev) =>
      prev.map((wf) => (wf.id === id ? { ...wf, refImageFile: undefined, refImagePreview: undefined } : wf))
    );
  };

  const updateWorkflowField = (id: string, updates: Partial<WorkflowItem>) => {
    setWorkflows((prev) => prev.map((wf) => (wf.id === id ? { ...wf, ...updates } : wf)));
  };

  const removeWorkflow = (id: string) => {
    setWorkflows((prev) => prev.filter((wf) => wf.id !== id).map((wf, idx) => ({ ...wf, index: idx + 1 })));
  };

  const duplicateWorkflow = (id: string) => {
    const target = workflows.find((wf) => wf.id === id);
    if (!target) return;
    const newWf: WorkflowItem = {
      ...target,
      id: `wf-${Date.now()}-${Math.random()}`,
      index: workflows.length + 1,
      status: 'idle',
      sceneImageUrl: undefined,
      videoUrl: undefined,
      error: undefined,
    };
    setWorkflows((prev) => [...prev, newWf]);
  };

  const uploadImageToBackend = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await axios.post(`${API.images}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.id || res.data.media_id;
  };

  const pollJob = async (jobId: string, maxWaitSeconds = 300): Promise<any> => {
    const start = Date.now();
    while (Date.now() - start < maxWaitSeconds * 1000) {
      if (abortRef.current) throw new Error('Đã hủy tiến trình!');
      await new Promise((r) => setTimeout(r, 4000));
      const res = await axios.get(`/api/generate/jobs/${jobId}`);
      const job = res.data;
      if (job.status === 'COMPLETED' || job.status === 'done' || job.status === 'SUCCESS') {
        return job;
      }
      if (job.status === 'FAILED' || job.status === 'error') {
        throw new Error(job.error || 'Tạo media thất bại');
      }
    }
    throw new Error('Hết thời gian chờ tạo (Timeout)');
  };

  const runSingleWorkflow = async (item: WorkflowItem): Promise<void> => {
    let refMediaId = item.refImageMediaId;
    if (!refMediaId && item.refImageFile) {
      try {
        refMediaId = await uploadImageToBackend(item.refImageFile);
        updateWorkflowField(item.id, { refImageMediaId: refMediaId });
      } catch (err: any) {
        console.warn('Lỗi upload ref image riêng:', err.message);
      }
    }

    if (!refMediaId && sharedRefImages.length > 0) {
      try {
        const firstShared = sharedRefImages[0];
        if (!firstShared.mediaId) {
          firstShared.mediaId = await uploadImageToBackend(firstShared.file);
        }
        refMediaId = firstShared.mediaId;
      } catch (err: any) {
        console.warn('Lỗi upload ref image chung:', err.message);
      }
    }

    const activePreview = item.refImagePreview || (sharedRefImages.length > 0 ? sharedRefImages[0].preview : undefined);
    const activeVoice = item.voice !== undefined ? item.voice : selectedVoice;
    const activeClearCache = item.clearCache !== undefined ? item.clearCache : clearCache;

    // ── MODE 2: DIRECT REF ➔ VIDEO (R2V) ──
    if (vType === 'r2v') {
      updateWorkflowField(item.id, {
        status: 'generating_video',
        progressMessage: 'Đang khởi tạo Video trực tiếp từ Ảnh tham chiếu (R2V)...',
        error: undefined,
      });

      try {
        const vidRes = await axios.post('/api/generate/video', {
          prompt: item.videoPrompt,
          ref_image_id: refMediaId,
          input_image_url: activePreview,
          model: item.videoModel,
          aspect_ratio: item.videoAspectRatio,
          voice: activeVoice,
          clear_cache: activeClearCache,
          project_id: settings.flowkitProjectId,
        });

        const vidJobData = vidRes.data;
        let generatedVideoUrl = '';

        if (vidJobData.job_id || vidJobData.id) {
          const completedVidJob = await pollJob(vidJobData.job_id || vidJobData.id);
          generatedVideoUrl = completedVidJob.result_url || completedVidJob.videoUrl || completedVidJob.url;
        } else if (vidJobData.url || vidJobData.videoUrl) {
          generatedVideoUrl = vidJobData.url || vidJobData.videoUrl;
        }

        if (!generatedVideoUrl) {
          throw new Error('Không nhận được đường dẫn video từ server');
        }

        updateWorkflowField(item.id, {
          videoUrl: generatedVideoUrl,
          status: 'completed',
          progressMessage: 'Tạo Video trực tiếp từ Ảnh tham chiếu thành công!',
        });

        addMedia({
          id: `vid-${Date.now()}`,
          url: generatedVideoUrl,
          type: 'video',
          prompt: item.videoPrompt,
          createdAt: new Date().toISOString(),
        });
        return;
      } catch (err: any) {
        updateWorkflowField(item.id, {
          status: 'error',
          error: `Lỗi tạo Video từ ảnh tham chiếu: ${err.message}`,
        });
        throw err;
      }
    }

    // ── MODE 1: REF ➔ SCENE IMAGE ➔ VIDEO ──
    updateWorkflowField(item.id, {
      status: 'generating_image',
      progressMessage: 'Đang tạo ảnh cảnh từ ảnh tham chiếu...',
      error: undefined,
    });

    let generatedImageUrl = '';
    try {
      const imgRes = await axios.post('/api/generate/image', {
        prompt: item.scenePrompt,
        aspect_ratio: item.imageAspectRatio,
        ref_image_id: refMediaId,
        project_id: settings.flowkitProjectId,
      });

      const jobData = imgRes.data;
      if (jobData.job_id || jobData.id) {
        const completedJob = await pollJob(jobData.job_id || jobData.id);
        generatedImageUrl = completedJob.result_url || completedJob.imageUrl || completedJob.url;
      } else if (jobData.url || jobData.imageUrl) {
        generatedImageUrl = jobData.url || jobData.imageUrl;
      }

      if (!generatedImageUrl) {
        throw new Error('Không nhận được đường dẫn ảnh cảnh từ server');
      }

      updateWorkflowField(item.id, {
        sceneImageUrl: generatedImageUrl,
        status: 'generating_video',
        progressMessage: 'Đã tạo ảnh cảnh! Đang khởi tạo video...',
      });
    } catch (err: any) {
      updateWorkflowField(item.id, {
        status: 'error',
        error: `Lỗi tạo ảnh cảnh: ${err.message}`,
      });
      throw err;
    }

    // Step 2: Generate Video from generated Scene Image
    try {
      const vidRes = await axios.post('/api/generate/video', {
        prompt: item.videoPrompt || item.scenePrompt,
        input_image_url: generatedImageUrl,
        model: item.videoModel,
        aspect_ratio: item.videoAspectRatio,
        voice: activeVoice,
        clear_cache: activeClearCache,
        project_id: settings.flowkitProjectId,
      });

      const vidJobData = vidRes.data;
      let generatedVideoUrl = '';

      if (vidJobData.job_id || vidJobData.id) {
        const completedVidJob = await pollJob(vidJobData.job_id || vidJobData.id);
        generatedVideoUrl = completedVidJob.result_url || completedVidJob.videoUrl || completedVidJob.url;
      } else if (vidJobData.url || vidJobData.videoUrl) {
        generatedVideoUrl = vidJobData.url || vidJobData.videoUrl;
      }

      if (!generatedVideoUrl) {
        throw new Error('Không nhận được đường dẫn video từ server');
      }

      updateWorkflowField(item.id, {
        videoUrl: generatedVideoUrl,
        status: 'completed',
        progressMessage: 'Hoàn thành tạo ảnh cảnh & video thành công!',
      });

      addMedia({
        id: `vid-${Date.now()}`,
        url: generatedVideoUrl,
        type: 'video',
        prompt: item.videoPrompt,
        createdAt: new Date().toISOString(),
      });
    } catch (err: any) {
      updateWorkflowField(item.id, {
        status: 'error',
        error: `Lỗi tạo video: ${err.message}`,
      });
      throw err;
    }
  };

  const startSequentialExecution = async () => {
    if (workflows.length === 0) {
      toast.error('Vui lòng tạo danh sách Workflow trước khi chạy!');
      return;
    }

    setIsRunning(true);
    abortRef.current = false;
    toast.success('▶️ Khởi chạy hàng chờ tuần tự (Chờ từng WF hoàn tất 100% mới sang WF sau)...');

    for (let i = 0; i < workflows.length; i++) {
      if (abortRef.current) {
        toast('⏸️ Đã dừng hàng chờ.', { icon: '⏸️' });
        break;
      }

      const wf = workflows[i];
      if (wf.status === 'completed') continue;

      setCurrentIndex(i);
      try {
        await runSingleWorkflow(wf);
        toast.success(`✅ WF #${wf.index} hoàn thành 100%!`);
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        toast.error(`❌ WF #${wf.index} thất bại: ${err.message}`);
      }
    }

    setIsRunning(false);
    setCurrentIndex(-1);
    toast.success('🎉 Đã hoàn tất xử lý tất cả Workflow tuần tự!');
  };

  const stopExecution = () => {
    abortRef.current = true;
    setIsRunning(false);
  };

  const computedModel = getComputedModel(vType, vTier, vDuration);

  return (
    <div className="w-full bg-[#0a0a12] border border-slate-800/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
      {/* ── HEADER ── */}
      <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border-b border-slate-800 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <img src="./logo.png" alt="Logo" className="w-9 h-9 object-contain rounded-lg shadow-md" />
          <div>
            <h2 className="text-base font-extrabold text-white tracking-wide flex items-center gap-2">
              Multi-Workflow Generator
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Cấu hình các chức năng tương tự Video Prompt Node & Độc lập Aspect Ratio
            </p>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition-all ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* ── VIDEO PROMPT CONFIG ROW (Tương tự Node Video) ── */}
      <div className="px-5 py-4 bg-slate-950/40 border-b border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        {/* Type selector (I2V / T2V / R2V) */}
        <div className="lg:col-span-3">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Loại (Type)</span>
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
            {TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setVType(t.key)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  vType === t.key
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tier selector */}
        <div className="lg:col-span-4">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Phân cấp (Tier)</span>
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 overflow-x-auto">
            {TIERS.map((t) => (
              <button
                key={t.key}
                onClick={() => setVTier(t.key)}
                className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${
                  vTier === t.key
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Time selector */}
        <div className="lg:col-span-3">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Thời lượng (Time)</span>
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
            {DURATIONS.map((dur) => (
              <button
                key={dur}
                onClick={() => setVDuration(dur)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  vDuration === dur
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {dur}
              </button>
            ))}
          </div>
        </div>

        {/* Model Key Display */}
        <div className="lg:col-span-2">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Model Chỉ Định</span>
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-center">
            <span className="text-[10px] font-mono text-indigo-400 font-bold block truncate" title={computedModel}>
              {computedModel || 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* ── TOOLBAR / CONTROLS GRID ── */}
      <div className="p-5 bg-slate-900/60 border-b border-slate-800/60 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
        {/* Số lượng WF & Tạo Button */}
        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
            1. Khởi Tạo Workflows
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={50}
              value={workflowCount}
              onChange={(e) => setWorkflowCount(parseInt(e.target.value) || 1)}
              className="w-20 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold text-center"
            />
            <button
              onClick={handleGenerateWorkflows}
              className="flex-1 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-extrabold transition-all shadow-md flex items-center justify-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" /> Tạo {workflowCount} WF
            </button>
          </div>
        </div>

        {/* Cấu hình Khung hình độc lập (Ảnh + Video) */}
        <div className="md:col-span-3 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Khung Hình Ảnh
            </label>
            <select
              value={defaultImageAspect}
              onChange={(e) => {
                setDefaultImageAspect(e.target.value);
                setWorkflows((prev) => prev.map((wf) => ({ ...wf, imageAspectRatio: e.target.value })));
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-semibold"
            >
              {IMAGE_ASPECT_RATIOS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Khung Hình Video
            </label>
            <select
              value={defaultVideoAspect}
              onChange={(e) => {
                setDefaultVideoAspect(e.target.value);
                setWorkflows((prev) => prev.map((wf) => ({ ...wf, videoAspectRatio: e.target.value })));
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-semibold"
            >
              {VIDEO_ASPECT_RATIOS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cấu hình Voice với Demo */}
        {vType === 'r2v' ? (
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>2. Giọng Đọc (Voice)</span>
              {selectedVoice && (
                <button
                  onClick={() => togglePlayVoiceDemo(selectedVoice)}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-bold transition-all flex items-center gap-1 ${
                    playingVoice === selectedVoice
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                  }`}
                >
                  <Volume2 className={`w-3.5 h-3.5 ${playingVoice === selectedVoice ? 'animate-bounce' : ''}`} />
                  {playingVoice === selectedVoice ? 'Dừng demo' : 'Nghe thử'}
                </button>
              )}
            </label>
            <select
              value={selectedVoice}
              onChange={(e) => {
                setSelectedVoice(e.target.value);
                setWorkflows((prev) => prev.map((wf) => ({ ...wf, voice: e.target.value })));
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-semibold animate-fadeIn"
            >
              {VOICES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              2. Giọng Đọc (Voice)
            </label>
            <div className="bg-slate-950/40 border border-slate-900 rounded-xl px-2.5 py-2 text-xs text-slate-500 font-medium h-[38px] flex items-center select-none" title="Chỉ R2V mới có voice">
              🚫 Voice chỉ dành cho R2V
            </div>
          </div>
        )}

        {/* Cấu hình Xoá Cache & Luồng */}
        <div className="md:col-span-3 space-y-1">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-1">
            Cấu Hình Cache & Luồng
          </label>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer bg-slate-950 px-2.5 py-2 rounded-xl border border-slate-800 text-[11px] font-semibold text-slate-300 flex-1 justify-center">
              <input
                type="checkbox"
                checked={clearCache}
                onChange={(e) => {
                  setClearCache(e.target.checked);
                  setWorkflows((prev) => prev.map((wf) => ({ ...wf, clearCache: e.target.checked })));
                }}
                className="rounded border-slate-700 text-indigo-600 focus:ring-0"
              />
              <span>Xoá Cache trước Gen</span>
            </label>
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800 text-[11px] font-bold text-indigo-400">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <select
                value={concurrentThreads}
                onChange={(e) => setConcurrentThreads(parseInt(e.target.value) || 1)}
                className="bg-transparent border-none text-[11px] font-bold text-indigo-400 focus:ring-0 p-0 cursor-pointer"
              >
                <option value={1} className="bg-slate-900 text-white">1 Luồng</option>
                <option value={2} className="bg-slate-900 text-white">2 Luồng</option>
                <option value={3} className="bg-slate-900 text-white">3 Luồng</option>
                <option value={4} className="bg-slate-900 text-white">4 Luồng</option>
                <option value={5} className="bg-slate-900 text-white">5 Luồng</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── EXECUTION BAR ── */}
      <div className="px-6 py-3 bg-slate-950/80 border-b border-slate-800 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          {!isRunning ? (
            <button
              onClick={startSequentialExecution}
              disabled={workflows.length === 0}
              className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white rounded-xl text-xs font-extrabold tracking-wider uppercase transition-all shadow-lg shadow-emerald-900/30 flex items-center gap-2 disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-white" /> Chạy Tuần Tự {workflows.length} Workflows (Chờ 100%)
            </button>
          ) : (
            <button
              onClick={stopExecution}
              className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-extrabold tracking-wider uppercase transition-all shadow-lg shadow-rose-900/30 flex items-center gap-2"
            >
              <Square className="w-4 h-4 fill-white" /> Tạm Dừng Hàng Chờ
            </button>
          )}

          {onExportToCanvas && (
            <button
              onClick={() => onExportToCanvas(workflows, pipelineMode, sharedRefImages, {
                voice: selectedVoice,
                clearCache,
                concurrent: concurrentThreads,
                vType,
                vTier,
                vDuration,
                imageAspect: defaultImageAspect,
                videoAspect: defaultVideoAspect
              })}
              disabled={workflows.length === 0}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-xl text-xs font-extrabold tracking-wider uppercase transition-all shadow-lg shadow-purple-900/30 flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              title="Tạo các node và liên kết trực tiếp trên Workflow Canvas"
            >
              <Sparkles className="w-4 h-4" /> Xuất {workflows.length} WF Node Ra Canvas
            </button>
          )}

          {workflows.length > 0 && (
            <span className="text-xs font-semibold text-slate-400">
              Tổng số:{' '}
              <strong className="text-white">{workflows.length}</strong> | Đã hoàn thành:{' '}
              <strong className="text-emerald-400">
                {workflows.filter((w) => w.status === 'completed').length}
              </strong>
            </span>
          )}
        </div>

        {/* Multiple shared reference images row */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ảnh Tham Chiếu Chung:</span>
          <div className="flex items-center gap-2 overflow-x-auto p-1 bg-slate-950 rounded-xl border border-slate-800 max-w-[280px] min-h-[38px]">
            {sharedRefImages.map((img) => (
              <div key={img.id} className="relative group flex-shrink-0 w-8 h-8 rounded-lg overflow-hidden border border-indigo-500/50">
                <img src={img.preview} alt="Shared Ref" className="w-full h-full object-cover" />
                <button
                  onClick={() => removeSharedRefImage(img.id)}
                  className="absolute inset-0 bg-rose-950/80 text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleSharedRefUpload}
              className="hidden"
              id="shared-ref-upload-multi-action"
            />
            <label
              htmlFor="shared-ref-upload-multi-action"
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-dashed border-slate-700 hover:border-indigo-500 rounded-lg text-[10px] text-slate-300 flex items-center gap-1 cursor-pointer transition-all flex-shrink-0 h-8 font-semibold"
            >
              <Plus className="w-3 h-3 text-indigo-400" />
              <span>{sharedRefImages.length > 0 ? 'Thêm' : 'Tải lên...'}</span>
            </label>
          </div>
        </div>
      </div>

      {/* ── WORKFLOW CARDS LIST ── */}
      <div className="p-6 overflow-y-auto flex-1 space-y-4">
        {workflows.length === 0 ? (
          <div className="py-16 text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/30">
            <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3 animate-pulse" />
            <h3 className="text-sm font-bold text-slate-300">Chưa có Workflow nào được khởi tạo</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              Chọn cấu hình ở thanh công cụ phía trên và nhấn nút <strong>"Tạo N WF"</strong> để tự động nhân bản các Workflow.
            </p>
          </div>
        ) : (
          workflows.map((wf) => (
            <div
              key={wf.id}
              className={`p-5 rounded-2xl border transition-all duration-300 bg-slate-900/40 backdrop-blur-md ${
                wf.status === 'generating_image' || wf.status === 'generating_video'
                  ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-lg shadow-indigo-950/50'
                  : wf.status === 'completed'
                  ? 'border-emerald-500/40 bg-emerald-950/10'
                  : wf.status === 'error'
                  ? 'border-rose-500/40 bg-rose-950/10'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Card Top Row */}
              <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 font-bold text-xs flex items-center justify-center">
                    #{wf.index}
                  </span>
                  <h4 className="text-xs font-bold text-white tracking-wide flex items-center gap-2">
                    Workflow Kịch Bản #{wf.index}
                    <span className="text-[10px] text-slate-500 font-medium">
                      (Model: {wf.videoModel})
                    </span>
                  </h4>

                  {/* Status Badges */}
                  {wf.status === 'idle' && (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 flex items-center gap-1 font-semibold">
                      <Clock className="w-3 h-3" /> Chờ chạy
                    </span>
                  )}
                  {wf.status === 'generating_image' && (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 font-semibold animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" /> Đang tạo ảnh cảnh...
                    </span>
                  )}
                  {wf.status === 'generating_video' && (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 font-semibold animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" /> Đang tạo video...
                    </span>
                  )}
                  {wf.status === 'completed' && (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-semibold">
                      <CheckCircle2 className="w-3 h-3" /> Hoàn thành 100%
                    </span>
                  )}
                  {wf.status === 'error' && (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 font-semibold">
                      <XCircle className="w-3 h-3" /> Lỗi
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {/* Aspect configuration selectors per workflow */}
                  <div className="flex items-center gap-2 mr-3 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 font-bold uppercase">Ảnh:</span>
                      <select
                        value={wf.imageAspectRatio}
                        onChange={(e) => updateWorkflowField(wf.id, { imageAspectRatio: e.target.value })}
                        className="bg-transparent border-none text-[10px] text-slate-300 font-semibold focus:ring-0 p-0 cursor-pointer"
                      >
                        {IMAGE_ASPECT_RATIOS.map((a) => (
                          <option key={a.value} value={a.value} className="bg-slate-900 text-white">
                            {a.label.split(' ')[0]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-px h-3.5 bg-slate-800" />
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-slate-500 font-bold uppercase">Vid:</span>
                      <select
                        value={wf.videoAspectRatio}
                        onChange={(e) => updateWorkflowField(wf.id, { videoAspectRatio: e.target.value })}
                        className="bg-transparent border-none text-[10px] text-slate-300 font-semibold focus:ring-0 p-0 cursor-pointer"
                      >
                        {VIDEO_ASPECT_RATIOS.map((a) => (
                          <option key={a.value} value={a.value} className="bg-slate-900 text-white">
                            {a.label.split(' ')[0]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {vType === 'r2v' && wf.voice !== undefined && (
                    <button
                      onClick={() => togglePlayVoiceDemo(wf.voice || '')}
                      disabled={!wf.voice}
                      className={`p-1.5 rounded-lg border transition-all ${
                        playingVoice === wf.voice && wf.voice
                          ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => duplicateWorkflow(wf.id)}
                    title="Nhân bản WF này"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition-all border border-slate-800"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removeWorkflow(wf.id)}
                    title="Xóa WF này"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-all border border-slate-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Card Inputs Grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Ref Image Column (3 cols) */}
                <div className="md:col-span-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-[11px] font-bold text-slate-300 uppercase">
                      Ảnh Tham Chiếu
                    </label>
                    {wf.refImagePreview ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                        Ảnh riêng
                      </span>
                    ) : sharedRefImages.length > 0 ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                        Chung ({sharedRefImages.length} ảnh)
                      </span>
                    ) : (
                      <span className="text-[9px] text-slate-500 font-semibold">Chưa có ảnh</span>
                    )}
                  </div>

                  {wf.refImagePreview ? (
                    <div className="relative group rounded-xl overflow-hidden border border-slate-700 bg-slate-950 aspect-video flex items-center justify-center shadow-md">
                      <img
                        src={wf.refImagePreview}
                        alt="Ref Preview"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-2 p-2">
                        <input
                          type="file"
                          accept="image/*"
                          id={`ref-change-${wf.id}`}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleCardRefUpload(wf.id, f);
                          }}
                        />
                        <label
                          htmlFor={`ref-change-${wf.id}`}
                          className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1 shadow-md"
                        >
                          <Upload className="w-3 h-3" /> Đổi ảnh riêng
                        </label>
                        <button
                          onClick={() => handleRemoveCardRef(wf.id)}
                          title="Bỏ ảnh riêng"
                          className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold transition-all shadow-md"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : sharedRefImages.length > 0 ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 overflow-x-auto p-1 bg-slate-950 rounded-xl border border-slate-800">
                        {sharedRefImages.map((sImg) => (
                          <div key={sImg.id} className="w-9 h-9 rounded-lg overflow-hidden border border-indigo-500/40 flex-shrink-0">
                            <img src={sImg.preview} alt="Shared Ref" className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                      <div className="relative">
                        <input
                          type="file"
                          accept="image/*"
                          id={`ref-input-override-${wf.id}`}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleCardRefUpload(wf.id, f);
                          }}
                        />
                        <label
                          htmlFor={`ref-input-override-${wf.id}`}
                          className="w-full py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-[9px] text-slate-400 hover:text-white flex items-center justify-center gap-1 cursor-pointer font-semibold transition-all"
                        >
                          <Plus className="w-3 h-3 text-indigo-400" /> Tải ảnh riêng cho WF này
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        id={`ref-input-${wf.id}`}
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleCardRefUpload(wf.id, f);
                        }}
                      />
                      <label
                        htmlFor={`ref-input-${wf.id}`}
                        className="w-full aspect-video border-2 border-dashed border-slate-800 hover:border-indigo-500/60 rounded-xl bg-slate-950/60 flex flex-col items-center justify-center cursor-pointer transition-all p-2 text-center group"
                      >
                        <ImageIcon className="w-6 h-6 text-slate-500 group-hover:text-indigo-400 mb-1.5 transition-colors" />
                        <span className="text-[10px] text-slate-300 font-bold">📷 Tải ảnh riêng</span>
                        <span className="text-[8px] text-slate-500 mt-0.5">Tải lên sau khi tạo WF bất cứ lúc nào</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Prompts Column (6 cols) */}
                <div className="md:col-span-6 space-y-3">
                  {vType !== 'r2v' ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 uppercase mb-1">
                          1. Prompt Tạo Ảnh Cảnh (Scene Image)
                        </label>
                        <textarea
                          rows={2}
                          value={wf.scenePrompt}
                          onChange={(e) => updateWorkflowField(wf.id, { scenePrompt: e.target.value })}
                          placeholder="Mô tả khung cảnh muốn sinh từ ảnh tham chiếu..."
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none font-medium"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 uppercase mb-1">
                          2. Prompt Tạo Video Chuyển Động (Image-to-Video)
                        </label>
                        <textarea
                          rows={2}
                          value={wf.videoPrompt}
                          onChange={(e) => updateWorkflowField(wf.id, { videoPrompt: e.target.value })}
                          placeholder="Mô tả chuyển động camera, hành động..."
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none font-medium"
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="block text-[11px] font-bold text-emerald-400 uppercase mb-1">
                        Prompt Tạo Video Trực Tiếp Từ Ảnh Tham Chiếu (R2V)
                      </label>
                      <textarea
                        rows={4}
                        value={wf.videoPrompt}
                        onChange={(e) => updateWorkflowField(wf.id, { videoPrompt: e.target.value })}
                        placeholder="Mô tả chi tiết chuyển động và bối cảnh sinh ra trực tiếp từ ảnh tham chiếu..."
                        className="w-full bg-slate-950 border border-emerald-500/30 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none font-medium"
                      />
                    </div>
                  )}
                </div>

                {/* Results Column (3 cols) */}
                <div className="md:col-span-3 space-y-2">
                  <label className="block text-[11px] font-bold text-slate-300 uppercase mb-1">
                    Kết Quả Sinh Media
                  </label>

                  {/* Scene Image Preview (Mode 1 Only) */}
                  {vType !== 'r2v' && (
                    wf.sceneImageUrl ? (
                      <div className="relative rounded-xl overflow-hidden border border-emerald-500/40 bg-slate-950 aspect-video group">
                        <img
                          src={resolveMediaUrl(wf.sceneImageUrl)}
                          alt="Scene Image"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-2">
                          <a
                            href={resolveMediaUrl(wf.sceneImageUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg bg-slate-800 text-white hover:bg-slate-700"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="aspect-video rounded-xl border border-slate-800/80 bg-slate-950/40 flex items-center justify-center text-[10px] text-slate-500 font-semibold">
                        Chưa có ảnh cảnh
                      </div>
                    )
                  )}

                  {/* Generated Video Preview */}
                  {wf.videoUrl ? (
                    <div className="relative rounded-xl overflow-hidden border border-indigo-500/40 bg-slate-950 aspect-video">
                      <video
                        src={resolveMediaUrl(wf.videoUrl)}
                        controls
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="aspect-video rounded-xl border border-slate-800/80 bg-slate-950/40 flex items-center justify-center text-[10px] text-slate-500 font-semibold">
                      Chưa có video
                    </div>
                  )}
                </div>
              </div>

              {/* Progress or Error Footer */}
              {wf.progressMessage && (
                <div className="mt-3 pt-2 border-t border-slate-800/60 text-[11px] font-semibold text-indigo-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> {wf.progressMessage}
                </div>
              )}
              {wf.error && (
                <div className="mt-3 pt-2 border-t border-rose-500/20 text-[11px] font-semibold text-rose-400 flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5" /> {wf.error}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MultiWorkflowPanel;
