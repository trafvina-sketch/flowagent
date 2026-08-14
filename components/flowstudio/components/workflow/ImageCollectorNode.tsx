import React, { useContext, useEffect, useMemo } from 'react';
import { Handle, Position, NodeResizer, useReactFlow, useNodes, useEdges } from '@xyflow/react';
import { Package, Trash2, ImageIcon } from 'lucide-react';
import { WorkflowContext } from './WorkflowContext';

/**
 * ImageCollectorNode — Tự động thu thập ảnh đã generate từ upstream.
 * 
 * Khi PromptNode tạo ImageNode → nối PromptNode → ImageCollectorNode
 * → collector tự scan tất cả ImageNode "anh em" (cùng parent PromptNode)
 * → lưu mediaIds để R2I PromptNode downstream dùng làm reference.
 */
const ImageCollectorNode: React.FC<any> = ({ id, data: _data, selected }) => {
  const ctx = useContext(WorkflowContext);
  const { setNodes } = useReactFlow();
  const allNodes = useNodes();
  const allEdges = useEdges();

  // Find all upstream ImageNodes by traversing edges:
  // 1. Find nodes that connect TO this collector (upstream parents)
  // 2. For each parent, find all ImageNodes that parent connects TO (sibling outputs)
  // 3. Collect mediaIds from those ImageNodes
  const collected = useMemo(() => {
    const parentEdges = allEdges.filter(e => e.target === id);
    const parentIds = parentEdges.map(e => e.source);

    const images: { url: string; mediaId: string; promptIndex: number; nodeId: string }[] = [];
    const seen = new Set<string>();

    for (const pid of parentIds) {
      // Find all edges FROM this parent → ImageNodes
      const childEdges = allEdges.filter(e => e.source === pid && e.target !== id);
      for (const ce of childEdges) {
        const childNode = allNodes.find(n => n.id === ce.target);
        if (childNode && childNode.type === 'image' && childNode.data.mediaId && !seen.has(childNode.data.mediaId as string)) {
          seen.add(childNode.data.mediaId as string);
          images.push({
            url: (childNode.data.imageUrl as string) || '',
            mediaId: childNode.data.mediaId as string,
            promptIndex: (childNode.data.promptIndex as number) || 0,
            nodeId: childNode.id,
          });
        }
      }
    }
    // Sort by promptIndex to maintain correct scene order
    images.sort((a, b) => {
      if (a.promptIndex !== b.promptIndex) return a.promptIndex - b.promptIndex;
      // Fallback: sort by Y position
      const aNode = allNodes.find(n => n.id === a.nodeId);
      const bNode = allNodes.find(n => n.id === b.nodeId);
      return (aNode?.position?.y || 0) - (bNode?.position?.y || 0);
    });
    return images;
  }, [allNodes, allEdges, id]);

  // Sync collected mediaIds into node data so getUpstreamMediaIds can find them
  useEffect(() => {
    const mediaIds = collected.map(c => c.mediaId);
    const urls = collected.map(c => c.url);

    setNodes(nds => nds.map(n => {
      if (n.id !== id) return n;
      const currentIds = (n.data.collectedMediaIds as string[]) || [];
      // Only update if changed
      if (JSON.stringify(currentIds) === JSON.stringify(mediaIds)) return n;
      return {
        ...n,
        data: {
          ...n.data,
          collectedMediaIds: mediaIds,
          collectedUrls: urls,
          // Also expose as mediaIds for getUpstreamMediaIds compatibility
          mediaIds: mediaIds,
        },
      };
    }));
  }, [collected, id, setNodes]);

  return (
    <div className={`bg-slate-900 border rounded-2xl shadow-xl overflow-hidden h-full w-full flex flex-col ${
      selected ? 'border-orange-400 shadow-[0_0_15px_rgba(251,146,60,0.3)]' : 'border-orange-500/40 hover:border-orange-500/60'
    }`}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={200}
        minHeight={120}
        lineClassName="!border-orange-500/50"
        handleClassName="!w-2.5 !h-2.5 !bg-orange-500 !border-2 !border-slate-900 !rounded"
      />
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-orange-400 !border-2 !border-slate-900" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-orange-400 !border-2 !border-slate-900" />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-orange-900/60 to-amber-900/40 border-b border-orange-500/20 shrink-0">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-orange-400" />
          <span className="text-xs font-bold text-orange-300 uppercase tracking-wider">Image Collector</span>
          <span className="text-[9px] bg-slate-800 text-orange-300 px-1.5 py-0.5 rounded font-bold">
            {collected.length} ảnh
          </span>
        </div>
        <button onClick={() => ctx?.onDeleteNode(id)} className="p-0.5 rounded hover:bg-red-600/30 text-slate-500 hover:text-red-400">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Thumbnail Grid */}
      <div className="px-2 pt-2 pb-1 flex-1 overflow-y-auto min-h-0">
        {collected.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {collected.map((img, idx) => (
              <div key={img.mediaId} className="relative group w-14 h-14 rounded-lg overflow-hidden border border-slate-700 shrink-0">
                <img src={img.url} className="w-full h-full object-cover" alt="" />
                <div className="absolute bottom-0.5 left-0.5 text-[7px] bg-black/70 text-orange-300 px-1 rounded font-bold">
                  {img.promptIndex || (idx + 1)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-1">
            <ImageIcon className="w-6 h-6" />
            <span className="text-[9px]">Nối PromptNode → Gen ảnh</span>
            <span className="text-[8px]">Ảnh sẽ tự thu thập</span>
          </div>
        )}
      </div>

      {/* Status */}
      <div className="px-2 pb-2 shrink-0">
        <p className="text-[8px] text-slate-600 text-center">
          {collected.length > 0
            ? `✅ ${collected.length} ảnh sẵn sàng → nối R2I / VideoPrompt`
            : 'Chờ ảnh từ PromptNode upstream...'}
        </p>
      </div>
    </div>
  );
};

export default ImageCollectorNode;
