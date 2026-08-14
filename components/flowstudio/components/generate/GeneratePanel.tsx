import React, { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  Sparkles, ImagePlus, X, Upload, Loader2,
  Wand2, Film, Camera, ChevronDown, Trash2, Users, Plus, UserPlus, Mic,
  Tag, AlertCircle, CheckCircle2, Clock
} from 'lucide-react';
import { API } from '../../config';
import { useProjectStore } from '../../store/useProjectStore';

type GenerateMode = 'text-to-image' | 'ref-to-image' | 'text-to-video' | 'image-to-video' | 'ref-to-video';

const MAX_REFS = 10; // Maximum reference images for R2I

interface ReferenceImage {
  file: File;
  preview: string;
  mediaId?: string;
  uploading?: boolean;
  // Named reference for R2I
  refName?: string;  // human name e.g. "Nhân vật chính"
  refId?: string;    // short ID e.g. "ref1", "ref2" ... "ref10"
}

interface Character {
  id: string;
  name: string;
  images: ReferenceImage[];
  entityId?: string;
  creating?: boolean;
  voice?: string;
  personality?: string;
  dialogSample?: string;
  voiceMediaId?: string;
}

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

const MODES: { key: GenerateMode; label: string; icon: React.ReactNode; desc: string; color: string }[] = [
  { key: 'text-to-image', label: 'Text → Image', icon: <Wand2 className="w-4 h-4" />, desc: 'Tạo ảnh từ mô tả text', color: 'indigo' },
  { key: 'ref-to-image', label: 'Reference → Image', icon: <ImagePlus className="w-4 h-4" />, desc: 'Tạo ảnh với ảnh tham chiếu (tối đa 10)', color: 'violet' },
  { key: 'text-to-video', label: 'Text → Video', icon: <Film className="w-4 h-4" />, desc: 'Tạo video từ mô tả text', color: 'emerald' },
  { key: 'image-to-video', label: 'Image → Video', icon: <Camera className="w-4 h-4" />, desc: 'Tạo video từ ảnh bắt đầu', color: 'amber' },
  { key: 'ref-to-video', label: 'Ref → Video', icon: <Users className="w-4 h-4" />, desc: 'Tạo video từ nhân vật tham chiếu', color: 'rose' },
];

const ASPECT_RATIOS_IMAGE = [
  { value: 'IMAGE_ASPECT_RATIO_LANDSCAPE', label: '16:9 Landscape' },
  { value: 'IMAGE_ASPECT_RATIO_PORTRAIT', label: '9:16 Portrait' },
  { value: 'IMAGE_ASPECT_RATIO_SQUARE', label: '1:1 Square' },
];

const ASPECT_RATIOS_VIDEO = [
  { value: 'VIDEO_ASPECT_RATIO_LANDSCAPE', label: '16:9 Landscape' },
  { value: 'VIDEO_ASPECT_RATIO_PORTRAIT', label: '9:16 Portrait' },
  { value: 'VIDEO_ASPECT_RATIO_SQUARE', label: '1:1 Square' },
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

const I2V_MODELS = [
  // Quality
  { value: 'veo_3_1_i2v_s', label: '💎 Veo 3.1 Quality 8s (100cr)' },
  // Fast / Pro
  { value: 'veo_3_1_i2v_s_fast', label: '⭐ Veo 3.1 Pro (Fast) 8s (10cr)' },
  { value: 'veo_3_1_i2v_s_fast_4s', label: '⭐ Veo 3.1 Pro (Fast) 4s (10cr)' },
  { value: 'veo_3_1_i2v_s_fast_6s', label: '⭐ Veo 3.1 Pro (Fast) 6s (10cr)' },
  // Lite (5cr)
  { value: 'veo_3_1_i2v_s_lite', label: '🔵 Veo 3.1 Lite 8s (5cr)' },
  { value: 'veo_3_1_i2v_s_lite_4s', label: '🔵 Veo 3.1 Lite 4s (5cr)' },
  { value: 'veo_3_1_i2v_s_lite_6s', label: '🔵 Veo 3.1 Lite 6s (5cr)' },
  // Lite Low (FREE)
  { value: 'veo_3_1_i2v_lite_low_priority', label: '🆓 Veo 3.1 Lite Low 8s (FREE)' },
  { value: 'veo_3_1_i2v_s_lite_4s_low_priority', label: '🆓 Veo 3.1 Lite Low 4s (FREE)' },
  { value: 'veo_3_1_i2v_s_lite_6s_low_priority', label: '🆓 Veo 3.1 Lite Low 6s (FREE)' },
  // Omni
  { value: 'abra_i2v_4s', label: '⚡ Omni Flash 4s' },
  { value: 'abra_i2v_6s', label: '⚡ Omni Flash 6s' },
  { value: 'abra_i2v_8s', label: '⚡ Omni Flash 8s' },
  { value: 'abra_i2v_10s', label: '⚡ Omni Flash 10s' },
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
      return defaultModel;
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
    cleanPrompt = cleanPrompt.replace(flagRegex, '').replace(bracketRegex, '').trim();
  }

  return { cleanPrompt, model };
};

interface GeneratePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: () => void;
  initialImageUrl?: string;
}

export default function GeneratePanel({ isOpen, onClose, onGenerated, initialImageUrl }: GeneratePanelProps) {
  const settings = useProjectStore((s) => s.settings);
  const flowkitStatus = useProjectStore((s) => s.flowkitStatus);

  const [mode, setMode] = useState<GenerateMode>('text-to-image');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('IMAGE_ASPECT_RATIO_LANDSCAPE');
  const [videoModel, setVideoModel] = useState('veo_3_1_i2v_lite_low_priority');
  const [isGenerating, setIsGenerating] = useState(false);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [startImage, setStartImage] = useState<ReferenceImage | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [newCharName, setNewCharName] = useState('');
  const charImgInputRef = useRef<HTMLInputElement>(null);
  const [activeCharId, setActiveCharId] = useState<string | null>(null);
  // Track which ref is being renamed
  const [editingRefId, setEditingRefId] = useState<string | null>(null);

  const refInputRef = useRef<HTMLInputElement>(null);
  const startInputRef = useRef<HTMLInputElement>(null);

  // Step progress state for generate flow
  type GenStep = 'idle' | 'uploading' | 'creating' | 'submitted' | 'done' | 'error';
  const [genStep, setGenStep] = useState<GenStep>('idle');
  const [genStepMsg, setGenStepMsg] = useState('');

  // Upload reference image to FlowKit
  const uploadRef = useCallback(async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', settings.flowkitProjectId);
    try {
      const res = await axios.post(API.uploadReference, formData);
      if (res.data.success) {
        return res.data.media_id;
      }
      toast.error('Upload reference failed');
      return null;
    } catch {
      toast.error('Upload reference failed');
      return null;
    }
  }, [settings.flowkitProjectId]);

  // Create a new character (local only — entity created on first R2V use)
  const handleCreateCharacter = useCallback(() => {
    const name = newCharName.trim();
    if (!name) { toast.error('Nhập tên nhân vật'); return; }

    const newChar: Character = {
      id: `char_${Date.now()}`,
      name,
      images: [],
    };
    setCharacters(prev => [...prev, newChar]);
    setNewCharName('');
    toast.success(`Nhân vật "${name}" đã tạo!`);
  }, [newCharName]);

  // Upload image for a character
  const handleCharImageUpload = useCallback(async (files: FileList | null) => {
    if (!files || !activeCharId) return;
    for (const file of Array.from(files)) {
      const preview = URL.createObjectURL(file);
      const newRef: ReferenceImage = { file, preview, uploading: true };
      setCharacters(prev => prev.map(c =>
        c.id === activeCharId ? { ...c, images: [...c.images, newRef] } : c
      ));

      const mediaId = await uploadRef(file);
      setCharacters(prev => prev.map(c =>
        c.id === activeCharId
          ? { ...c, images: c.images.map(img => img.preview === preview ? { ...img, mediaId: mediaId || undefined, uploading: false } : img) }
          : c
      ));
    }
  }, [activeCharId, uploadRef]);

  // Remove a character
  const removeCharacter = (charId: string) => {
    setCharacters(prev => prev.filter(c => c.id !== charId));
  };

  // Remove image from character
  const removeCharImage = (charId: string, preview: string) => {
    setCharacters(prev => prev.map(c =>
      c.id === charId ? { ...c, images: c.images.filter(img => img.preview !== preview) } : c
    ));
  };

  const isVideo = mode === 'text-to-video' || mode === 'image-to-video' || mode === 'ref-to-video';

  // Auto-switch to I2V mode when initialImageUrl is provided
  useEffect(() => {
    if (!isOpen || !initialImageUrl) return;
    setMode('image-to-video');
    setAspectRatio('VIDEO_ASPECT_RATIO_LANDSCAPE');

    // Fetch the image and auto-upload as start image
    (async () => {
      try {
        const resp = await fetch(initialImageUrl);
        const blob = await resp.blob();
        const file = new File([blob], 'start_image.png', { type: blob.type });
        const preview = URL.createObjectURL(blob);
        setStartImage({ file, preview, uploading: true });

        const formData = new FormData();
        formData.append('file', file);
        formData.append('project_id', settings.flowkitProjectId);
        const res = await axios.post(API.uploadStartImage, formData);
        if (res.data.success) {
          setStartImage((prev) => prev ? { ...prev, mediaId: res.data.media_id, uploading: false } : null);
        } else {
          toast.error('Upload start image failed');
          setStartImage(null);
        }
      } catch {
        toast.error('Failed to load image');
      }
    })();
  }, [isOpen, initialImageUrl, settings.flowkitProjectId]);

  // Auto-set default model and aspect ratio when mode changes
  useEffect(() => {
    if (mode === 'text-to-video') {
      setVideoModel('veo_3_1_t2v_fast');
      setAspectRatio('VIDEO_ASPECT_RATIO_LANDSCAPE');
    } else if (mode === 'image-to-video') {
      setVideoModel('veo_3_1_i2v_s_fast');
      setAspectRatio('VIDEO_ASPECT_RATIO_LANDSCAPE');
    } else if (mode === 'ref-to-video') {
      setVideoModel('veo_3_1_r2v_fast_landscape');
      setAspectRatio('VIDEO_ASPECT_RATIO_LANDSCAPE');
    } else {
      setAspectRatio('IMAGE_ASPECT_RATIO_LANDSCAPE');
    }
  }, [mode]);

  // ── R2I: Handle reference file pick (up to MAX_REFS) ──────────────
  const handleRefFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const currentCount = referenceImages.length;
    const remaining = MAX_REFS - currentCount;
    if (remaining <= 0) {
      toast.error(`Đã đạt tối đa ${MAX_REFS} ảnh tham chiếu`);
      return;
    }

    const fileArr = Array.from(files).slice(0, remaining);
    if (fileArr.length < Array.from(files).length) {
      toast(`Chỉ thêm được ${remaining} ảnh nữa (tối đa ${MAX_REFS})`, { icon: '⚠️' });
    }

    // Assign sequential refIds
    const newRefs: ReferenceImage[] = fileArr.map((file, idx) => {
      const refNum = currentCount + idx + 1;
      return {
        file,
        preview: URL.createObjectURL(file),
        uploading: true,
        refId: `ref${refNum}`,
        refName: `Tham chiếu ${refNum}`,
      };
    });
    setReferenceImages((prev) => [...prev, ...newRefs]);

    // Upload each sequentially (ensures all get uploaded)
    for (let i = 0; i < newRefs.length; i++) {
      const mediaId = await uploadRef(newRefs[i].file);
      setReferenceImages((prev) =>
        prev.map((r) =>
          r.preview === newRefs[i].preview
            ? { ...r, mediaId: mediaId || undefined, uploading: false }
            : r
        )
      );
      if (!mediaId) {
        toast.error(`Upload thất bại: ${newRefs[i].refName}`);
      }
    }
  }, [referenceImages.length, uploadRef]);

  // Update ref name
  const updateRefName = (preview: string, name: string) => {
    setReferenceImages(prev => prev.map(r => r.preview === preview ? { ...r, refName: name } : r));
  };

  // Handle start image pick
  const handleStartImage = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const preview = URL.createObjectURL(file);
    setStartImage({ file, preview, uploading: true });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', settings.flowkitProjectId);
    try {
      const res = await axios.post(API.uploadStartImage, formData);
      if (res.data.success) {
        setStartImage((prev) => prev ? { ...prev, mediaId: res.data.media_id, uploading: false } : null);
      } else {
        toast.error('Upload start image failed');
        setStartImage(null);
      }
    } catch {
      toast.error('Upload start image failed');
      setStartImage(null);
    }
  }, [settings.flowkitProjectId]);

  const removeRef = (preview: string) => {
    setReferenceImages((prev) => {
      const filtered = prev.filter((r) => r.preview !== preview);
      // Reassign refIds after removal
      return filtered.map((r, idx) => ({ ...r, refId: `ref${idx + 1}` }));
    });
  };

  // Computed states
  const uploadingRefs = referenceImages.filter(r => r.uploading);
  const uploadingCount = uploadingRefs.length;
  const allUploaded = referenceImages.length > 0 && uploadingCount === 0;

  // Generate
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error('Vui lòng nhập prompt');
      return;
    }
    if (!settings.flowkitProjectId) {
      toast.error('Vui lòng nhập Project ID (Google Labs) ở Settings');
      return;
    }
    if (flowkitStatus !== 'connected') {
      toast.error('FlowAgent chưa kết nối. Hãy mở Flow tab và bật extension.');
      return;
    }

    // R2I: Block if any reference is still uploading
    if (mode === 'ref-to-image' && uploadingCount > 0) {
      toast.error(`⏳ Đang upload ${uploadingCount} ảnh, vui lòng chờ hoàn tất...`);
      return;
    }

    setIsGenerating(true);
    setGenStep('creating');
    setGenStepMsg(mode === 'ref-to-image'
      ? `🎨 Đang tạo ảnh từ ${referenceImages.length} ảnh tham chiếu...`
      : mode === 'text-to-image' ? '🧐 Đang tạo ảnh từ prompt...'
      : mode === 'text-to-video' ? '🎬 Đang tạo video...'
      : mode === 'image-to-video' ? '🎬 Đang render video từ ảnh...'
      : '🎭 Đang tạo video nhân vật...');

    try {
      if (isVideo) {
        // Check for model override tags
        let finalPrompt = prompt.trim();
        let finalModel = videoModel;

        const { cleanPrompt, model: resolvedModel } = parseModelOverride(finalPrompt, videoModel, mode);
        finalPrompt = cleanPrompt;
        finalModel = resolvedModel;

        // Video generation
        const payload: Record<string, unknown> = {
          prompt: finalPrompt,
          project_id: settings.flowkitProjectId,
          art_style: settings.globalArtStyle || '',
          video_model: finalModel,
          aspect_ratio: aspectRatio.replace('IMAGE_', 'VIDEO_'),
        };

        if (mode === 'image-to-video' && startImage?.mediaId) {
          payload.start_image_media_id = startImage.mediaId;
        }

        // Collect reference media IDs based on mode
        let refIds: (string | undefined)[] = [];
        if (mode === 'ref-to-video') {
          // R2V: collect all character image media_ids
          refIds = characters.flatMap(c => c.images.filter(img => img.mediaId).map(img => img.mediaId));
          if (refIds.length === 0) {
            toast.error('Cần ít nhất 1 ảnh nhân vật đã upload');
            setIsGenerating(false);
            return;
          }
          // Lấy voice của nhân vật đầu tiên có cấu hình voice
          const activeVoiceChar = characters.find(c => c.voice);
          if (activeVoiceChar && activeVoiceChar.voice) {
            payload.audio_voice_id = activeVoiceChar.voice;
          }
        } else {
          refIds = referenceImages.filter((r) => r.mediaId).map((r) => r.mediaId);
        }
        if (refIds.length > 0) {
          payload.reference_media_ids = refIds;
        }

        const videoEndpoint = mode === 'ref-to-video' ? API.generateR2V : API.generateVideo;
        const res = await axios.post(videoEndpoint, payload);
        if (res.data.success) {
          setGenStep('submitted');
          setGenStepMsg('📤 Đã gửi lên máy chủ — video đang render, theo dõi tại Gallery...');
          toast.success(`📤 Video đã gửi render! Theo dõi tiến trình tại Gallery.`);
          onGenerated();
        } else {
          const errMsg = typeof res.data.error === 'object' ? JSON.stringify(res.data.error) : (res.data.error || 'Unknown error');
          toast.error(`Lỗi: ${errMsg}`);
        }
      } else {
        // Image generation
        const refIds = referenceImages.filter((r) => r.mediaId).map((r) => r.mediaId);

        // Validate R2I: need at least 1 ref with mediaId
        if (mode === 'ref-to-image' && refIds.length === 0) {
          toast.error('Vui lòng upload ít nhất 1 ảnh tham chiếu');
          setIsGenerating(false);
          return;
        }

        const payload: Record<string, unknown> = {
          prompt: prompt.trim(),
          project_id: settings.flowkitProjectId,
          art_style: settings.globalArtStyle || '',
          aspect_ratio: aspectRatio,
          reference_media_ids: refIds,
        };

        const res = await axios.post(API.generateImage, payload);
        if (res.data.success) {
          toast.success('✅ Ảnh đã tạo thành công! 🎨');
          setGenStep('done');
          setGenStepMsg('✅ Tạo ảnh thành công!');
          onGenerated();
        } else {
          toast.error(`Lỗi: ${JSON.stringify(res.data.error) || 'Unknown error'}`);
          setGenStep('error');
          setGenStepMsg(`❌ ${JSON.stringify(res.data.error)}`);
        }
      }
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) 
        ? (err.response?.data?.detail || err.message) 
        : (err instanceof Error ? err.message : 'Generate failed');
      toast.error(`Lỗi: ${msg}`);
      setGenStep('error');
      setGenStepMsg(`❌ ${msg.slice(0, 80)}`);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, settings, flowkitStatus, mode, isVideo, videoModel, aspectRatio, startImage, referenceImages, characters, onGenerated, uploadingCount]);

  // Reset step when mode changes
  useEffect(() => {
    setGenStep('idle');
    setGenStepMsg('');
  }, [mode]);

  if (!isOpen) return null;

  const currentMode = MODES.find((m) => m.key === mode)!;

  return (
    <div className="fixed inset-0 z-[80] modal-backdrop flex items-start justify-center pt-12 fade-in" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/50 slide-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <div className="absolute -inset-1 bg-indigo-500/20 rounded-full blur-sm" />
            </div>
            <h2 className="text-base font-bold text-white">AI Generate</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="px-6 pt-4 pb-3">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => {
              const isActive = mode === m.key;
              const colorMap: Record<string, string> = {
                indigo: isActive ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300' : '',
                violet: isActive ? 'bg-violet-500/15 border-violet-500/40 text-violet-300' : '',
                emerald: isActive ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : '',
                amber: isActive ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : '',
                rose: isActive ? 'bg-rose-500/15 border-rose-500/40 text-rose-300' : '',
              };
              return (
                <button
                  key={m.key}
                  onClick={() => {
                    setMode(m.key);
                    if (m.key === 'text-to-video' || m.key === 'image-to-video') {
                      setAspectRatio('VIDEO_ASPECT_RATIO_LANDSCAPE');
                    } else {
                      setAspectRatio('IMAGE_ASPECT_RATIO_LANDSCAPE');
                    }
                  }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${
                    isActive
                      ? colorMap[m.color]
                      : 'border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  {m.icon}
                  <span className="text-[11px] font-semibold leading-tight">{m.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 mt-2 text-center">{currentMode.desc}</p>
        </div>

        {/* Body */}
        <div className="px-6 pb-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Prompt */}
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="w-full bg-slate-950 text-slate-200 text-sm p-3 rounded-xl border border-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 resize-none transition-all placeholder:text-slate-600"
              placeholder={isVideo ? 'Mô tả cảnh video bạn muốn tạo...' : 'Mô tả hình ảnh bạn muốn tạo...'}
            />

            {/* R2I Prompt Helper — shows ref IDs/names to use in prompt */}
            {mode === 'ref-to-image' && referenceImages.length > 0 && (
              <div className="mt-2 p-2.5 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                <p className="text-[9px] font-bold text-violet-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Tag className="w-3 h-3" />
                  Gọi tham chiếu trong prompt bằng ID hoặc tên:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {referenceImages.map((ref) => (
                    <div key={ref.preview} className="flex items-center gap-1 bg-violet-500/10 border border-violet-500/20 rounded px-1.5 py-0.5">
                      <span className="text-[9px] font-mono text-violet-300">[{ref.refId}]</span>
                      <span className="text-[9px] text-slate-400">→</span>
                      <span className="text-[9px] text-violet-200">{ref.refName}</span>
                      {ref.uploading && <Loader2 className="w-2.5 h-2.5 text-violet-400 animate-spin ml-0.5" />}
                      {ref.mediaId && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 ml-0.5" />}
                    </div>
                  ))}
                </div>
                <p className="text-[8px] text-slate-500 mt-1.5">
                  Ví dụ: <span className="text-violet-400 font-mono">Tạo ảnh nhân vật [ref1] đang ngồi cạnh [ref2] trong rừng</span>
                </p>
              </div>
            )}
          </div>

          {/* ── Reference Images — for ref-to-image mode ───────────── */}
          {mode === 'ref-to-image' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ImagePlus className="w-3 h-3" />
                  Ảnh tham chiếu ({referenceImages.length}/{MAX_REFS})
                </label>
                {uploadingCount > 0 && (
                  <span className="flex items-center gap-1 text-[9px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                    <Clock className="w-2.5 h-2.5 animate-pulse" />
                    Đang upload {uploadingCount} ảnh...
                  </span>
                )}
                {allUploaded && referenceImages.length > 0 && (
                  <span className="flex items-center gap-1 text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Tất cả đã sẵn sàng
                  </span>
                )}
              </div>

              {/* Reference grid */}
              <div className="grid grid-cols-5 gap-2">
                {referenceImages.map((ref) => (
                  <div key={ref.preview} className="space-y-1">
                    <div className="relative group w-full aspect-square rounded-lg overflow-hidden border border-slate-700">
                      <img src={ref.preview} className="w-full h-full object-cover" alt="ref" />
                      {/* Upload overlay */}
                      {ref.uploading && (
                        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1">
                          <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                          <span className="text-[7px] text-violet-300">Upload...</span>
                        </div>
                      )}
                      {/* Uploaded indicator */}
                      {ref.mediaId && !ref.uploading && (
                        <div className="absolute top-1 right-1 w-3 h-3 rounded-full bg-emerald-400 border border-emerald-600 shadow" />
                      )}
                      {/* Failed indicator */}
                      {!ref.uploading && !ref.mediaId && (
                        <div className="absolute top-1 right-1">
                          <AlertCircle className="w-3 h-3 text-red-400" />
                        </div>
                      )}
                      {/* ID badge */}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1 pt-2 pb-0.5">
                        <span className="text-[8px] font-mono text-violet-300">{ref.refId}</span>
                      </div>
                      {/* Remove button */}
                      <button
                        onClick={() => removeRef(ref.preview)}
                        className="absolute top-1 left-1 p-0.5 rounded bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                    {/* Editable name */}
                    <input
                      value={ref.refName || ''}
                      onChange={(e) => updateRefName(ref.preview, e.target.value)}
                      onFocus={() => setEditingRefId(ref.preview)}
                      onBlur={() => setEditingRefId(null)}
                      className={`w-full bg-slate-950 text-[8px] text-slate-300 px-1 py-0.5 rounded border transition-colors focus:outline-none truncate ${
                        editingRefId === ref.preview
                          ? 'border-violet-500/50 text-violet-200'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                      placeholder="Tên tham chiếu"
                      title="Click để đặt tên cho tham chiếu này"
                    />
                  </div>
                ))}

                {/* Add button */}
                {referenceImages.length < MAX_REFS && (
                  <button
                    onClick={() => refInputRef.current?.click()}
                    className="aspect-square rounded-lg border-2 border-dashed border-slate-700 hover:border-violet-500/50 flex flex-col items-center justify-center text-slate-500 hover:text-violet-400 transition-all hover:bg-violet-500/5"
                    title={`Thêm ảnh tham chiếu (còn ${MAX_REFS - referenceImages.length} chỗ)`}
                  >
                    <Upload className="w-4 h-4 mb-1" />
                    <span className="text-[8px]">Thêm</span>
                    <span className="text-[7px] text-slate-600">{referenceImages.length}/{MAX_REFS}</span>
                  </button>
                )}
              </div>

              <input
                ref={refInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                multiple
                onChange={(e) => { handleRefFiles(e.target.files); if (e.target) e.target.value = ''; }}
              />

              {/* Info hint */}
              <div className="mt-2 flex items-start gap-1.5 text-[9px] text-slate-500">
                <AlertCircle className="w-3 h-3 text-violet-400/60 flex-shrink-0 mt-0.5" />
                <span>
                  Tối đa <strong className="text-violet-400">{MAX_REFS} ảnh</strong>. Đặt tên rõ ràng để dễ gọi trong prompt.
                  Nút Generate sẽ <strong className="text-amber-400">chờ</strong> cho đến khi tất cả ảnh upload xong.
                </span>
              </div>
            </div>
          )}

          {/* Character Management — for ref-to-video mode */}
          {mode === 'ref-to-video' && (
            <div className="space-y-3">
              {/* Create new character */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <UserPlus className="w-3 h-3" />
                  Tạo nhân vật mới
                </label>
                <div className="flex gap-2">
                  <input
                    value={newCharName}
                    onChange={(e) => setNewCharName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateCharacter()}
                    className="flex-1 bg-slate-950 text-slate-200 text-sm px-3 py-2 rounded-lg border border-slate-700 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500/30 transition-all placeholder:text-slate-600"
                    placeholder="Nhập tên nhân vật..."
                  />
                  <button
                    onClick={handleCreateCharacter}
                    disabled={!newCharName.trim()}
                    className="px-3 py-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 text-xs font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Tạo
                  </button>
                </div>
              </div>

              {/* Character list */}
              {characters.length > 0 && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-3 h-3" />
                    Nhân vật ({characters.length})
                  </label>
                  {characters.map((char) => (
                    <div key={char.id} className="bg-slate-900/60 rounded-xl border border-slate-700/50 p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-emerald-400" />
                          <span className="text-sm font-medium text-slate-200">{char.name}</span>
                          {char.voice && <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">🎤 {char.voice}</span>}
                        </div>
                        <button
                          onClick={() => removeCharacter(char.id)}
                          className="p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {/* Character images */}
                      <div className="flex flex-wrap gap-1.5">
                        {char.images.map((img) => (
                          <div key={img.preview} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-slate-700">
                            <img src={img.preview} className="w-full h-full object-cover" alt="char" />
                            {img.uploading && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <Loader2 className="w-4 h-4 text-rose-400 animate-spin" />
                              </div>
                            )}
                            {img.mediaId && (
                              <div className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-emerald-600" />
                            )}
                            <button
                              onClick={() => removeCharImage(char.id, img.preview)}
                              className="absolute top-0.5 left-0.5 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => { setActiveCharId(char.id); charImgInputRef.current?.click(); }}
                          disabled={char.creating}
                          className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-700 hover:border-rose-500/50 flex flex-col items-center justify-center text-slate-500 hover:text-rose-400 transition-all hover:bg-rose-500/5 disabled:opacity-40"
                        >
                          <Upload className="w-3.5 h-3.5 mb-0.5" />
                          <span className="text-[8px]">Add</span>
                        </button>
                      </div>
                      {/* Voice & Personality */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] text-slate-500 flex items-center gap-1 mb-1"><Mic className="w-2.5 h-2.5" /> Giọng nói</label>
                          <select
                            value={char.voice || ''}
                            onChange={(e) => setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, voice: e.target.value || undefined } : c))}
                            className="w-full bg-slate-950 text-slate-300 text-[11px] px-2 py-1.5 rounded-lg border border-slate-700 focus:border-indigo-500 focus:outline-none"
                          >
                            {VOICES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] text-slate-500 mb-1 block">💫 Tính cách</label>
                          <input
                            value={char.personality || ''}
                            onChange={(e) => setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, personality: e.target.value } : c))}
                            className="w-full bg-slate-950 text-slate-300 text-[11px] px-2 py-1.5 rounded-lg border border-slate-700 focus:border-indigo-500 focus:outline-none placeholder:text-slate-600"
                            placeholder="Ví dụ: vui vẻ, lạnh lùng..."
                          />
                        </div>
                      </div>
                      {/* Dialog sample */}
                      {char.voice && (
                        <div>
                          <label className="text-[9px] text-slate-500 mb-1 block">💬 Hội thoại mẫu (tạo voice)</label>
                          <input
                            value={char.dialogSample || ''}
                            onChange={(e) => setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, dialogSample: e.target.value } : c))}
                            className="w-full bg-slate-950 text-slate-300 text-[11px] px-2 py-1.5 rounded-lg border border-slate-700 focus:border-indigo-500 focus:outline-none placeholder:text-slate-600"
                            placeholder="Ví dụ: Xin chào, tôi là..."
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <input
                    ref={charImgInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    multiple
                    onChange={(e) => { handleCharImageUpload(e.target.files); if (e.target) e.target.value = ''; }}
                  />
                </div>
              )}
              <p className="text-[10px] text-slate-500">Tạo nhân vật, upload ảnh tham chiếu rồi tạo video</p>
            </div>
          )}

          {/* Start Image — for image-to-video mode */}
          {mode === 'image-to-video' && (
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Camera className="w-3 h-3" />
                Start Image (ảnh bắt đầu)
              </label>
              {startImage ? (
                <div className="relative w-40 h-24 rounded-lg overflow-hidden border border-slate-700 group">
                  <img src={startImage.preview} className="w-full h-full object-cover" alt="start" />
                  {startImage.uploading && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                    </div>
                  )}
                  {startImage.mediaId && (
                    <div className="absolute top-1 right-1 w-3 h-3 rounded-full bg-emerald-400 border border-emerald-600" />
                  )}
                  <button
                    onClick={() => setStartImage(null)}
                    className="absolute top-1 left-1 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startInputRef.current?.click()}
                  className="w-40 h-24 rounded-lg border-2 border-dashed border-slate-700 hover:border-amber-500/50 flex flex-col items-center justify-center text-slate-500 hover:text-amber-400 transition-all hover:bg-amber-500/5"
                >
                  <Upload className="w-5 h-5 mb-1" />
                  <span className="text-[10px]">Upload ảnh</span>
                </button>
              )}
              <input
                ref={startInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={(e) => handleStartImage(e.target.files)}
              />
              <p className="text-[10px] text-slate-500 mt-1">Video sẽ bắt đầu từ ảnh này và animate theo prompt</p>
            </div>
          )}

          {/* Advanced Settings */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              Advanced Settings
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-2 border-l-2 border-slate-800 slide-up">
                {/* Aspect Ratio */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Aspect Ratio</label>
                  <div className="flex gap-2">
                    {(isVideo ? ASPECT_RATIOS_VIDEO : ASPECT_RATIOS_IMAGE).map((ar) => (
                      <button
                        key={ar.value}
                        onClick={() => setAspectRatio(ar.value)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                          aspectRatio === ar.value
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                            : 'border-slate-700 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        {ar.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Video Model */}
                {isVideo && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Video Model</label>
                    <div className="flex flex-wrap gap-2">
                      {(mode === 'text-to-video' ? T2V_MODELS : mode === 'ref-to-video' ? R2V_MODELS : I2V_MODELS).map((vm) => (
                        <button
                          key={vm.value}
                          onClick={() => setVideoModel(vm.value)}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                            videoModel === vm.value
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'border-slate-700 text-slate-400 hover:border-slate-600'
                          }`}
                        >
                          {vm.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Art Style display */}
                {settings.globalArtStyle && (
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span className="font-bold uppercase tracking-wider">Art Style:</span>
                    <span className="text-indigo-300">{settings.globalArtStyle}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Progress Timeline ── shows when actively generating or done ── */}
        {genStep !== 'idle' && (
          <div className="px-6 pb-4 bg-slate-900/90 border-t border-slate-800/40">
            {/* Steps row */}
            <div className="flex items-center gap-0 mt-3 flex-wrap gap-y-2">
              {/* Step 1: Upload ảnh (chỉ cho R2I) */}
              {mode === 'ref-to-image' && (
                <>
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                    uploadingCount > 0
                      ? 'bg-blue-500/15 border border-blue-500/30 text-blue-300'
                      : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  }`}>
                    {uploadingCount > 0
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <CheckCircle2 className="w-3 h-3" />
                    }
                    {uploadingCount > 0 ? `Tải ${uploadingCount} ảnh lên...` : `✓ ${referenceImages.length} ảnh đã upload`}
                  </div>
                  <div className={`h-px w-4 mx-1 flex-shrink-0 ${genStep === 'done' || genStep === 'creating' ? 'bg-amber-500' : 'bg-slate-700'}`} />
                </>
              )}

              {/* Step 2: Đang tạo */}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                genStep === 'creating'
                  ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                  : (genStep === 'done' || genStep === 'submitted')
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  : genStep === 'error'
                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                  : 'bg-slate-800 border border-slate-700 text-slate-500'
              }`}>
                {genStep === 'creating' && <Loader2 className="w-3 h-3 animate-spin" />}
                {(genStep === 'done' || genStep === 'submitted') && <CheckCircle2 className="w-3 h-3" />}
                {genStep === 'error' && <AlertCircle className="w-3 h-3" />}
                {genStep === 'creating'
                  ? (isVideo ? 'Đang gửi yêu cầu...' : 'Đang tạo ảnh...')
                  : genStep === 'done' ? '✓ Tạo ảnh xong'
                  : genStep === 'submitted' ? '✓ Đã gửi'
                  : genStep === 'error' ? 'Lỗi'
                  : (isVideo ? 'Tạo video' : 'Tạo ảnh')}
              </div>

              {isVideo && genStep !== 'error' && (
                <>
                  <div className={`h-px w-4 mx-1 flex-shrink-0 ${genStep === 'submitted' ? 'bg-blue-500' : 'bg-slate-700'}`} />
                  {/* Step 3: Đang render trên máy chủ */}
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                    genStep === 'submitted'
                      ? 'bg-blue-500/15 border border-blue-500/30 text-blue-300 animate-pulse'
                      : 'bg-slate-800 border border-slate-700 text-slate-500'
                  }`}>
                    {genStep === 'submitted' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                    {genStep === 'submitted' ? '⏳ Đang render trên máy chủ...' : 'Chờ render'}
                  </div>
                </>
              )}
            </div>

            {/* Current step message */}
            {genStepMsg && (
              <p className={`text-[10px] mt-2 font-medium ${
                genStep === 'creating' ? 'text-amber-400' :
                genStep === 'done' ? 'text-emerald-400' :
                genStep === 'submitted' ? 'text-blue-400' :
                genStep === 'error' ? 'text-red-400' :
                'text-blue-400'
              }`}>
                {genStepMsg}
              </p>
            )}

            {/* Animated progress bar */}
            {genStep === 'creating' && (
              <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: '75%',
                    background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 50%, #f59e0b 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            )}
            {genStep === 'done' && (
              <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full w-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, #10b981, #34d399)', boxShadow: '0 0 8px rgba(16,185,129,0.4)' }}
                />
              </div>
            )}
            {genStep === 'submitted' && (
              <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: '60%',
                    background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #3b82f6 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'pulse 2s ease-in-out infinite',
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-900/90 flex items-center justify-between">
          <div className="text-[10px] text-slate-500">
            {flowkitStatus === 'connected' ? (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                FlowAgent Connected
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                FlowAgent Disconnected
              </span>
            )}
          </div>

          {/* Upload progress for R2I */}
          {mode === 'ref-to-image' && uploadingCount > 0 && (
            <span className="text-[10px] text-amber-400 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Uploading {uploadingCount}/{referenceImages.length}...
            </span>
          )}

          <button
            onClick={handleGenerate}
            disabled={
              isGenerating ||
              !prompt.trim() ||
              flowkitStatus !== 'connected' ||
              (mode === 'ref-to-image' && uploadingCount > 0)
            }
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              isVideo
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40'
            }`}
            title={mode === 'ref-to-image' && uploadingCount > 0 ? `Đang upload ${uploadingCount} ảnh, vui lòng chờ...` : ''}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : mode === 'ref-to-image' && uploadingCount > 0 ? (
              <>
                <Clock className="w-4 h-4" />
                Đang upload...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {isVideo ? 'Generate Video' : 'Generate Image'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
