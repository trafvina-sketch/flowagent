import { useState, useRef, useCallback, useContext, useEffect } from 'react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { UserPlus, Upload, X, Loader2, Mic, CheckCircle, Volume2, Square } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { API, resolveMediaUrl } from '../../config';
import { useProjectStore } from '../../store/useProjectStore';
import { WorkflowContext } from './WorkflowContext';

interface RefImg {
  preview: string;
  file: File;
}

const VOICES = [
  { value: '', label: '🔇 Không' },
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

export default function CharacterNode({ id, data }: { id: string; data: any }) {
  const settings = useProjectStore((s) => s.settings);
  const { setNodes } = useReactFlow();
  const { onDeleteNode } = useContext(WorkflowContext);

  const [name, setName] = useState(data.charName || 'Nhân vật');
  const [voice, setVoice] = useState(data.voice || '');
  const [personality, setPersonality] = useState(data.personality || '');
  const [image, setImage] = useState<RefImg | null>(null);
  const [entityId, setEntityId] = useState<string | null>(data.entityId || null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Re-sync entityId to parent on mount
  useEffect(() => {
    if (entityId && data.onEntityIdChange) {
      data.onEntityIdChange(id, entityId, name);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };
  }, []);

  // Set single image and auto-upload as plain reference to get mediaId
  const handleFile = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const preview = URL.createObjectURL(file);
    setImage({ preview, file });
    setEntityId(null);

    // Auto-upload as plain reference to get mediaId (for R2V without entity)
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('project_id', settings.flowkitProjectId);
      const res = await axios.post(API.uploadReference, formData);
      if (res.data.success && res.data.media_id) {
        const mid = res.data.media_id;
        if (data.onMediaIdsChange) data.onMediaIdsChange(id, [mid]);
        // Also sync charName to parent
        setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, charName: name } } : n));
      }
    } catch (err) {
      console.warn('[CharacterNode] Auto-upload failed:', err);
    }
  }, [settings.flowkitProjectId, data, id, name, setNodes]);

  const removeImage = () => { setImage(null); setEntityId(null); };

  // Play voice demo from local /voices/*.wav files
  const previewVoice = () => {
    if (!voice) return;

    // Stop current
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
      return; // toggle off
    }

    const audio = new Audio(resolveMediaUrl(`/voices/${voice}.wav`));
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

  // Create character
  const createCharacter = async () => {
    if (!image) { toast.error('Thêm 1 ảnh nhân vật'); return; }
    setIsCreating(true);
    const toastId = toast.loading(`🎭 Tạo nhân vật "${name}"...`);

    try {
      const formData = new FormData();
      formData.append('files', image.file);
      formData.append('display_name', name);
      formData.append('project_id', settings.flowkitProjectId);
      if (voice) {
        formData.append('voice', voice);
      }

      const res = await axios.post(API.createCharacter, formData, { timeout: 120000 });
      toast.dismiss(toastId);

      if (res.data.success) {
        const eid = res.data.entity_id;
        setEntityId(eid);
        setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, entityId: eid, charName: name, voice, personality } } : n));
        toast.success(`✅ Nhân vật "${name}" đã tạo!`);
        if (data.onEntityIdChange) data.onEntityIdChange(id, eid, name);
        if (data.onMediaIdsChange) data.onMediaIdsChange(id, res.data.media_ids || []);
      } else {
        toast.error(`❌ Lỗi: ${typeof res.data.error === 'object' ? JSON.stringify(res.data.error) : res.data.error}`);
      }
    } catch (err: any) {
      toast.dismiss(toastId);
      toast.error(`❌ ${err?.response?.data?.detail || err.message}`);
    }
    setIsCreating(false);
  };

  return (
    <div className="bg-slate-900 border border-rose-500/40 rounded-2xl shadow-xl shadow-rose-500/10 w-[220px] overflow-hidden">
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-rose-400 !border-rose-600" />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-rose-500/10 border-b border-rose-500/20">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-rose-400" />
          <input
            value={name}
            onChange={(e) => {
              const val = e.target.value;
              setName(val);
              setEntityId(null);
              data.charName = val;
              data.entityId = null;
            }}
            onBlur={() => {
              setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, charName: name, entityId: null } } : n));
              if (data.onEntityIdChange) data.onEntityIdChange(id, '', name);
            }}
            className="nodrag bg-transparent text-xs font-bold text-rose-300 w-24 focus:outline-none border-b border-transparent focus:border-rose-500/50"
            placeholder="Tên nhân vật"
          />
          {entityId && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
        </div>
        <button onClick={() => onDeleteNode(id)} className="text-slate-500 hover:text-red-400 text-[10px]">✕</button>
      </div>

      {/* Single Image */}
      <div className="px-3 pt-2 pb-1 flex justify-center">
        {image ? (
          <div className="relative group w-16 h-16 rounded-lg overflow-hidden border border-slate-700">
            <img src={image.preview} className="w-full h-full object-cover" alt="" />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1 transition-all">
              <button onClick={() => fileRef.current?.click()} className="p-1 rounded bg-slate-700/80 text-white">
                <Upload className="w-2.5 h-2.5" />
              </button>
              <button onClick={removeImage} className="p-1 rounded bg-red-600/80 text-white">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="nodrag w-16 h-16 rounded-lg border-2 border-dashed border-slate-700 hover:border-rose-500/50 flex flex-col items-center justify-center text-slate-500 hover:text-rose-400 transition-all"
          >
            <Upload className="w-4 h-4" />
            <span className="text-[7px] mt-0.5">Ảnh</span>
          </button>
        )}
        <input ref={fileRef} type="file" className="hidden" accept="image/*"
          onChange={(e) => { handleFile(e.target.files); if (e.target) e.target.value = ''; }}
        />
      </div>

      {/* Create Character */}
      <div className="px-3 py-1.5">
        {entityId ? (
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0" />
            <span className="text-[9px] text-emerald-300">Đã tạo • Nối → BatchNode R2V</span>
          </div>
        ) : (
          <button
            onClick={createCharacter}
            disabled={isCreating || !image}
            className="nodrag w-full py-2 text-[10px] font-bold rounded-lg transition-all disabled:opacity-40
              bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-400 hover:to-pink-400 text-white shadow-lg shadow-rose-500/20"
          >
            {isCreating ? (
              <><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Đang tạo...</>
            ) : '🎭 Tạo nhân vật'}
          </button>
        )}
      </div>

      {/* Voice & Personality */}
      <div className="px-3 pb-2.5 space-y-1.5">
        <div>
          <label className="text-[8px] text-slate-500 flex items-center gap-0.5"><Mic className="w-2 h-2" /> Voice</label>
          <div className="flex gap-1">
            <select value={voice} onChange={(e) => {
              const val = e.target.value;
              setVoice(val);
              stopAudio();
              data.voice = val;
              setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, voice: val } } : n));
            }}
              className="nodrag flex-1 bg-slate-950 text-slate-300 text-[9px] px-1.5 py-1 rounded border border-slate-700 focus:outline-none">
              {VOICES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            {voice && (
              <button
                onClick={isPlaying ? stopAudio : previewVoice}
                className={`nodrag px-1.5 py-1 rounded text-[9px] transition-all ${
                  isPlaying
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 animate-pulse'
                    : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30'
                }`}
                title={isPlaying ? 'Dừng' : 'Nghe thử'}
              >
                {isPlaying ? <Square className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="text-[8px] text-slate-500">💫 Tính cách</label>
          <input value={personality}
            onChange={(e) => {
              const val = e.target.value;
              setPersonality(val);
              data.personality = val;
            }}
            onBlur={() => {
              setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, personality: personality } } : n));
            }}
            className="nodrag w-full bg-slate-950 text-slate-300 text-[9px] px-1.5 py-1 rounded border border-slate-700 focus:outline-none placeholder:text-slate-600"
            placeholder="Vui vẻ..."
          />
        </div>
      </div>
    </div>
  );
}
