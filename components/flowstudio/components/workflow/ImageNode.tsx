import React, { useContext } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Image, Video, Loader2, Trash2, RefreshCw, XCircle } from 'lucide-react';
import { WorkflowContext } from './WorkflowContext';
import { resolveMediaUrl } from '../../config';

const ImageNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const ctx = useContext(WorkflowContext);
  const imageUrl = resolveMediaUrl(data.imageUrl as string);
  const isGenVideo = data.isGeneratingVideo as boolean;
  const isRegenning = data.isRegenerating as boolean;
  const prompt = (data.prompt as string) || '';
  const ratio = (data.aspectRatio as string) || '';
  const isPortrait = ratio?.includes('PORTRAIT');
  const promptIndex = data.promptIndex as number | undefined;

  const label = (data.label as string) || '';
  
  // Detect reference images by multiple signals:
  // 1. Explicit isReference flag (from story pipeline)
  // 2. Emoji prefix (👤🏞️🎭) 
  // 3. Prompt contains character/background/prop design keywords (from Batch T2I)
  const isDesignPrompt = /\bchar[_\s]?[a-z0-9]/i.test(prompt)
    || /\b(character\s+design|design\s+sheet|reference\s+sheet|model\s+sheet)\b/i.test(prompt)
    || /\b(bg[_\s]?[a-z0-9]|background\s+design|environment\s+design)\b/i.test(prompt)
    || /\b(prop[_\s]?[a-z0-9]|prop\s+design)\b/i.test(prompt);
  const isReferenceNode = data.isReference === true 
    || label.startsWith('👤') || label.startsWith('🏞️') || label.startsWith('🎭')
    || isDesignPrompt;
  const isFailed = data.status === 'failed';

  return (
    <div className={`bg-slate-900 border rounded-xl shadow-xl overflow-hidden transition-all h-full w-full flex flex-col ${selected ? 'border-violet-400 shadow-[0_0_15px_rgba(139,92,246,0.3)]' : 'border-slate-700 hover:border-violet-500/50'}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={100}
        minHeight={80}
        lineClassName="!border-violet-500/50"
        handleClassName="!w-2.5 !h-2.5 !bg-violet-500 !border-2 !border-slate-900 !rounded"
      />
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-slate-900" />

      <div className="bg-gradient-to-r from-violet-900/60 to-purple-900/40 px-2 py-1 border-b border-slate-700/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Image className="w-3 h-3 text-violet-300" />
          <span className="font-bold text-[9px] text-violet-200 uppercase tracking-wider">
            {data.label ? (data.label as string) : promptIndex ? `Ảnh ${promptIndex}` : 'Image'}
          </span>
          {ratio && <span className="text-[8px] text-violet-400/60">{isPortrait ? '9:16' : ratio.includes('SQUARE') ? '1:1' : '16:9'}</span>}
          {isFailed && <XCircle className="w-3 h-3 text-red-400" />}
        </div>
        <button onClick={() => ctx?.onDeleteNode(id)} className="p-0.5 rounded hover:bg-red-600/30 text-slate-500 hover:text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
      </div>

      {imageUrl ? (
        <div className="flex-1 min-h-0 bg-slate-950 border-b border-slate-800 overflow-hidden relative group">
          <img src={imageUrl} alt="" className={`w-full h-full object-cover ${isRegenning ? 'opacity-30' : ''}`} />
          {isRegenning && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
            </div>
          )}
        </div>
      ) : isFailed ? (
        <div className="flex-1 min-h-0 bg-slate-950 border-b border-slate-800 flex flex-col items-center justify-center gap-1">
          <XCircle className="w-5 h-5 text-red-400" />
          <span className="text-[9px] text-red-400">Lỗi tạo ảnh</span>
        </div>
      ) : (
        <div className="flex-1 min-h-0 bg-slate-950 border-b border-slate-800 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
        </div>
      )}

      {prompt && <p className="px-2 py-0.5 text-[8px] text-slate-500 truncate shrink-0">{prompt}</p>}

      {(imageUrl || isFailed) && (
        <div className="px-1.5 pb-1 flex items-center justify-between shrink-0 gap-1">
          {/* Retry / Regen image */}
          <button onClick={() => ctx?.onRegenImage?.(id)} disabled={isRegenning || isGenVideo}
            className={`px-1.5 py-0.5 bg-amber-600/80 hover:bg-amber-500 disabled:bg-amber-600/20 text-white rounded text-[8px] font-semibold flex items-center justify-center gap-0.5 ${isReferenceNode || isFailed ? 'w-full' : ''}`}
            title="Tạo lại ảnh">
            <RefreshCw className={`w-2.5 h-2.5 ${isRegenning ? 'animate-spin' : ''}`} />
            Tạo lại
          </button>
          {/* Gen Video */}
          {!isReferenceNode && imageUrl && (
            <button onClick={() => ctx?.onGenVideo(id)} disabled={isGenVideo || isRegenning}
              className="px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/20 text-white rounded text-[8px] font-semibold flex items-center gap-0.5">
              {isGenVideo ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Video className="w-2.5 h-2.5" />}
              Video
            </button>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-slate-900" />
    </div>
  );
};

export default ImageNode;
