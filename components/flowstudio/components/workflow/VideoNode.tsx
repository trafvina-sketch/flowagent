import React, { useContext, useEffect, useState, useRef } from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Video, Loader2, Trash2, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { WorkflowContext } from './WorkflowContext';
import axios from 'axios';
import { resolveMediaUrl } from '../../config';

const VideoNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const ctx = useContext(WorkflowContext);
  const { setNodes } = useReactFlow();
  const videoUrl = resolveMediaUrl(data.videoUrl as string);
  const frameUrl = resolveMediaUrl(data.frameUrl as string);
  const isGen = data.isGeneratingVideo as boolean;
  const jobId = data.jobId as string;
  const prompt = (data.prompt as string) || '';
  const ratio = (data.aspectRatio as string) || '';
  const isPortrait = ratio?.includes('PORTRAIT');
  const promptIndex = data.promptIndex as number | undefined;
  const referenceUrls = ((data.referenceUrls as string[]) || []).map(resolveMediaUrl);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'processing' | 'done' | 'failed'>((data.status as any) || (videoUrl ? 'done' : 'processing'));
  const [videoError, setVideoError] = useState(false);

  useEffect(() => {
    if (data.status) {
      setStatus(data.status as any);
    } else {
      setStatus(videoUrl ? 'done' : 'processing');
    }
  }, [data.status, videoUrl]);

  useEffect(() => {
    if (!jobId || videoUrl || status === 'done' || status === 'failed') return;
    const interval = setInterval(async () => {
      try {
        const res = await axios.get('/api/generate/jobs');
        const job = (res.data?.jobs || []).find((j: any) => j.id === jobId);
        if (!job) return;
        if (job.status === 'DONE' && job.url) {
          setStatus('done');
          setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, videoUrl: job.url, mediaId: job.media_id || n.data.mediaId, isGeneratingVideo: false, status: 'done' } } : n));
          clearInterval(interval);
        } else if (job.status === 'FAILED') {
          setStatus('failed');
          const errorMsg = job.url || 'Lỗi không xác định';
          setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, isGeneratingVideo: false, status: 'failed', errorMsg } } : n));
          clearInterval(interval);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [jobId, videoUrl, status, id, setNodes]);

  const handleRetryVideo = () => {
    ctx?.onRegenVideo?.(id);
  };

  const hasRefs = referenceUrls.length > 0;
  const isLoading = isGen || status === 'processing';

  return (
    <div className={`bg-slate-900 border rounded-xl shadow-xl overflow-hidden transition-all h-full w-full flex flex-col ${selected ? 'border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'border-slate-700 hover:border-emerald-500/50'}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        lineClassName="!border-emerald-500/50"
        handleClassName="!w-2.5 !h-2.5 !bg-emerald-500 !border-2 !border-slate-900 !rounded"
      />
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-slate-900" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-amber-400 !border-2 !border-slate-900" />

      <div className="bg-gradient-to-r from-emerald-900/60 to-teal-900/40 px-2 py-1 border-b border-slate-700/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Video className="w-3 h-3 text-emerald-300" />
          <span className="font-bold text-[9px] text-emerald-200 uppercase tracking-wider">
            {promptIndex ? `Video ${promptIndex}` : 'Video'}
          </span>
          {ratio && <span className="text-[8px] text-emerald-400/60">{isPortrait ? '9:16' : ratio.includes('SQUARE') ? '1:1' : '16:9'}</span>}
          {hasRefs && <span className="text-[7px] bg-violet-500/30 text-violet-300 px-1 py-0.5 rounded font-bold">R2V</span>}
          {status === 'done' && !videoError && <CheckCircle className="w-3 h-3 text-emerald-400" />}
          {(status === 'failed' || videoError) && <XCircle className="w-3 h-3 text-red-400" />}
        </div>
        <button onClick={() => ctx?.onDeleteNode(id)} className="p-0.5 rounded hover:bg-red-600/30 text-slate-500 hover:text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
      </div>

      {videoUrl && !videoError ? (
        <div className="flex-1 min-h-0 bg-black border-b border-slate-800 overflow-hidden">
          <video ref={videoRef} src={videoUrl} poster={frameUrl || undefined} controls preload="metadata" onError={() => setVideoError(true)} className="w-full h-full object-contain" />
        </div>
      ) : videoUrl && videoError ? (
        <div className="flex-1 min-h-0 bg-slate-950 border-b border-slate-800 flex flex-col items-center justify-center gap-1">
          <XCircle className="w-5 h-5 text-red-400" />
          <span className="text-[9px] text-red-400">Load error</span>
          <button onClick={() => { setVideoError(false); videoRef.current?.load(); }} className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[9px]">
            <RefreshCw className="w-2.5 h-2.5" /> Retry
          </button>
        </div>
      ) : (
        /* Loading state — show reference thumbnails if R2V */
        <div className="flex-1 min-h-0 bg-slate-950 border-b border-slate-800 relative overflow-hidden">
          {hasRefs ? (
            /* R2V: Show reference thumbnails grid */
            <div className="w-full h-full flex">
              {/* Reference images panel */}
              <div className="flex-1 min-w-0 p-1 flex flex-wrap gap-0.5 content-start overflow-hidden">
                {referenceUrls.map((url, i) => (
                  <div key={i} className="relative rounded overflow-hidden border border-violet-500/30 shrink-0"
                    style={{ width: referenceUrls.length <= 2 ? '48%' : referenceUrls.length <= 4 ? '48%' : '31%', aspectRatio: '1' }}
                  >
                    <img src={url} alt="" className={`w-full h-full object-cover ${isLoading ? 'opacity-60' : 'opacity-80'}`} />
                    <div className="absolute bottom-0 left-0 text-[6px] bg-black/70 text-violet-300 px-0.5 rounded-tr font-bold">ref{i + 1}</div>
                  </div>
                ))}
              </div>
              {/* Loading overlay */}
              {isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                  <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                  <span className="text-[8px] text-emerald-300 mt-1 font-medium">R2V...</span>
                </div>
              )}
              {status === 'failed' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <span className="text-[9px] text-red-400 bg-black/60 px-1.5 py-0.5 rounded">Failed</span>
                </div>
              )}
            </div>
          ) : frameUrl ? (
            /* I2V: Show frame image */
            <>
              <img src={frameUrl} alt="" className="w-full h-full object-cover opacity-50" />
              <div className="absolute inset-0 flex items-center justify-center">
                {isLoading && <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />}
                {status === 'failed' && <span className="text-[9px] text-red-400 bg-black/60 px-1.5 py-0.5 rounded">Failed</span>}
              </div>
            </>
          ) : (
            /* No frame, no refs */
            <div className="w-full h-full flex items-center justify-center">
              {isLoading ? <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" /> : <Video className="w-6 h-6 text-slate-700" />}
            </div>
          )}
        </div>
      )}

      {prompt && <p className="px-2 py-0.5 text-[8px] text-slate-500 truncate shrink-0" title={prompt}>{prompt}</p>}
      {data.errorMsg && (
        <p className="px-2 py-0.5 text-[8px] text-red-400 font-semibold truncate shrink-0" title={data.errorMsg as string}>
          ⚠️ Lỗi: {data.errorMsg as string}
        </p>
      )}

      {/* Retry button for failed or completed videos */}
      {(status === 'failed' || status === 'done') && (
        <div className="px-1.5 pb-1 flex justify-end shrink-0">
          <button onClick={handleRetryVideo} disabled={isGen}
            className="px-1.5 py-0.5 bg-amber-600/80 hover:bg-amber-500 disabled:bg-amber-600/20 text-white rounded text-[8px] font-semibold flex items-center gap-0.5"
            title="Tạo lại video">
            <RefreshCw className="w-2.5 h-2.5" /> Tạo lại
          </button>
        </div>
      )}
    </div>
  );
};

export default VideoNode;
