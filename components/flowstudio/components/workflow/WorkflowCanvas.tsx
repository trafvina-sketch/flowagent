import React, { useCallback, useState, useRef, useEffect } from 'react';
import { ReactFlow, Controls, Background, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Trash2, GitBranch, ListVideo, UserPlus, Loader2, FolderDown, Maximize2, ImagePlus, Clapperboard, Image, Layers, Film, Link2, ChevronDown, Package, Rocket, Download, Upload, RefreshCw, Play } from 'lucide-react';
import AgentPanel from './AgentPanel';
import MultiWorkflowPanel from './MultiWorkflowPanel';
import toast from 'react-hot-toast';
import { WorkflowContext } from './WorkflowContext';
import { useWorkflowGraph } from '../../hooks/useWorkflowGraph';
import { resolveMediaUrl } from '../../config';

const WorkflowCanvas: React.FC = () => {
  const {
    nodes, setNodes, onNodesChange,
    edges, setEdges, onEdgesChange,
    nodeTypes, edgeTypes,
    onConnect,
    reactFlowInstance, setReactFlowInstance,
    addPromptNode, addBatchNode, addCharacterNode, addImageUploadNode, addBatchT2INode, addBatchR2INode,
    addImageCollectorNode, addVideoPromptNode,
    onDeleteNode,
    onGenImage, onGenVideo, onGenVideoFromVideoPrompt, onRetryFailedFromVideoPrompt, onBatchVideoCreated, onBatchGenImage,
    onRegenImage, onRegenVideo, onBatchGenVideoFromImages,
    getCharacterNames, fillBatchPrompts,
    agentI2VPipeline, agentT2VPipeline, agentGenerateImages, agentStoryPipeline,
    mergeAllVideos,
    clearAll,
    runFullPipeline,
    exportWorkflow,
    importWorkflow,
    loadPresetWorkflow1,
    loadPresetWorkflow2,
  } = useWorkflowGraph();

  const [isMerging, setIsMerging] = useState(false);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);
  const [isSequentialRunning, setIsSequentialRunning] = useState(false);

  const [isDownloading, setIsDownloading] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const [showMultiWF, setShowMultiWF] = useState(false);

  // Sequential Queue Execution on Canvas with Strict Completion Lock
  // Sequential Queue Execution on Canvas with Strict Completion Lock
  const runSequentialCanvasQueue = useCallback(async () => {
    setIsSequentialRunning(true);
    toast.success('▶️ Bắt đầu chạy hàng đợi (Tạo hết toàn bộ ảnh trước, sau đó mới tạo video)...');

    try {
      const promptNodes = nodes.filter(n => n.type === 'prompt');
      const videoNodes = nodes.filter(n => n.type === 'videoPrompt' || n.type === 'batch');
 
      if (promptNodes.length === 0 && videoNodes.length === 0) {
        toast.error('Không tìm thấy Node kịch bản nào trên Canvas để chạy!');
        setIsSequentialRunning(false);
        return;
      }
 
      // Sort by vertical Y position
      const sortedPrompts = [...promptNodes].sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));
      const sortedVideos = [...videoNodes].sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));
 
      // ─── STAGE 1: Generate all scene images first ───
      if (sortedPrompts.length > 0) {
        toast.loading(`🎨 [Giai đoạn 1] Bắt đầu tạo ảnh cho ${sortedPrompts.length} Prompt Nodes...`, { id: 'seq-queue' });
        for (let i = 0; i < sortedPrompts.length; i++) {
          const pNode = sortedPrompts[i];
          toast.loading(`🎨 [Ảnh ${i + 1}/${sortedPrompts.length}] Đang tạo ảnh kịch bản #${i + 1}...`, { id: 'seq-queue' });
          try {
            const promptText = (pNode.data.prompt as string) || '';
            const lines = promptText.split('\n').filter(l => l.trim());
            const ratio = (pNode.data.aspectRatio as string) || 'IMAGE_ASPECT_RATIO_LANDSCAPE';
            const concurrent = (pNode.data.concurrent as number) || 2;
            
            if (lines.length > 0) {
              if (onBatchGenImage) {
                await onBatchGenImage(pNode.id, lines, ratio, concurrent, true);
              } else {
                await onGenImage(pNode.id);
                // Poll for image completion
                for (let poll = 0; poll < 60; poll++) {
                  await new Promise(r => setTimeout(r, 3500));
                  const freshNodes = reactFlowInstance?.getNodes() || [];
                  const currentPNode = freshNodes.find(n => n.id === pNode.id);
                  if (currentPNode?.data?.imageUrl || currentPNode?.data?.status === 'completed' || currentPNode?.data?.status === 'done') {
                    break;
                  }
                }
              }
            }
            await new Promise(r => setTimeout(r, 1000));
          } catch (err: any) {
            console.warn(`Lỗi tạo ảnh ở Prompt #${i + 1}:`, err.message);
          }
        }
        toast.success('✅ Đã hoàn thành tạo toàn bộ ảnh cảnh!', { id: 'seq-queue' });
        await new Promise(r => setTimeout(r, 2000));
      }
 
      // ─── STAGE 2: Generate all videos sequentially after images are done ───
      if (sortedVideos.length > 0) {
        toast.loading(`🎬 [Giai đoạn 2] Bắt đầu tạo video cho ${sortedVideos.length} Video Nodes...`, { id: 'seq-queue' });
        for (let i = 0; i < sortedVideos.length; i++) {
          const vNode = sortedVideos[i];
          toast.loading(`🎬 [Video ${i + 1}/${sortedVideos.length}] Đang tạo video kịch bản #${i + 1}...`, { id: 'seq-queue' });
          try {
            if (vNode.type === 'videoPrompt') {
              await onGenVideoFromVideoPrompt(vNode.id);
            } else if (vNode.type === 'batch') {
              // Trigger BatchNode to run
              setNodes(nds => nds.map(n => n.id === vNode.id ? { ...n, data: { ...n.data, triggerRun: true } } : n));
              // Wait 3 seconds to let state settle
              await new Promise(r => setTimeout(r, 3000));
              for (let poll = 0; poll < 600; poll++) {
                await new Promise(r => setTimeout(r, 4000));
                const freshNodes = reactFlowInstance?.getNodes() || [];
                const currentVNode = freshNodes.find(n => n.id === vNode.id);
                if (currentVNode && !currentVNode.data.isRunning) {
                  break;
                }
              }
            } else {
              await onGenVideo(vNode.id);
              for (let poll = 0; poll < 90; poll++) {
                await new Promise(r => setTimeout(r, 4000));
                const freshNodes = reactFlowInstance?.getNodes() || [];
                const currentVNode = freshNodes.find(n => n.id === vNode.id);
                if (currentVNode?.data?.videoUrl || currentVNode?.data?.status === 'completed' || currentVNode?.data?.status === 'done' || currentVNode?.data?.status === 'failed') {
                  break;
                }
              }
            }
            await new Promise(r => setTimeout(r, 2000));
          } catch (err: any) {
            console.warn(`Lỗi tạo video ở Video #${i + 1}:`, err.message);
          }
        }
        toast.success('✅ Đã hoàn thành tạo toàn bộ video!', { id: 'seq-queue' });
      }
 
      toast.success(`🎉 Đã hoàn thành tuần tự toàn bộ kịch bản trên Canvas!`);
    } catch (err: any) {
      toast.error(`❌ Lỗi chạy tuần tự: ${err.message}`);
    } finally {
      setIsSequentialRunning(false);
    }
  }, [nodes, onGenImage, onGenVideo, onGenVideoFromVideoPrompt, onBatchGenImage, reactFlowInstance, setNodes]);
  const [showAddNodes, setShowAddNodes] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const presetsRef = useRef<HTMLDivElement>(null);

  // Auto-close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowAddNodes(false);
      }
      if (presetsRef.current && !presetsRef.current.contains(event.target as Node)) {
        setShowPresets(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Collect all media from canvas nodes, sorted by prompt order
  const getMediaItems = useCallback(() => {
    const items: { url: string; name: string; type: 'image' | 'video'; order: number }[] = [];

    // Collect images
    const imageNodes = nodes.filter(n => n.type === 'image' && n.data.imageUrl);
    imageNodes.sort((a, b) => ((a.data.promptIndex as number) || 999) - ((b.data.promptIndex as number) || 999));
    imageNodes.forEach((node, fallbackIdx) => {
      const idx = (node.data.promptIndex as number) || fallbackIdx + 1;
      const prompt = ((node.data.prompt as string) || `image`).slice(0, 50).replace(/[\\/:*?"<>|\n\r]/g, '_').trim();
      items.push({
        url: node.data.imageUrl as string,
        name: `images/${String(idx).padStart(3, '0')}_${prompt}`,
        type: 'image',
        order: idx,
      });
    });

    // Collect videos
    const videoNodes = nodes.filter(n => n.type === 'video' && n.data.videoUrl);
    videoNodes.sort((a, b) => ((a.data.promptIndex as number) || 999) - ((b.data.promptIndex as number) || 999));
    videoNodes.forEach((node, fallbackIdx) => {
      const idx = (node.data.promptIndex as number) || fallbackIdx + 1;
      const prompt = ((node.data.prompt as string) || `video`).slice(0, 50).replace(/[\\/:*?"<>|\n\r]/g, '_').trim();
      items.push({
        url: node.data.videoUrl as string,
        name: `videos/${String(idx).padStart(3, '0')}_${prompt}`,
        type: 'video',
        order: idx,
      });
    });

    return items;
  }, [nodes]);

  // Download all — Electron IPC or browser File System API
  const handleDownloadAll = useCallback(async () => {
    const items = getMediaItems();
    if (items.length === 0) { toast.error('Không có media để tải'); return; }

    setIsDownloading(true);

    try {
      // ═══ ELECTRON EXE MODE: Use IPC for folder pick + file download ═══
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.media?.pickFolder) {
        const folderPath = await electronAPI.media.pickFolder();
        if (!folderPath) {
          toast('Đã hủy chọn thư mục', { icon: '📁' });
          setIsDownloading(false);
          return;
        }

        const toastId = toast.loading(`Đang lưu ${items.length} files...`);
        let saved = 0;

        for (const item of items) {
          try {
            const ext = item.type === 'video' ? '.mp4' : '.jpg';
            const subfolder = item.type === 'video' ? 'videos' : 'images';
            const cleanName = item.name.split('/').pop() || `file_${saved}`;
            const fileName = `${cleanName}${ext}`;
            const savePath = `${folderPath}/${subfolder}/${fileName}`.replace(/\//g, '\\');

            const resolvedUrl = resolveMediaUrl(item.url);
            const result = await electronAPI.media.downloadFile(resolvedUrl, savePath);
            if (result?.success) {
              saved++;
              toast.loading(`Đã lưu ${saved}/${items.length}...`, { id: toastId });
            }
          } catch (err) {
            console.warn(`Skip: ${item.name}`, err);
          }
        }

        toast.success(`Đã lưu ${saved}/${items.length} files vào thư mục!`, { id: toastId, duration: 5000 });
        setIsDownloading(false);
        return;
      }

      // ═══ BROWSER MODE: Use File System Access API ═══
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'desktop',
      });

      const toastId = toast.loading(`Đang lưu ${items.length} files...`);
      let saved = 0;

      // Create subfolders
      const imgDir = await dirHandle.getDirectoryHandle('images', { create: true });
      const vidDir = await dirHandle.getDirectoryHandle('videos', { create: true });

      for (const item of items) {
        try {
          const response = await fetch(item.url);
          const blob = await response.blob();
          const ext = item.type === 'video' ? '.mp4' : (blob.type.includes('png') ? '.png' : '.jpg');
          const cleanName = item.name.split('/').pop() || `file_${saved}`;
          const fileName = `${cleanName}${ext}`;

          // Choose subfolder
          const targetDir = item.type === 'video' ? vidDir : imgDir;
          const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();

          saved++;
          toast.loading(`Đã lưu ${saved}/${items.length}...`, { id: toastId });
        } catch (err) {
          console.warn(`Skip: ${item.name}`, err);
        }
      }

      toast.success(`Đã lưu ${saved}/${items.length} files!`, { id: toastId, duration: 5000 });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        toast('Đã hủy chọn thư mục', { icon: '📁' });
      } else {
        toast.error(`Lỗi: ${err.message}`);
      }
    } finally {
      setIsDownloading(false);
    }
  }, [getMediaItems]);

  // Quick stats
  const imageCount = nodes.filter(n => n.type === 'image' && n.data.imageUrl).length;
  const videoCount = nodes.filter(n => n.type === 'video' && n.data.videoUrl).length;
  const hasMedia = imageCount + videoCount > 0;

  // Double-click node → zoom to it
  const handleNodeDoubleClick = useCallback((_event: React.MouseEvent, node: any) => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({
        nodes: [{ id: node.id }],
        duration: 400,
        padding: 0.8,
        maxZoom: 1.5,
      });
    }
  }, [reactFlowInstance]);

  // Fit all nodes
  const handleFitAll = useCallback(() => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ duration: 400, padding: 0.3 });
    }
  }, [reactFlowInstance]);

  return (
    <div className="w-full h-full flex relative">
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 flex-wrap" style={{ maxWidth: 'calc(100% - 260px)' }}>
        {/* Dropdown Add Node */}
        <div className="relative flex-shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setShowAddNodes(!showAddNodes)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold shadow-lg transition-all border border-indigo-500/50 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Thêm Node
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showAddNodes ? 'rotate-180' : ''}`} />
          </button>

          {showAddNodes && (
            <div className="absolute left-0 top-full mt-1.5 w-44 rounded-lg bg-slate-900/95 backdrop-blur-md border border-slate-700/80 shadow-2xl p-1 flex flex-col gap-0.5 z-50">
              <button
                onClick={() => { addPromptNode(); setShowAddNodes(false); }}
                className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white rounded hover:bg-indigo-600/30 hover:border-indigo-500/30 border border-transparent transition-all cursor-pointer text-left w-full"
              >
                <Plus className="w-3 h-3 text-indigo-400" />
                💬 Prompt Node
              </button>
              <button
                onClick={() => { addBatchNode(); setShowAddNodes(false); }}
                className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white rounded hover:bg-emerald-600/30 hover:border-emerald-500/30 border border-transparent transition-all cursor-pointer text-left w-full"
              >
                <ListVideo className="w-3.5 h-3.5 text-emerald-400" />
                🎬 Batch Video
              </button>
              <button
                onClick={() => { addCharacterNode(); setShowAddNodes(false); }}
                className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white rounded hover:bg-rose-600/30 hover:border-rose-500/30 border border-transparent transition-all cursor-pointer text-left w-full"
              >
                <UserPlus className="w-3.5 h-3.5 text-rose-400" />
                👤 Character
              </button>
              <button
                onClick={() => { addImageUploadNode(); setShowAddNodes(false); }}
                className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white rounded hover:bg-amber-600/30 hover:border-amber-500/30 border border-transparent transition-all cursor-pointer text-left w-full"
              >
                <ImagePlus className="w-3.5 h-3.5 text-amber-400" />
                🖼️ Ảnh I2V
              </button>
              <button
                onClick={() => { addBatchT2INode(); setShowAddNodes(false); }}
                className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white rounded hover:bg-cyan-600/30 hover:border-cyan-500/30 border border-transparent transition-all cursor-pointer text-left w-full"
              >
                <Image className="w-3.5 h-3.5 text-cyan-400" />
                📷 T2I Batch
              </button>
              <button
                onClick={() => { addBatchR2INode(); setShowAddNodes(false); }}
                className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white rounded hover:bg-pink-600/30 hover:border-pink-500/30 border border-transparent transition-all cursor-pointer text-left w-full"
              >
                <Layers className="w-3.5 h-3.5 text-pink-400" />
                🎨 R2I Batch
              </button>
              <div className="border-t border-slate-700/50 my-0.5" />
              <button
                onClick={() => { addImageCollectorNode(); setShowAddNodes(false); }}
                className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white rounded hover:bg-orange-600/30 hover:border-orange-500/30 border border-transparent transition-all cursor-pointer text-left w-full"
              >
                <Package className="w-3.5 h-3.5 text-orange-400" />
                📦 Image Collector
              </button>
              <button
                onClick={() => { addVideoPromptNode(); setShowAddNodes(false); }}
                className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white rounded hover:bg-teal-600/30 hover:border-teal-500/30 border border-transparent transition-all cursor-pointer text-left w-full"
              >
                <Film className="w-3.5 h-3.5 text-teal-400" />
                🎬 Video Prompt
              </button>
            </div>
          )}
        </div>

        {/* Dropdown Presets */}
        <div className="relative flex-shrink-0" ref={presetsRef}>
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-bold shadow-lg transition-all border border-slate-700 cursor-pointer"
          >
            <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
            Mẫu Workflow
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showPresets ? 'rotate-180' : ''}`} />
          </button>

          {showPresets && (
            <div className="absolute left-0 top-full mt-1.5 w-64 rounded-lg bg-slate-900/95 backdrop-blur-md border border-slate-700/80 shadow-2xl p-1 flex flex-col gap-0.5 z-50">
              <button
                onClick={() => { loadPresetWorkflow1(); setShowPresets(false); }}
                className="flex flex-col items-start gap-0.5 px-2 py-1.5 text-left text-slate-300 hover:text-white rounded hover:bg-indigo-600/30 hover:border-indigo-500/30 border border-transparent transition-all cursor-pointer w-full"
              >
                <span className="text-[10px] font-semibold text-indigo-400 flex items-center gap-1">
                  ⚡ Mẫu 1: T2I → R2I → Video
                </span>
                <span className="text-[8px] text-slate-400">
                  Tạo ảnh tham chiếu + ảnh cảnh + video
                </span>
              </button>
              <button
                onClick={() => { loadPresetWorkflow2(); setShowPresets(false); }}
                className="flex flex-col items-start gap-0.5 px-2 py-1.5 text-left text-slate-300 hover:text-white rounded hover:bg-teal-600/30 hover:border-teal-500/30 border border-transparent transition-all cursor-pointer w-full"
              >
                <span className="text-[10px] font-semibold text-teal-400 flex items-center gap-1">
                  ⚡ Mẫu 2: T2I → Video trực tiếp
                </span>
                <span className="text-[8px] text-slate-400">
                  Tạo ảnh tham chiếu rồi tạo video trực tiếp
                </span>
              </button>
            </div>
          )}
        </div>

        <button
          onClick={exportWorkflow}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-bold shadow-lg transition-all border border-slate-700 cursor-pointer"
          title="Lưu cấu trúc Workflow hiện tại thành file JSON"
        >
          <Download className="w-3.5 h-3.5 text-indigo-400" />
          Lưu Workflow
        </button>
        <button
          onClick={importWorkflow}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-bold shadow-lg transition-all border border-slate-700 cursor-pointer"
          title="Tải lên file JSON để khôi phục cấu trúc Workflow"
        >
          <Upload className="w-3.5 h-3.5 text-indigo-400" />
          Tải Workflow
        </button>

        <button
          onClick={() => setShowMultiWF(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-purple-600 via-indigo-600 to-emerald-600 hover:from-purple-500 hover:to-emerald-500 text-white rounded-lg text-[10px] font-extrabold shadow-lg transition-all border border-indigo-400/40 cursor-pointer"
          title="Cấu hình N Workflow tự động nhân bản từ ảnh tham chiếu sang video"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Multi-WF Generator
        </button>

        <button
          onClick={runSequentialCanvasQueue}
          disabled={isSequentialRunning || nodes.length === 0}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-lg text-[10px] font-extrabold shadow-lg transition-all border border-emerald-400/40 cursor-pointer"
          title="Chạy lần lượt từng Workflow Node trên Canvas theo thứ tự (không chạy đồng thời nhiều WF)"
        >
          {isSequentialRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
          {isSequentialRunning ? 'Đang chạy tuần tự...' : '▶️ Chạy Tuần Tự Canvas'}
        </button>
        <button
          onClick={async () => { setIsPipelineRunning(true); await runFullPipeline(); setIsPipelineRunning(false); }}
          disabled={isPipelineRunning}
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-500 hover:to-orange-400 disabled:from-rose-600/40 disabled:to-orange-500/40 text-white rounded-lg text-[10px] font-bold shadow-lg transition-all border border-rose-500/50 animate-pulse hover:animate-none"
          title="Chạy pipeline: T2I → Collector → R2I → Video Prompt"
        >
          {isPipelineRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
          {isPipelineRunning ? 'Đang chạy...' : '🚀 Pipeline'}
        </button>
        <button onClick={onBatchGenVideoFromImages} className="flex-shrink-0 flex items-center gap-1 px-2 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-[10px] font-semibold shadow-lg transition-all border border-teal-500/50" title="Tạo video cho tất cả ảnh chưa có video">
          <Film className="w-3.5 h-3.5" /> Gen All Video
        </button>
        <button
          onClick={async () => { setIsMerging(true); await mergeAllVideos(); setIsMerging(false); }}
          disabled={isMerging}
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-600/40 text-white rounded-lg text-[10px] font-semibold shadow-lg transition-all border border-amber-500/50"
          title="Nối tất cả video đã hoàn thành theo thứ tự prompt"
        >
          {isMerging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
          {isMerging ? 'Đang nối...' : '🔗 Nối Video'}
        </button>

        {/* Download All */}
        {hasMedia && (
          <button
            onClick={handleDownloadAll}
            disabled={isDownloading}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-600/40 text-white rounded-xl text-xs font-semibold shadow-lg shadow-amber-500/20 transition-all hover:shadow-amber-500/40 border border-amber-500/50"
          >
            {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderDown className="w-4 h-4" />}
            {isDownloading ? 'Đang tải...' : `Tải về (${imageCount}🖼 ${videoCount}🎬)`}
          </button>
        )}

        {nodes.length > 0 && (
          <button
            onClick={handleFitAll}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium border border-slate-700 hover:border-slate-500 transition-all"
            title="Zoom fit tất cả (double-click node để zoom vào)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Fit All
          </button>
        )}

        {nodes.length > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-red-600/30 text-slate-400 hover:text-red-400 rounded-xl text-xs font-medium border border-slate-700 hover:border-red-500/50 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Stats badge */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-slate-900/80 backdrop-blur-sm border border-slate-700/50 rounded-xl px-3 py-1.5">
        <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-[10px] text-slate-400 font-medium">
          {nodes.length} nodes &middot; {edges.length} edges
        </span>
      </div>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-[5] pointer-events-none">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center">
              <GitBranch className="w-10 h-10 text-slate-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-400 mb-1">Không Gian Sáng Tạo Video</h3>
            <p className="text-sm text-slate-600 mb-4 max-w-md px-4">
              Kéo thả và sắp xếp các bước để tự động tạo video quảng cáo chuyên nghiệp
            </p>
            <div className="flex items-center gap-3 justify-center">
              <button
                onClick={addPromptNode}
                className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-all"
              >
                <Plus className="w-4 h-4" /> Prompt
              </button>
              <button
                onClick={addBatchNode}
                className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-all"
              >
                <ListVideo className="w-4 h-4" /> Batch Video
              </button>
              <button
                onClick={addCharacterNode}
                className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-all"
              >
                <UserPlus className="w-4 h-4" /> Character
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Canvas Area — shrinks when Agent opens */}
      <div className="flex-1 h-full relative" style={{ transition: 'all 0.3s ease' }}>
        {/* ReactFlow Canvas */}
        <WorkflowContext.Provider value={{ onGenImage, onGenVideo, onDeleteNode, onBatchVideoCreated, onBatchGenImage, onRegenImage, onRegenVideo, onBatchGenVideoFromImages, onGenVideoFromVideoPrompt, onRetryFailedFromVideoPrompt }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeDoubleClick={handleNodeDoubleClick}
            fitView
            fitViewOptions={{ maxZoom: 1.0 }}
            className="bg-slate-950"
            colorMode="dark"
            minZoom={0.1}
            maxZoom={3}
            defaultEdgeOptions={{
              type: 'default',
              animated: true,
              style: { stroke: '#6366f1', strokeWidth: 2, opacity: 0.6 },
            }}
          >
            <Background color="#1e293b" gap={20} size={1} />
            <Controls
              className="bg-slate-800 border-slate-700 rounded-xl overflow-hidden"
              showInteractive={false}
            />
            <MiniMap
              className="bg-slate-900 border-slate-700 rounded-xl overflow-hidden"
              nodeColor={(n) => {
                if (n.type === 'prompt') return '#6366f1';
                if (n.type === 'image') return '#8b5cf6';
                if (n.type === 'video') return '#10b981';
                if (n.type === 'batch') return '#059669';
                if (n.type === 'character') return '#f43f5e';
                if (n.type === 'imageUpload') return '#f59e0b';
                if (n.type === 'imageCollector') return '#fb923c';
                if (n.type === 'videoPrompt') return '#14b8a6';
                return '#475569';
              }}
              maskColor="rgba(0, 0, 0, 0.7)"
            />
          </ReactFlow>
        </WorkflowContext.Provider>
      </div>



      {/* Multi-Workflow Panel Overlay */}
      {showMultiWF && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md p-4 md:p-8 flex items-center justify-center animate-fadeIn">
          <div className="w-full max-w-6xl">
            <MultiWorkflowPanel
              onClose={() => setShowMultiWF(false)}
              onExportToCanvas={(workflowsData, pipelineMode, sharedRefImages, settingsExtra) => {
                if (workflowsData.length === 0) {
                  toast.error('Chưa có workflow nào để xuất!');
                  return;
                }

                let startX = 100;
                let startY = 100;
                if (nodes.length > 0) {
                  let maxX = 0;
                  nodes.forEach((n: any) => {
                    if (n.position && typeof n.position.x === 'number' && n.position.x > maxX && n.position.x < 50000) {
                      maxX = n.position.x;
                    }
                  });
                  startX = maxX > 0 ? maxX + 450 : 100;
                }

                const newNodes: any[] = [];
                const newEdges: any[] = [];
                const timestamp = Date.now();

                workflowsData.forEach((wf, i) => {
                  const rowY = startY + i * 650;

                  // 1. Collect all reference previews and media IDs
                  const refItems: { preview: string; mediaId?: string }[] = [];
                  if (wf.refImagePreview) {
                    refItems.push({ preview: wf.refImagePreview, mediaId: wf.refImageMediaId });
                  } else if (sharedRefImages.length > 0) {
                    sharedRefImages.forEach(img => {
                      if (img.preview) {
                        refItems.push({ preview: img.preview, mediaId: img.mediaId });
                      }
                    });
                  }
                  
                  // Spawn EXACTLY ONE reference node if there are reference images
                  let refNodeId = '';
                  if (refItems.length > 0) {
                    refNodeId = `img_upload_${timestamp}_${i}`;
                    newNodes.push({
                      id: refNodeId,
                      type: 'imageUpload',
                      position: { x: startX, y: rowY },
                      data: {
                        label: `🖼️ Ref Image WF #${wf.index}`,
                        imageUrl: refItems[0].preview,
                        initialPreviews: refItems.map(item => item.preview),
                        mediaIds: refItems.map(item => item.mediaId).filter(Boolean) as string[],
                        status: 'ready',
                      },
                    });
                  }

                  const promptX = refNodeId ? startX + 350 : startX;

                  if (pipelineMode === 'ref_image_video') {
                    const promptNodeId = `prompt_wf_${timestamp}_${i}`;
                    const videoNodeId = `video_wf_${timestamp}_${i}`;
                    const collectorNodeId = `collector_wf_${timestamp}_${i}`;

                    newNodes.push({
                      id: promptNodeId,
                      type: 'prompt',
                      position: { x: promptX, y: rowY },
                      data: {
                        label: `🎨 Ảnh Cảnh WF #${wf.index}`,
                        prompt: wf.scenePrompt,
                        aspectRatio: wf.imageAspectRatio,
                        useReference: refItems.length > 0,
                        modeLabel: refItems.length > 0 ? 'R2I Batch' : 'T2I Batch',
                        imageOnly: true,
                      },
                    });

                    newNodes.push({
                      id: collectorNodeId,
                      type: 'imageCollector',
                      position: { x: promptX + 350, y: rowY },
                      style: { width: 260, height: 200 },
                      data: {
                        label: `📦 Collector WF #${wf.index}`,
                        collectedMediaIds: [],
                        collectedImageUrls: [],
                      },
                    });

                    newNodes.push({
                      id: videoNodeId,
                      type: 'videoPrompt',
                      position: { x: promptX + 700, y: rowY },
                      data: {
                        label: `🎬 Video WF #${wf.index}`,
                        videoPrompt: wf.videoPrompt,
                        videoModel: wf.videoModel,
                        videoModelType: settingsExtra?.vType || 'i2v',
                        videoAspectRatio: wf.videoAspectRatio,
                        audioVoiceId: wf.voice !== undefined ? wf.voice : (settingsExtra?.voice || ''),
                        clearCacheBeforeGen: wf.clearCache !== undefined ? wf.clearCache : (settingsExtra?.clearCache || false),
                        concurrent: settingsExtra?.concurrent || 1,
                        vType: settingsExtra?.vType || 'i2v',
                        vTier: settingsExtra?.vTier || 'free',
                        vDuration: settingsExtra?.vDuration || '8s',
                        workflowIndex: wf.index,
                        workflowId: wf.id,
                      },
                    });

                    if (refNodeId) {
                      newEdges.push({
                        id: `e_${refNodeId}_${promptNodeId}`,
                        source: refNodeId,
                        target: promptNodeId,
                        animated: true,
                        style: { stroke: '#8b5cf6', strokeWidth: 2 },
                      });
                    }

                    newEdges.push({
                      id: `e_${promptNodeId}_${collectorNodeId}`,
                      source: promptNodeId,
                      target: collectorNodeId,
                      animated: true,
                      style: { stroke: '#ec4899', strokeWidth: 2 },
                    });
                    newEdges.push({
                      id: `e_${collectorNodeId}_${videoNodeId}`,
                      source: collectorNodeId,
                      target: videoNodeId,
                      animated: true,
                      style: { stroke: '#10b981', strokeWidth: 2 },
                    });
                  } else {
                    // 3. Mode 2: Ref -> VideoPromptNode (R2V)
                    const videoNodeId = `video_r2v_${timestamp}_${i}`;
                    const videoX = refNodeId ? startX + 350 : startX;

                    newNodes.push({
                      id: videoNodeId,
                      type: 'videoPrompt',
                      position: { x: videoX, y: rowY },
                      data: {
                        label: `🎬 Video R2V WF #${wf.index}`,
                        videoPrompt: wf.videoPrompt,
                        videoModel: wf.videoModel,
                        videoModelType: 'r2v',
                        videoAspectRatio: wf.videoAspectRatio,
                        audioVoiceId: wf.voice !== undefined ? wf.voice : (settingsExtra?.voice || ''),
                        clearCacheBeforeGen: wf.clearCache !== undefined ? wf.clearCache : (settingsExtra?.clearCache || false),
                        concurrent: settingsExtra?.concurrent || 1,
                        vType: 'r2v',
                        vTier: settingsExtra?.vTier || 'free',
                        vDuration: settingsExtra?.vDuration || '8s',
                        workflowIndex: wf.index,
                        workflowId: wf.id,
                      },
                    });

                    if (refNodeId) {
                      newEdges.push({
                        id: `e_${refNodeId}_${videoNodeId}`,
                        source: refNodeId,
                        target: videoNodeId,
                        animated: true,
                        style: { stroke: '#06b6d4', strokeWidth: 2 },
                      });
                    }
                  }
                });

                setNodes((prev) => [...prev, ...newNodes]);
                setEdges((prev) => [...prev, ...newEdges]);

                setShowMultiWF(false);
                toast.success(`🎉 Đã xuất thành công ${newNodes.length} Node lên Workflow Canvas!`);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowCanvas;
