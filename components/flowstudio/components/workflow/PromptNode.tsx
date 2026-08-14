import React, { useContext, useState, useRef } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Wand2, Image, Loader2, Trash2, FileText, Play, Zap } from 'lucide-react';
import { WorkflowContext } from './WorkflowContext';

const RATIOS = [
  { value: 'IMAGE_ASPECT_RATIO_LANDSCAPE', label: '16:9' },
  { value: 'IMAGE_ASPECT_RATIO_PORTRAIT', label: '9:16' },
  { value: 'IMAGE_ASPECT_RATIO_SQUARE', label: '1:1' },
];

const PromptNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const ctx = useContext(WorkflowContext);
  const [prompt, setPrompt] = useState((data.prompt as string) || '');
  const [ratio, setRatio] = useState((data.aspectRatio as string) || 'IMAGE_ASPECT_RATIO_LANDSCAPE');
  const [concurrent, setConcurrent] = useState((data.concurrent as number) || 1);
  const isGen = data.isGeneratingImage as boolean;
  const fileRef = useRef<HTMLInputElement>(null);
  const modeLabel = data.modeLabel as string | undefined;
  const isRef = data.useReference as boolean | undefined;
  const [upscaleQuality, setUpscaleQuality] = useState((data.upscaleQuality as string) || '1K');

  const lines = prompt.split('\n').filter(l => l.trim());
  const isBatch = lines.length > 1;

  // Import .txt file
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) {
        setPrompt(text.trim());
        data.prompt = text.trim();
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  // Single gen
  const handleSingleGen = () => {
    data.prompt = prompt;
    data.aspectRatio = ratio;
    data.upscaleQuality = upscaleQuality;
    ctx?.onGenImage(id);
  };

  // Batch gen — sends all prompts + concurrent count
  const handleBatchGen = () => {
    data.prompt = prompt;
    data.aspectRatio = ratio;
    data.concurrent = concurrent;
    data.upscaleQuality = upscaleQuality;
    ctx?.onBatchGenImage?.(id, lines.map(l => l.trim()), ratio, concurrent);
  };

  // Header color based on mode
  const headerBg = modeLabel
    ? (isRef ? 'from-pink-900/60 to-rose-900/40' : 'from-cyan-900/60 to-teal-900/40')
    : 'from-indigo-900/60 to-violet-900/40';
  const headerIcon = modeLabel
    ? (isRef ? 'text-pink-300' : 'text-cyan-300')
    : 'text-indigo-300';
  const headerText = modeLabel
    ? (isRef ? 'text-pink-200' : 'text-cyan-200')
    : 'text-indigo-200';

  return (
    <div className={`bg-slate-900 border rounded-xl shadow-xl overflow-hidden transition-all h-full w-full flex flex-col ${selected ? 'border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.3)]' : 'border-slate-700 hover:border-indigo-500/50'}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={100}
        lineClassName="!border-indigo-500/50"
        handleClassName="!w-2.5 !h-2.5 !bg-indigo-500 !border-2 !border-slate-900 !rounded"
      />
      {/* Header */}
      <div className={`bg-gradient-to-r ${headerBg} px-2 py-1.5 border-b border-slate-700/50 flex items-center justify-between`}>
        <div className="flex items-center gap-1.5">
          <Wand2 className={`w-3 h-3 ${headerIcon}`} />
          <span className={`font-bold text-[10px] uppercase tracking-wider ${headerText}`}>{modeLabel || 'Prompt'}</span>
          {isBatch && (
            <span className="text-[8px] bg-indigo-500/30 text-indigo-300 px-1 py-0.5 rounded font-bold">
              {lines.length} dòng
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Import txt */}
          <button
            onClick={() => fileRef.current?.click()}
            className="p-0.5 rounded hover:bg-indigo-600/30 text-slate-500 hover:text-indigo-400 transition-colors"
            title="Import .txt"
          >
            <FileText className="w-3 h-3" />
          </button>
          <button onClick={() => ctx?.onDeleteNode(id)} className="p-0.5 rounded hover:bg-red-600/30 text-slate-500 hover:text-red-400 transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <input ref={fileRef} type="file" className="hidden" accept=".txt,.text" onChange={handleFile} />

      <div className="p-2 space-y-1.5 flex-1 flex flex-col min-h-0">
        {/* Textarea */}
        <textarea
          className="nodrag nowheel w-full flex-1 min-h-[3rem] bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 resize-none focus:outline-none focus:border-indigo-500 placeholder-slate-600 transition-colors font-mono leading-relaxed"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => { data.prompt = prompt; data.aspectRatio = ratio; }}
          placeholder={"Nhập prompt...\nMỗi dòng = 1 ảnh (batch)\n📄 Import file .txt"}
        />

        {/* Ratio + Concurrent + Buttons */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-0.5">
            {RATIOS.map((r) => (
              <button key={r.value} onClick={() => { setRatio(r.value); data.aspectRatio = r.value; }}
                className={`nodrag px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${ratio === r.value ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}
              >{r.label}</button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5 bg-slate-800 rounded px-1 py-0.5" title="Số luồng chạy song song (1-30)">
              <Zap className="w-2.5 h-2.5 text-amber-400" />
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

            {isBatch ? (
              /* Batch gen button */
              <button
                onClick={handleBatchGen}
                disabled={isGen || lines.length === 0}
                className="nodrag px-2 py-1 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-600/30 disabled:text-violet-300/50 text-white rounded-lg text-[10px] font-semibold transition-all flex items-center gap-1"
              >
                {isGen ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                {isGen ? '...' : `Gen ${lines.length}`}
              </button>
            ) : (
              /* Single gen button */
              <button
                onClick={handleSingleGen}
                disabled={isGen || !prompt.trim()}
                className="nodrag px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/30 disabled:text-indigo-300/50 text-white rounded-lg text-[10px] font-semibold transition-all flex items-center gap-1"
              >
                {isGen ? <Loader2 className="w-3 h-3 animate-spin" /> : <Image className="w-3 h-3" />}
                {isGen ? 'Gen...' : 'Gen'}
              </button>
            )}
          </div>
        </div>

        {/* Upscale quality selector */}
        <div className="flex items-center justify-between gap-1">
          <span className="text-[8px] text-slate-500">Chất lượng:</span>
          <div className="flex gap-0.5">
            {[{v: '1K', l: '1K'}, {v: '2K', l: '2K'}, {v: '4K', l: '4K'}].map(q => (
              <button key={q.v} onClick={() => { setUpscaleQuality(q.v); data.upscaleQuality = q.v; }}
                className={`nodrag px-1.5 py-0.5 rounded text-[8px] font-medium transition-all ${
                  upscaleQuality === q.v
                    ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                    : 'bg-slate-800 text-slate-500 border border-slate-700'
                }`}
              >{q.l}</button>
            ))}
          </div>
        </div>

        {/* Batch hint */}
        {!isBatch && (
          <p className="text-[8px] text-slate-600 text-center">Nhiều dòng = batch · 📄 Import .txt</p>
        )}
      </div>

      {/* R2I: target handle to receive from ImageUpload/CharacterNode */}
      {isRef && <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-pink-500 !border-2 !border-slate-900" />}
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-slate-900" />
    </div>
  );
};

export default PromptNode;
