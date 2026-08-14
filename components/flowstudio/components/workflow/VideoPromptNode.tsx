import React, { useContext, useState, useRef, useMemo } from 'react';
import { Handle, Position, NodeResizer, useNodes, useEdges } from '@xyflow/react';
import { Film, Trash2, FileText, Play, Loader2, Zap, RefreshCw, Image as ImageIcon, Video, AlertTriangle, Eraser, Shuffle, Mic, Volume2, Square } from 'lucide-react';
import { WorkflowContext } from './WorkflowContext';
import toast from 'react-hot-toast';
import { resolveMediaUrl } from '../../config';

const VIDEO_RATIOS = [
  { value: 'VIDEO_ASPECT_RATIO_LANDSCAPE', label: '16:9' },
  { value: 'VIDEO_ASPECT_RATIO_PORTRAIT', label: '9:16' },
  { value: 'VIDEO_ASPECT_RATIO_SQUARE', label: '1:1' },
];

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

const TYPES = [
  { key: 'i2v', label: 'I2V', icon: '🖼️' },
  { key: 't2v', label: 'T2V', icon: '✍️' },
  { key: 'r2v', label: 'R2V', icon: '🎭' },
];

const TIERS = [
  { key: 'quality', label: '💎', desc: '100cr' },
  { key: 'pro', label: '⭐', desc: '10cr' },
  { key: 'lite', label: '🔵', desc: '5cr' },
  { key: 'free', label: '🆓', desc: 'FREE' },
  { key: 'omni', label: '⚡', desc: 'Omni' },
];

const TIER_COLORS: Record<string, string> = {
  quality: 'text-purple-300 bg-purple-500/25 border-purple-500/50',
  pro: 'text-amber-300 bg-amber-500/25 border-amber-500/50',
  lite: 'text-blue-300 bg-blue-500/25 border-blue-500/50',
  free: 'text-emerald-300 bg-emerald-500/25 border-emerald-500/50',
  omni: 'text-yellow-300 bg-yellow-500/25 border-yellow-500/50',
};

const ALL_DURATIONS = ['4s', '6s', '8s', '10s'];

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

// Reverse lookup: model_key → { type, tier, duration }
function reverseModelLookup(modelKey: string): { type: string; tier: string; duration: string } | null {
  for (const [type, tiers] of Object.entries(MODEL_MAP)) {
    for (const [tier, durations] of Object.entries(tiers)) {
      for (const [duration, key] of Object.entries(durations)) {
        if (key === modelKey) return { type, tier, duration };
      }
    }
  }
  return null;
}

// Get available durations for type+tier
function getAvailDurations(type: string, tier: string): string[] {
  return Object.keys(MODEL_MAP[type]?.[tier] || {});
}

/**
 * VideoPromptNode — Nhập prompt video riêng biệt.
 * Chọn model bằng Type/Tier/Duration buttons + auto-chain.
 */
const VideoPromptNode: React.FC<any> = ({ id, data, selected }) => {
  const ctx = useContext(WorkflowContext);
  const allNodes = useNodes();
  const allEdges = useEdges();
  const [videoPrompt, setVideoPrompt] = useState((data.videoPrompt as string) || '');
  const [ratio, setRatio] = useState((data.videoAspectRatio as string) || 'VIDEO_ASPECT_RATIO_LANDSCAPE');
  const [concurrent, setConcurrent] = useState((data.concurrent as number) || 1);
  const [clearCache, setClearCache] = useState((data.clearCacheBeforeGen as boolean) || false);
  const [audioVoiceId, setAudioVoiceId] = useState((data.audioVoiceId as string) || '');
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isGen = data.isGeneratingVideo as boolean;
  const fileRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };
  }, []);

  // ── Model selector state (backward compatible with saved data.videoModel) ──
  const initState = useMemo(() => {
    // Try stored selector state first
    if (data.vType && data.vTier && data.vDuration) {
      return { type: data.vType, tier: data.vTier, duration: data.vDuration };
    }
    // Fallback: reverse lookup from old videoModel string
    if (data.videoModel) {
      const lookup = reverseModelLookup(data.videoModel as string);
      if (lookup) return lookup;
    }
    return { type: 'i2v', tier: 'free', duration: '8s' };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [vType, setVType] = useState(initState.type);
  const [vTier, setVTier] = useState(initState.tier);
  const [vDuration, setVDuration] = useState(initState.duration);

  // Available durations for current type+tier
  const availDurations = useMemo(() => getAvailDurations(vType, vTier), [vType, vTier]);

  // Computed model key
  const computedModel = useMemo(() => {
    if (vDuration === 'random') return '';
    return MODEL_MAP[vType]?.[vTier]?.[vDuration] || '';
  }, [vType, vTier, vDuration]);

  // Auto-fix: when changing type/tier, adjust duration if current is unavailable
  const handleTypeChange = (t: string) => {
    setVType(t);
    const avail = getAvailDurations(t, vTier);
    if (avail.length === 0) {
      // Tier not available for this type, find first available tier
      for (const tier of TIERS) {
        const ta = getAvailDurations(t, tier.key);
        if (ta.length > 0) {
          setVTier(tier.key);
          if (vDuration !== 'random' && !ta.includes(vDuration)) setVDuration(ta[0]);
          return;
        }
      }
    } else if (vDuration !== 'random' && !avail.includes(vDuration)) {
      setVDuration(avail.includes('8s') ? '8s' : avail[0]);
    }
  };

  const handleTierChange = (t: string) => {
    const avail = getAvailDurations(vType, t);
    if (avail.length === 0) return;
    setVTier(t);
    if (vDuration !== 'random' && !avail.includes(vDuration)) {
      setVDuration(avail.includes('8s') ? '8s' : avail[0]);
    }
  };

  const lines = videoPrompt.split('\n').filter(l => l.trim());

  // Find downstream VideoNodes
  const downstreamVideos = useMemo(() => {
    const childEdges = allEdges.filter(e => e.source === id);
    return childEdges
      .map(e => allNodes.find(n => n.id === e.target))
      .filter(n => n && n.type === 'video')
      .map(n => ({
        id: n!.id,
        videoUrl: (n!.data.videoUrl as string) || '',
        frameUrl: (n!.data.frameUrl as string) || '',
        prompt: (n!.data.prompt as string) || '',
        status: n!.data.videoUrl ? 'done' : (n!.data.isGeneratingVideo ? 'generating' : (n!.data.status === 'failed' ? 'failed' : 'pending')),
        promptIndex: (n!.data.promptIndex as number) || 0,
      }));
  }, [allNodes, allEdges, id]);

  // Find upstream ImageNodes count
  const upstreamImageCount = useMemo(() => {
    const parentEdges = allEdges.filter(e => e.target === id);
    let count = 0;
    for (const edge of parentEdges) {
      const srcNode = allNodes.find(n => n.id === edge.source);
      if (srcNode?.type === 'image') count++;
      if (srcNode?.type === 'prompt') {
        const promptChildren = allEdges.filter(e => e.source === srcNode.id && e.target !== id);
        count += promptChildren.filter(ce => allNodes.find(n => n.id === ce.target)?.type === 'image').length;
      }
    }
    return count;
  }, [allNodes, allEdges, id]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) { setVideoPrompt(text.trim()); data.videoPrompt = text.trim(); }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  const syncData = () => {
    let finalModel = computedModel;
    const finalType = vType;

    // Random: pick a random duration from available
    if (vDuration === 'random') {
      const avail = getAvailDurations(vType, vTier);
      if (avail.length > 0) {
        const randomDur = avail[Math.floor(Math.random() * avail.length)];
        finalModel = MODEL_MAP[vType]?.[vTier]?.[randomDur] || '';
      }
    }

    data.videoPrompt = videoPrompt;
    data.videoAspectRatio = ratio;
    data.videoModel = finalModel;
    data.videoModelType = finalType;
    data.concurrent = concurrent;
    data.clearCacheBeforeGen = clearCache;
    data.audioVoiceId = audioVoiceId; // Sync voice
    // Persist selector state
    data.vType = vType;
    data.vTier = vTier;
    data.vDuration = vDuration;
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

  const handleGen = () => { syncData(); ctx?.onGenVideoFromVideoPrompt?.(id); };

  const handleRegenImages = () => {
    const parentEdges = allEdges.filter(e => e.target === id);
    for (const edge of parentEdges) {
      const srcNode = allNodes.find(n => n.id === edge.source);
      if (srcNode?.type === 'prompt') {
        const prompt = (srcNode.data.prompt as string) || '';
        const prompts = prompt.split('\n').filter(l => l.trim());
        const r = (srcNode.data.aspectRatio as string) || 'IMAGE_ASPECT_RATIO_LANDSCAPE';
        if (prompts.length > 0) ctx?.onBatchGenImage?.(srcNode.id, prompts, r);
      }
    }
  };

  const handleRegenVideos = () => { syncData(); ctx?.onGenVideoFromVideoPrompt?.(id); };

  const handleRetryFailed = () => { syncData(); ctx?.onRetryFailedFromVideoPrompt?.(id); };

  // Summary label
  const tierInfo = TIERS.find(t => t.key === vTier);
  const doneVideos = downstreamVideos.filter(v => v.status === 'done');
  const genVideos = downstreamVideos.filter(v => v.status === 'generating');
  const failedVideos = downstreamVideos.filter(v => v.status === 'failed');
  const pendingVideos = downstreamVideos.filter(v => v.status === 'pending');

  return (
    <div className={`bg-slate-900 border rounded-xl shadow-xl overflow-hidden transition-all h-full w-full flex flex-col ${
      selected ? 'border-teal-400 shadow-[0_0_15px_rgba(20,184,166,0.3)]' : 'border-slate-700 hover:border-teal-500/50'
    }`}>
      <NodeResizer isVisible={selected} minWidth={260} minHeight={200}
        lineClassName="!border-teal-500/50" handleClassName="!w-2.5 !h-2.5 !bg-teal-500 !border-2 !border-slate-900 !rounded" />

      {/* Header */}
      <div className="bg-gradient-to-r from-teal-900/60 to-cyan-900/40 px-2 py-1.5 border-b border-slate-700/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Film className="w-3 h-3 text-teal-300" />
          <span className="font-bold text-[10px] uppercase tracking-wider text-teal-200">Video Prompt</span>
          {lines.length > 0 && (
            <span className="text-[8px] bg-teal-500/30 text-teal-300 px-1 py-0.5 rounded font-bold">{lines.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => fileRef.current?.click()} className="p-0.5 rounded hover:bg-teal-600/30 text-slate-500 hover:text-teal-400" title="Import .txt">
            <FileText className="w-3 h-3" />
          </button>
          <button onClick={() => ctx?.onDeleteNode(id)} className="p-0.5 rounded hover:bg-red-600/30 text-slate-500 hover:text-red-400">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <input ref={fileRef} type="file" className="hidden" accept=".txt,.text" onChange={handleFile} />

      <div className="p-2 space-y-1.5 flex-1 flex flex-col min-h-0">
        {/* Textarea */}
        <textarea
          className="nodrag nowheel w-full flex-1 min-h-[2rem] bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 resize-none focus:outline-none focus:border-teal-500 placeholder-slate-600 font-mono leading-relaxed"
          value={videoPrompt}
          onChange={(e) => setVideoPrompt(e.target.value)}
          onBlur={syncData}
          placeholder={"Nhập prompt video...\nMỗi dòng = 1 video\n📄 Import file .txt"}
        />

        {/* ── Model Selector: 3-row compact buttons ── */}
        <div className="space-y-0.5 shrink-0 nodrag">
          {/* Row 1: Type */}
          <div className="flex items-center gap-0.5">
            <span className="text-[7px] text-slate-600 w-6 shrink-0 font-bold">Type</span>
            <div className="flex gap-0.5 flex-1">
              {TYPES.map(t => (
                <button key={t.key}
                  onClick={() => handleTypeChange(t.key)}
                  className={`flex-1 px-0.5 py-[3px] rounded text-[8px] font-bold transition-all border ${
                    vType === t.key
                      ? 'bg-teal-600/30 text-teal-300 border-teal-500/50'
                      : 'bg-slate-800/60 text-slate-500 border-slate-700/40 hover:text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: Tier */}
          <div className="flex items-center gap-0.5">
            <span className="text-[7px] text-slate-600 w-6 shrink-0 font-bold">Tier</span>
            <div className="flex gap-0.5 flex-1">
              {TIERS.map(t => {
                const avail = getAvailDurations(vType, t.key).length > 0;
                const isActive = vTier === t.key;
                return (
                  <button key={t.key}
                    onClick={() => avail && handleTierChange(t.key)}
                    disabled={!avail}
                    className={`flex-1 flex flex-col items-center px-0.5 py-[2px] rounded text-[8px] font-bold transition-all border leading-tight ${
                      isActive
                        ? TIER_COLORS[t.key]
                        : avail
                          ? 'bg-slate-800/60 text-slate-500 border-slate-700/40 hover:text-slate-300'
                          : 'bg-slate-900/30 text-slate-700/40 border-slate-800/20 cursor-not-allowed'
                    }`}
                    title={`${t.desc}${!avail ? ' (không khả dụng cho ' + vType.toUpperCase() + ')' : ''}`}
                  >
                    <span>{t.label}</span>
                    <span className="text-[6px] font-normal opacity-70">{t.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: Duration */}
          <div className="flex items-center gap-0.5">
            <span className="text-[7px] text-slate-600 w-6 shrink-0 font-bold">Time</span>
            <div className="flex gap-0.5 flex-1">
              {ALL_DURATIONS.map(d => {
                const avail = availDurations.includes(d);
                const isActive = vDuration === d;
                return (
                  <button key={d}
                    onClick={() => avail && setVDuration(d)}
                    disabled={!avail}
                    className={`flex-1 px-0.5 py-[3px] rounded text-[9px] font-bold transition-all border ${
                      isActive
                        ? 'bg-teal-600 text-white border-teal-500 shadow-sm shadow-teal-500/30'
                        : avail
                          ? 'bg-slate-800/60 text-slate-400 border-slate-700/40 hover:text-white hover:border-slate-500'
                          : 'bg-slate-900/30 text-slate-700/40 border-slate-800/20 cursor-not-allowed'
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
              {/* Random button */}
              <button
                onClick={() => setVDuration('random')}
                className={`px-1.5 py-[3px] rounded text-[9px] font-bold transition-all border ${
                  vDuration === 'random'
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
          <div className="text-[7px] text-slate-600 text-center font-mono truncate pt-0.5">
            {vDuration === 'random'
              ? <span className="text-pink-400/70">🎲 Random {availDurations.join('/')}</span>
              : <span className="text-slate-500">{computedModel || '—'}</span>
            }
          </div>
        </div>

        {/* Voice Selection for R2V */}
        {vType === 'r2v' && (
          <div className="flex items-center gap-1 shrink-0 nodrag">
            <span className="text-[8px] text-slate-500 font-bold flex items-center gap-0.5 w-7 shrink-0"><Mic className="w-2.5 h-2.5 text-rose-400" /> Voice</span>
            <select
              value={audioVoiceId}
              onChange={(e) => {
                const val = e.target.value;
                setAudioVoiceId(val);
                stopAudio();
                data.audioVoiceId = val;
                // Force sync and save to graph
                ctx?.setNodes?.((nds: any[]) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, audioVoiceId: val } } : n));
              }}
              className="bg-slate-950 text-slate-300 text-[9px] px-1 py-[3px] rounded border border-slate-700 focus:outline-none flex-1 min-w-0"
            >
              {VOICES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            {audioVoiceId && (
              <button
                onClick={isPlaying ? stopAudio : previewVoice}
                className={`px-1.5 py-1 rounded text-[9px] transition-all flex-shrink-0 ${
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
        )}

        {/* Ratio + Concurrent + Gen */}
        <div className="flex items-center justify-between gap-1 shrink-0">
          <div className="flex items-center gap-0.5">
            {VIDEO_RATIOS.map((r) => (
              <button key={r.value} onClick={() => { setRatio(r.value); data.videoAspectRatio = r.value; }}
                className={`nodrag px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                  ratio === r.value ? 'bg-teal-600 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >{r.label}</button>
            ))}
          </div>
          {/* Clear cache toggle */}
          <button
            onClick={() => { const v = !clearCache; setClearCache(v); data.clearCacheBeforeGen = v; }}
            className={`nodrag flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-medium transition-all border ${
              clearCache
                ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                : 'bg-slate-800 text-slate-600 border-slate-700 hover:text-slate-400'
            }`}
            title="Xoá cache extension trước khi tạo video"
          >
            <Eraser className="w-2.5 h-2.5" />
            Cache
          </button>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5 bg-slate-800 rounded px-1 py-0.5" title="Số luồng song song">
              <Zap className="w-2.5 h-2.5 text-amber-400" />
              <input type="number" min={1} max={10}
                className="nodrag bg-transparent text-[9px] text-amber-300 font-bold outline-none w-6 text-center appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={concurrent}
                onChange={(e) => { const v = Math.max(1, Math.min(10, Number(e.target.value) || 1)); setConcurrent(v); data.concurrent = v; }}
              />
            </div>
            <button onClick={handleGen} disabled={isGen || lines.length === 0}
              className="nodrag px-2 py-1 bg-teal-600 hover:bg-teal-500 disabled:bg-teal-600/30 disabled:text-teal-300/50 text-white rounded-lg text-[10px] font-semibold transition-all flex items-center gap-1"
            >
              {isGen ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {isGen ? '...' : `Gen ${lines.length}`}
            </button>
          </div>
        </div>

        {/* Regen buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={handleRegenImages} disabled={isGen || upstreamImageCount === 0}
            className="nodrag flex-1 flex items-center justify-center gap-1 px-1.5 py-1 bg-violet-600/20 hover:bg-violet-600/40 disabled:opacity-30 text-violet-300 rounded text-[9px] font-medium border border-violet-500/20"
            title="Tạo lại tất cả ảnh cảnh upstream"
          >
            <RefreshCw className="w-2.5 h-2.5" /><ImageIcon className="w-2.5 h-2.5" />
            Tạo lại ảnh ({upstreamImageCount})
          </button>
          <button onClick={handleRegenVideos} disabled={isGen || lines.length === 0}
            className="nodrag flex-1 flex items-center justify-center gap-1 px-1.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 disabled:opacity-30 text-emerald-300 rounded text-[9px] font-medium border border-emerald-500/20"
            title="Tạo lại tất cả video"
          >
            <RefreshCw className="w-2.5 h-2.5" /><Video className="w-2.5 h-2.5" />
            Tạo lại video ({downstreamVideos.length})
          </button>
        </div>

        {/* Retry failed button */}
        {(failedVideos.length > 0 || pendingVideos.length > 0) && (
          <button onClick={handleRetryFailed} disabled={isGen}
            className="nodrag w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-red-600/20 hover:bg-red-600/40 disabled:opacity-30 text-red-300 rounded-lg text-[10px] font-semibold border border-red-500/30 transition-all animate-pulse hover:animate-none"
            title="Chỉ tạo lại video bị lỗi hoặc chưa hoàn thành"
          >
            <AlertTriangle className="w-3 h-3" />
            🔄 Tạo lại {failedVideos.length + pendingVideos.length} video lỗi/chưa xong
          </button>
        )}

        {/* Video Status Frame */}
        {downstreamVideos.length > 0 && (
          <div className="shrink-0 border border-slate-700/50 rounded-lg bg-slate-950/50 p-1.5 space-y-1">
            <div className="flex items-center gap-1.5 text-[8px] text-slate-400 font-medium">
              <Video className="w-3 h-3 text-emerald-400" />
              <span>{doneVideos.length}✅ {genVideos.length}⏳ {failedVideos.length}❌ / {downstreamVideos.length}</span>
            </div>
            <div className="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto">
              {downstreamVideos.slice(0, 20).map((v, i) => (
                <div key={v.id} className={`w-10 h-8 rounded overflow-hidden border relative ${
                  v.status === 'done' ? 'border-emerald-500/50' : v.status === 'generating' ? 'border-amber-500/50' : v.status === 'failed' ? 'border-red-500/50' : 'border-slate-700'
                }`}>
                  {v.frameUrl ? <img src={v.frameUrl} className="w-full h-full object-cover opacity-60" alt="" /> : <div className="w-full h-full bg-slate-800" />}
                  <div className="absolute inset-0 flex items-center justify-center">
                    {v.status === 'done' && <span className="text-[7px]">✅</span>}
                    {v.status === 'generating' && <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />}
                    {v.status === 'failed' && <span className="text-[7px]">❌</span>}
                    {v.status === 'pending' && <span className="text-[7px]">⏳</span>}
                  </div>
                  <div className="absolute bottom-0 left-0 text-[6px] bg-black/70 text-white px-0.5 rounded-tr font-bold">{v.promptIndex || i + 1}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {vType === 'r2v' && upstreamImageCount > (vTier === 'omni' ? 7 : 3) && (
          <div className="text-[8px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded text-center shrink-0 flex items-center justify-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
            <span>{vTier === 'omni' ? 'Omni Flash' : 'Veo 3.1'} nhận tối đa {vTier === 'omni' ? 7 : 3} ảnh tham chiếu!</span>
          </div>
        )}

        {/* Info */}
        <p className="text-[8px] text-slate-600 text-center shrink-0">
          {upstreamImageCount > 0
            ? `🖼️ ${upstreamImageCount} ảnh · 🎬 ${lines.length} prompts · Auto-chain`
            : 'Mỗi dòng = 1 video · Khớp thứ tự ảnh cảnh'}
        </p>
      </div>

      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-slate-900" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-slate-900" />
    </div>
  );
};

export default VideoPromptNode;
