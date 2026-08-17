import { useCallback, useMemo, useRef, useEffect } from 'react';
import React from 'react';
import { useNodesState, useEdgesState, addEdge } from '@xyflow/react';
import type { Connection, Edge, Node } from '@xyflow/react';
import localforage from 'localforage';
import axios from 'axios';
import toast from 'react-hot-toast';
import PromptNode from '../components/workflow/PromptNode';
import ImageNode from '../components/workflow/ImageNode';
import VideoNode from '../components/workflow/VideoNode';
import BatchNode from '../components/workflow/BatchNode';
import CharacterNode from '../components/workflow/CharacterNode';
import ImageUploadNode from '../components/workflow/ImageUploadNode';
import ImageCollectorNode from '../components/workflow/ImageCollectorNode';
import VideoPromptNode from '../components/workflow/VideoPromptNode';
import DeletableEdge from '../components/workflow/DeletableEdge';
import { useProjectStore } from '../store/useProjectStore';
import { pipelineLayout } from '../utils/autoLayout';

const WORKFLOW_NODES_KEY = 'workflow_nodes';
const WORKFLOW_EDGES_KEY = 'workflow_edges';

const parseSceneNumber = (text: string, fallback: number): number => {
  if (!text) return fallback;
  const match = text.match(/(?:cảnh|cảnh số|canh|scene|part|cảnh|cảnh\s*)\s*(\d+)|\b(\d+)\s*[:.-]/i);
  if (match) {
    const numStr = match[1] || match[2];
    if (numStr) {
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return fallback;
};

const getBatchStartPosition = (currentNodes: any[]): { x: number; y: number } => {
  if (!currentNodes || currentNodes.length === 0) return { x: 100, y: 100 };
  let maxX = 0;
  currentNodes.forEach(n => {
    if (n.position && typeof n.position.x === 'number') {
      if (n.position.x > maxX && n.position.x < 50000) {
        maxX = n.position.x;
      }
    }
  });
  const startX = maxX > 0 ? maxX + 450 : 100;
  return { x: startX, y: 100 };
};

export function useWorkflowGraph() {
  const settings = useProjectStore((s) => s.settings);
  const addMedia = useProjectStore((s) => s.addMedia);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);
  const isHydrated = useRef(false);
  const lastCompletionTimeRef = useRef<number>(0);

  // Helper to detect rate-limit/overload
  const isOverloadMsg = useCallback((errText: any): boolean => {
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
  }, []);

  const clearCacheAndWaitForReady = useCallback(async () => {
    toast('⏳ Đang xoá cache và reload Flow tab...', { icon: '🔄' });
    try {
      await axios.post('/api/flowkit/clear-cache', { project_id: settings.flowkitProjectId });
    } catch (e) {
      console.error('Failed to trigger clear-cache:', e);
    }
    
    toast('⏳ Đang chờ FlowAgent kết nối lại và lấy token...', { icon: '🔌' });
    const maxPollAttempts = 24; // 2 minutes max
    for (let i = 0; i < maxPollAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        const res = await axios.get('/api/flowkit/status');
        if (res.data.connected && res.data.flowKeyPresent) {
          toast.success('✅ FlowAgent đã kết nối và có token!');
          return true;
        }
      } catch (err) {
        console.error('Error checking status:', err);
      }
    }
    throw new Error('Không thể kết nối lại với FlowAgent hoặc thiếu token sau khi reload.');
  }, [settings.flowkitProjectId]);

  // Shared sequential video job poller
  const waitForJob = useCallback(async (jobId: string, _label: string, timeoutMs = 180000): Promise<string> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await axios.get(`/api/generate/jobs/${jobId}`);
        const status = res.data.status;
        if (status === 'DONE' || status === 'FAILED') {
          return status;
        }
      } catch (err: any) {
        // If the polling endpoint itself is overloaded, wait 10s and retry polling
        const errMsg = err?.response?.data?.detail || err.message || '';
        if (isOverloadMsg(errMsg) || err?.response?.status === 429 || err?.response?.status === 503) {
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }
      }
      await new Promise(r => setTimeout(r, 5000)); // poll every 5s
    }
    return 'TIMEOUT';
  }, [isOverloadMsg]);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // Stable ref for onGenVideo (used by onBatchGenImage)
  const onGenVideoRef = useRef<(nodeId: string) => void>(() => {});

  // Load from IndexedDB on mount
  useEffect(() => {
    Promise.all([
      localforage.getItem<Node[]>(WORKFLOW_NODES_KEY),
      localforage.getItem<Edge[]>(WORKFLOW_EDGES_KEY),
    ]).then(([savedNodes, savedEdges]) => {
      if (savedNodes) {
        // Re-inject function refs into nodes (stripped during save)
        const hydratedNodes = savedNodes.map(n => {
          if (n.type === 'batch') {
            return { ...n, data: { ...n.data, getUpstreamCharacters, getUpstreamEntityIds, getUpstreamCharacterEntities, getUpstreamImageMediaId, getUpstreamImageUploadNodeId, getUpstreamCharacterDetails } };
          }
          if (n.type === 'character') {
            // Restore charEntityIdsRef from saved data
            if ((n.data as any).entityId) {
              charEntityIdsRef.current[n.id] = { name: (n.data as any).charName || 'Character', entityId: (n.data as any).entityId };
            }
            // Re-inject callbacks
            return { ...n, data: { ...n.data, onMediaIdsChange: onCharMediaIdsChange, onEntityIdChange: onCharEntityIdChange } };
          }
          return n;
        });
        setNodes(hydratedNodes);
      }
      if (savedEdges) setEdges(savedEdges);
      isHydrated.current = true;
    }).catch((err) => {
      console.error('Failed to load workflow:', err);
      isHydrated.current = true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save to IndexedDB (strip non-serializable functions from data)
  useEffect(() => {
    if (!isHydrated.current) return;
    const serializableNodes = nodes.map(n => ({
      ...n,
      data: Object.fromEntries(
        Object.entries(n.data).filter(([, v]) => typeof v !== 'function')
      ),
    }));
    localforage.setItem(WORKFLOW_NODES_KEY, serializableNodes);
    localforage.setItem(WORKFLOW_EDGES_KEY, edges);
  }, [nodes, edges]);

  const nodeTypes = useMemo(() => ({
    prompt: PromptNode, image: ImageNode, video: VideoNode,
    batch: BatchNode, character: CharacterNode, imageUpload: ImageUploadNode,
    imageCollector: ImageCollectorNode, videoPrompt: VideoPromptNode,
  }), []);
  const edgeTypes = useMemo(() => ({ default: DeletableEdge }), []);

  // Store character mediaIds per character node
  const charMediaIdsRef = useRef<Record<string, string[]>>({});
  // Store character {name, entityId} per character node
  const charEntityIdsRef = useRef<Record<string, { name: string; entityId: string }>>({});

  const onCharMediaIdsChange = useCallback((nodeId: string, mediaIds: string[]) => {
    charMediaIdsRef.current[nodeId] = mediaIds;
  }, []);

  const onCharEntityIdChange = useCallback((nodeId: string, entityId: string, charName?: string) => {
    charEntityIdsRef.current[nodeId] = { name: charName || 'Character', entityId };
  }, []);

  // Traverse edges to find upstream CharacterNode mediaIds for a given node
  const getUpstreamCharacters = useCallback((nodeId: string): string[] => {
    const visited = new Set<string>();
    const queue = [nodeId];
    const allMediaIds: string[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      for (const edge of edgesRef.current.filter(e => e.target === currentId)) {
        const srcNode = nodesRef.current.find(n => n.id === edge.source);
        if (srcNode && !visited.has(srcNode.id)) {
          if (srcNode.type === 'character') {
            const ids = charMediaIdsRef.current[srcNode.id] || [];
            allMediaIds.push(...ids);
          }
          queue.push(srcNode.id);
        }
      }
    }
    return allMediaIds;
  }, []);

  // Traverse edges to find upstream CharacterNode entityIds
  const getUpstreamEntityIds = useCallback((nodeId: string): string[] => {
    const visited = new Set<string>();
    const queue = [nodeId];
    const allEntityIds: string[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      for (const edge of edgesRef.current.filter(e => e.target === currentId)) {
        const srcNode = nodesRef.current.find(n => n.id === edge.source);
        if (srcNode && !visited.has(srcNode.id)) {
          if (srcNode.type === 'character') {
            const entry = charEntityIdsRef.current[srcNode.id];
            if (entry?.entityId) allEntityIds.push(entry.entityId);
          }
          queue.push(srcNode.id);
        }
      }
    }
    return allEntityIds;
  }, []);

  // Get upstream character entities with names (for Geoveoai-style name matching)
  const getUpstreamCharacterEntities = useCallback((nodeId: string): { name: string; entityId: string }[] => {
    const visited = new Set<string>();
    const queue = [nodeId];
    const result: { name: string; entityId: string }[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      for (const edge of edgesRef.current.filter(e => e.target === currentId)) {
        const srcNode = nodesRef.current.find(n => n.id === edge.source);
        if (srcNode && !visited.has(srcNode.id)) {
          if (srcNode.type === 'character') {
            const entry = charEntityIdsRef.current[srcNode.id];
            if (entry?.entityId) result.push(entry);
          }
          queue.push(srcNode.id);
        }
      }
    }
    return result;
  }, []);

  const getUpstreamCharacterDetails = useCallback((nodeId: string): { name: string; entityId: string; mediaIds: string[]; voice?: string; personality?: string }[] => {
    const visited = new Set<string>();
    const queue = [nodeId];
    const result: { name: string; entityId: string; mediaIds: string[]; voice?: string; personality?: string }[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      for (const edge of edgesRef.current.filter(e => e.target === currentId)) {
        const srcNode = nodesRef.current.find(n => n.id === edge.source);
        if (srcNode && !visited.has(srcNode.id)) {
          if (srcNode.type === 'character') {
            const entry = charEntityIdsRef.current[srcNode.id];
            const mediaIds = charMediaIdsRef.current[srcNode.id] || [];
            const charName = (srcNode.data as any).charName || entry?.name || 'Nhân vật';
            const voice = (srcNode.data as any).voice || '';
            const personality = (srcNode.data as any).personality || '';
            // Include character even without entityId (can use mediaIds as plain refs)
            result.push({
              name: charName,
              entityId: entry?.entityId || '',
              mediaIds,
              voice,
              personality,
            });
          }
          queue.push(srcNode.id);
        }
      }
    }
    return result;
  }, []);

  // Traverse edges to find upstream ImageNode mediaId for I2V (single)
  const getUpstreamImageMediaId = useCallback((nodeId: string): string | null => {
    for (const edge of edgesRef.current.filter(e => e.target === nodeId)) {
      const srcNode = nodesRef.current.find(n => n.id === edge.source);
      if (srcNode && srcNode.type === 'image' && srcNode.data.mediaId) {
        return srcNode.data.mediaId as string;
      }
    }
    return null;
  }, []);

  // Find connected ImageUploadNode ID (for batch I2V — files stored in imageFileStore)
  const getUpstreamImageUploadNodeId = useCallback((nodeId: string): string | null => {
    for (const edge of edgesRef.current.filter(e => e.target === nodeId)) {
      const srcNode = nodesRef.current.find(n => n.id === edge.source);
      if (srcNode && srcNode.type === 'imageUpload') {
        return srcNode.id;
      }
    }
    return null;
  }, []);

  const onConnect = useCallback(
    (params: Edge | Connection) =>
      setEdges((eds) =>
        addEdge(
          { ...params, animated: true, style: { stroke: '#6366f1', strokeWidth: 2, opacity: 0.7 } } as any,
          eds
        )
      ),
    [setEdges]
  );

  // Add a new prompt node at center
  const addPromptNode = useCallback(() => {
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 };

    setNodes((nds) =>
      nds.concat({
        id: `prompt_${Date.now()}`,
        type: 'prompt',
        position,
        style: { width: 240, height: 180 },
        data: { prompt: '', isGeneratingImage: false, isGeneratingVideo: false },
      })
    );
  }, [setNodes, reactFlowInstance]);

  // Add batch node
  const addBatchNode = useCallback(() => {
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : { x: 300 + Math.random() * 100, y: 100 + Math.random() * 100 };

    setNodes((nds) =>
      nds.concat({
        id: `batch_${Date.now()}`,
        type: 'batch',
        position,
        style: { width: 320, height: 400 },
        data: { prompts: '', mode: 't2v', concurrent: 2, getUpstreamCharacters, getUpstreamEntityIds, getUpstreamCharacterEntities, getUpstreamImageMediaId, getUpstreamImageUploadNodeId, getUpstreamCharacterDetails },
      })
    );
  }, [setNodes, reactFlowInstance, getUpstreamCharacters, getUpstreamEntityIds, getUpstreamCharacterEntities, getUpstreamImageMediaId, getUpstreamImageUploadNodeId, getUpstreamCharacterDetails]);

  // Add image upload node (for I2V batch)
  const addImageUploadNode = useCallback(() => {
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: window.innerWidth / 3, y: window.innerHeight / 2 })
      : { x: 50 + Math.random() * 100, y: 100 + Math.random() * 100 };

    setNodes((nds) =>
      nds.concat({
        id: `imgup_${Date.now()}`,
        type: 'imageUpload',
        position,
        style: { width: 260, height: 200 },
        data: {},
      })
    );
  }, [setNodes, reactFlowInstance]);

  // Add batch T2I node (tạo ảnh hàng loạt từ text)
  const addBatchT2INode = useCallback(() => {
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 };

    setNodes((nds) =>
      nds.concat({
        id: `prompt_t2i_${Date.now()}`,
        type: 'prompt',
        position,
        style: { width: 260, height: 220 },
        data: { prompt: '', isGeneratingImage: false, imageOnly: true, modeLabel: 'T2I Batch' },
      })
    );
    toast.success('📷 PromptNode T2I — nhập nhiều prompt (1 dòng = 1 ảnh), bấm Gen');
  }, [setNodes, reactFlowInstance]);

  // Add batch R2I node (tạo ảnh hàng loạt từ tham chiếu + prompt)
  // Tạo ImageUploadNode + PromptNode R2I, tự nối lại
  const addBatchR2INode = useCallback(() => {
    const basePos = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: window.innerWidth / 3, y: window.innerHeight / 2 })
      : { x: 100 + Math.random() * 100, y: 100 + Math.random() * 100 };

    const uploadNodeId = `imgup_r2i_${Date.now()}`;
    const promptNodeId = `prompt_r2i_${Date.now()}`;

    // 1. Tạo ImageUploadNode (upload ảnh tham chiếu)
    const uploadNode = {
      id: uploadNodeId,
      type: 'imageUpload',
      position: { x: basePos.x, y: basePos.y },
      style: { width: 260, height: 200 },
      data: { label: 'Ảnh tham chiếu R2I' },
    };

    // 2. Tạo PromptNode R2I (nhập prompt)
    const promptNode = {
      id: promptNodeId,
      type: 'prompt',
      position: { x: basePos.x + 300, y: basePos.y },
      style: { width: 260, height: 220 },
      data: { prompt: '', isGeneratingImage: false, imageOnly: true, useReference: true, modeLabel: 'R2I Batch' },
    };

    setNodes((nds) => [...nds, uploadNode, promptNode]);

    // 3. Auto-connect: ImageUpload → PromptNode R2I
    setEdges(eds => [...eds, {
      id: `e_${uploadNodeId}_${promptNodeId}`,
      source: uploadNodeId,
      target: promptNodeId,
      animated: true,
      style: { stroke: '#ec4899', strokeWidth: 2, opacity: 0.7 },
    }]);

    toast.success('📸 R2I: Upload ảnh tham chiếu (trái) → Nhập prompt (phải) → Bấm Gen');
  }, [setNodes, setEdges, reactFlowInstance]);

  // Add character node (max 11)
  const addCharacterNode = useCallback(() => {
    const existingChars = nodesRef.current.filter(n => n.type === 'character');
    if (existingChars.length >= 11) {
      toast.error('Tối đa 11 nhân vật tham chiếu');
      return;
    }
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: window.innerWidth / 3, y: window.innerHeight / 2 })
      : { x: 50 + Math.random() * 100, y: 100 + Math.random() * 100 };

    setNodes((nds) =>
      nds.concat({
        id: `char_${Date.now()}`,
        type: 'character',
        position,
        data: { charName: 'Nhân vật', charImages: [], onMediaIdsChange: onCharMediaIdsChange, onEntityIdChange: onCharEntityIdChange },
      })
    );
  }, [setNodes, reactFlowInstance, onCharMediaIdsChange, onCharEntityIdChange]);

  // Add image collector node
  const addImageCollectorNode = useCallback(() => {
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : { x: 200 + Math.random() * 100, y: 100 + Math.random() * 100 };

    setNodes((nds) =>
      nds.concat({
        id: `collector_${Date.now()}`,
        type: 'imageCollector',
        position,
        style: { width: 260, height: 200 },
        data: { collectedMediaIds: [], collectedImageUrls: [] },
      })
    );
    toast.success('📦 Image Collector — nối PromptNode → Collector → R2I PromptNode');
  }, [setNodes, reactFlowInstance]);

  // Add video prompt node
  const addVideoPromptNode = useCallback(() => {
    const position = reactFlowInstance
      ? reactFlowInstance.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : { x: 300 + Math.random() * 100, y: 100 + Math.random() * 100 };

    setNodes((nds) =>
      nds.concat({
        id: `vidprompt_${Date.now()}`,
        type: 'videoPrompt',
        position,
        style: { width: 260, height: 220 },
        data: { videoPrompt: '', isGeneratingVideo: false, generatedCount: 0 },
      })
    );
    toast.success('🎬 Video Prompt — mỗi dòng = 1 prompt video · Auto-chain khi ảnh xong');
  }, [setNodes, reactFlowInstance]);

  // Delete node + connected edges
  const onDeleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }, [setNodes, setEdges]);

  // Get upstream reference media IDs by traversing edges
  const getUpstreamMediaIds = useCallback((nodeId: string): string[] => {
    const visited = new Set<string>();
    const queue = [nodeId];
    const mediaIds: string[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      for (const edge of edgesRef.current.filter((e) => e.target === currentId)) {
        const src = nodesRef.current.find((n) => n.id === edge.source);
        if (src && !visited.has(src.id)) {
          if (src.type === 'character') {
            const ids = charMediaIdsRef.current[src.id] || [];
            mediaIds.push(...ids);
          } else if (src.type === 'imageCollector') {
            // ImageCollectorNode: get collected mediaIds
            const collectedIds = (src.data.collectedMediaIds as string[]) || (src.data.mediaIds as string[]) || [];
            mediaIds.push(...collectedIds);
          } else if (src.data.mediaId) {
            mediaIds.push(src.data.mediaId as string);
          } else if (src.data.mediaIds) {
            const ids = src.data.mediaIds as string[];
            mediaIds.push(...ids);
          }
          queue.push(src.id);
        }
      }
    }
    return [...new Set(mediaIds)];
  }, []);

  // Get upstream CharacterNodes with names and media IDs
  const getUpstreamCharacterNodes = useCallback((nodeId: string) => {
    const visited = new Set<string>();
    const queue = [nodeId];
    const results: { nodeId: string; name: string; mediaIds: string[]; entityId: string }[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      for (const edge of edgesRef.current.filter(e => e.target === currentId)) {
        const srcNode = nodesRef.current.find(n => n.id === edge.source);
        if (srcNode && !visited.has(srcNode.id)) {
          if (srcNode.type === 'character') {
            const name = (srcNode.data as any).charName || charEntityIdsRef.current[srcNode.id]?.name || 'Nhân vật';
            const mediaIds = charMediaIdsRef.current[srcNode.id] || [];
            const entityId = (srcNode.data as any).entityId || charEntityIdsRef.current[srcNode.id]?.entityId || '';
            results.push({ nodeId: srcNode.id, name, mediaIds, entityId });
          }
          queue.push(srcNode.id);
        }
      }
    }
    return results;
  }, []);

  // Process prompt to replace character names/IDs with image_X.png to match reference order
  const processPromptReferences = useCallback((prompt: string, refMediaIds: string[], upstreamChars: { name: string; mediaIds: string[] }[]): string => {
    let processed = prompt;
    
    // Replace custom character names with image_X.png based on mediaId index in refMediaIds
    upstreamChars.forEach((char) => {
      if (char.mediaIds && char.mediaIds.length > 0) {
        const firstMid = char.mediaIds[0];
        const idx = refMediaIds.indexOf(firstMid);
        if (idx !== -1) {
          // Escape regex special chars in name
          const escapedName = char.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedName}\\b`, 'gi');
          processed = processed.replace(regex, `image_${idx}.png`);
        }
      }
    });

    // Also support custom tag replacements like ref_0 -> image_0.png, [ref_1] -> image_1.png
    for (let i = 0; i < refMediaIds.length; i++) {
      const refPlaceholderRegex = new RegExp(`\\[ref_${i}\\]|\\bref_${i}\\b`, 'gi');
      processed = processed.replace(refPlaceholderRegex, `image_${i}.png`);
    }

    // Support product and model placeholders (like product_X, model_A, boy_B, etc.)
    // If only 1 reference is uploaded, map all placeholders to image_0.png
    if (refMediaIds.length === 1) {
      processed = processed.replace(/\[product_[A-Z0-9]\]|\bproduct_[A-Z0-9]\b|\[product\]|\bproduct\b|\bsản phẩm\b/gi, 'image_0.png');
      processed = processed.replace(/\[model_[A-Z0-9]\]|\bmodel_[A-Z0-9]\b|\[model\]|\bmodel\b|\[boy_[A-Z0-9]\]|\bboy_[A-Z0-9]\b|\[girl_[A-Z0-9]\]|\bgirl_[A-Z0-9]\b|\bngười mẫu\b/gi, 'image_0.png');
    } else if (refMediaIds.length > 1) {
      // If multiple references are uploaded, product -> image_0.png, model -> image_1.png
      processed = processed.replace(/\[product_[A-Z0-9]\]|\bproduct_[A-Z0-9]\b|\[product\]|\bproduct\b|\bsản phẩm\b/gi, 'image_0.png');
      processed = processed.replace(/\[model_[A-Z0-9]\]|\bmodel_[A-Z0-9]\b|\[model\]|\bmodel\b|\[boy_[A-Z0-9]\]|\bboy_[A-Z0-9]\b|\[girl_[A-Z0-9]\]|\bgirl_[A-Z0-9]\b|\bngười mẫu\b/gi, 'image_1.png');
    }

    // Append negative constraints to prevent baking reference thumbnails/frames/borders into the final image
    if (refMediaIds.length > 0) {
      processed += " Seamless unified realistic scene. Do not show any literal file icon, photograph print, picture in picture, floating thumbnail preview, frame, border, or watermark of the reference image.";
    }

    return processed;
  }, []);

  // Generate Image from a prompt node
  const onGenImage = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node || !node.data.prompt) return;
    const prompt = node.data.prompt as string;
    let refMediaIds = getUpstreamMediaIds(nodeId);

    // R2I: if upstream is ImageUploadNode, upload images to get mediaIds
    if (node.data.useReference && refMediaIds.length === 0) {
      const upstreamEdges = edgesRef.current.filter(e => e.target === nodeId);
      for (const edge of upstreamEdges) {
        const srcNode = nodesRef.current.find(n => n.id === edge.source);
        if (srcNode && srcNode.type === 'imageUpload') {
          const { getImageFiles } = await import('../stores/imageFileStore');
          const files = getImageFiles(srcNode.id);
          if (files.length === 0) {
            toast.error('⚠️ Chưa upload ảnh tham chiếu! Thêm ảnh vào node bên trái');
            return;
          }
          toast.loading(`📤 Uploading ${files.length} ảnh tham chiếu...`, { id: 'r2i-upload' });
          for (const file of files) {
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('project_id', settings.flowkitProjectId || '');
              const res = await axios.post('/api/generate/upload-reference', formData);
              if (res.data.media_id) refMediaIds.push(res.data.media_id);
            } catch (err) {
              console.error('Upload ref failed:', err);
            }
          }
          toast.dismiss('r2i-upload');
          if (refMediaIds.length > 0) {
            toast.success(`✅ ${refMediaIds.length} ảnh tham chiếu uploaded`);
            // Dynamic waiting delay to check and synchronize reference images (avoiding missing refs)
            const waitTimeMs = refMediaIds.length * 2000;
            const steps = Math.ceil(waitTimeMs / 1000);
            for (let s = steps; s > 0; s--) {
              toast.loading(`⏳ Đang đồng bộ hóa & kiểm tra ${refMediaIds.length} ảnh tham chiếu (tránh sót): Còn ${s} giây...`, { id: 'r2i-wait' });
              await new Promise(r => setTimeout(r, 1000));
            }
            toast.dismiss('r2i-wait');
            toast.success('✨ Đồng bộ hóa hoàn tất! Bắt đầu tạo ảnh...');
          }
        }
      }
    }

    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingImage: true } } : n));

    try {
      const aspectRatio = (node.data.aspectRatio as string) || 'IMAGE_ASPECT_RATIO_LANDSCAPE';
      const upstreamChars = getUpstreamCharacterNodes(nodeId);
      const finalPrompt = processPromptReferences(prompt, refMediaIds, upstreamChars);
      
      const res = await axios.post('/api/generate/image', {
        prompt: finalPrompt,
        project_id: settings.flowkitProjectId,
        reference_media_ids: refMediaIds,
        aspect_ratio: aspectRatio,
      });

      if (!res.data.success || !res.data.url) {
        const apiError = res.data.error;
        let errorText = "No image URL returned";
        if (typeof apiError === 'string') {
          errorText = apiError;
        } else if (apiError && typeof apiError === 'object') {
          const errObj = apiError.data?.error || apiError.error || apiError;
          errorText = errObj.message || errObj.error || JSON.stringify(errObj);
        }
        throw new Error(errorText);
      }
      const imageUrl = res.data.url;
      const mediaId = res.data.media_id;

      // Create ImageNode
      const imageNodeId = `img_${Date.now()}`;
      setNodes((nds) =>
        nds
          .map((n) => n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingImage: false } } : n)
          .concat({
            id: imageNodeId,
            type: 'image',
            position: { x: (node.position?.x || 0) + 380, y: (node.position?.y || 0) },
            style: nodeSize(aspectRatio),
            data: { imageUrl, mediaId, prompt, videoPrompts: (node.data as any).videoPrompts || [prompt], aspectRatio, isGeneratingVideo: false },
          })
      );
      // Auto-connect
      setEdges((eds) => eds.concat({
        id: `e_${nodeId}_${imageNodeId}`,
        source: nodeId,
        target: imageNodeId,
        animated: true,
        style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
      }));

      toast.success('Image generated!');
    } catch (err: any) {
      toast.error('Image gen failed: ' + (err?.response?.data?.detail || err.message));
      setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingImage: false } } : n));
    }
  }, [settings.flowkitProjectId, getUpstreamMediaIds, setNodes, setEdges]);

  // Generate Video from a prompt node or image node
  const onGenVideo = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;

    // ═══ GUARD: Prevent duplicate video generation ═══
    // Skip if this node is already generating a video
    if (node.data.isGeneratingVideo) {
      console.log(`[onGenVideo] Node ${nodeId} is already generating video. Skipping.`);
      return;
    }
    // Skip if this image node already has a video child node
    const existingVideoChild = nodesRef.current.find(n =>
      n.type === 'video' && n.data.sourceImageNodeId === nodeId && (n.data.videoUrl || n.data.isGeneratingVideo)
    );
    if (existingVideoChild) {
      console.log(`[onGenVideo] Node ${nodeId} already has a video child (${existingVideoChild.id}). Skipping.`);
      return;
    }

    // Block video generation for reference nodes (Characters, Backgrounds, Props)
    const label = (node.data.label as string) || '';
    if (label.startsWith('👤') || label.startsWith('🏞️') || label.startsWith('🎭')) {
      toast.error('Không thể tạo video từ ảnh tham chiếu!');
      return;
    }

    let prompt = (node.data.prompt as string) || 'animate this';
    // Use rich parameterized video prompts if available to maintain lip-sync & cinematography consistency
    if (node.data.videoPrompts && Array.isArray(node.data.videoPrompts) && node.data.videoPrompts.length > 0) {
      prompt = node.data.videoPrompts[0];
    } else if (node.data.video_prompts && Array.isArray(node.data.video_prompts) && node.data.video_prompts.length > 0) {
      prompt = node.data.video_prompts[0];
    }

    const startImageMediaId = (node.data.mediaId as string) || null;
    const frameUrl = (node.data.imageUrl as string) || null;

    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingVideo: true } } : n));

    try {
      // Map image aspect to video aspect
      const imgAspect = (node.data.aspectRatio as string) || '';
      const videoAspect = imgAspect
        ? imgAspect.replace('IMAGE_', 'VIDEO_')
        : 'VIDEO_ASPECT_RATIO_LANDSCAPE';

      const res = await axios.post('/api/generate/video', {
        prompt,
        project_id: settings.flowkitProjectId,
        start_image_media_id: startImageMediaId,
        aspect_ratio: videoAspect,
      });

      if (!res.data.success || !res.data.job_id) {
        const apiError = res.data.error;
        let errorText = "Video generation failed";
        if (typeof apiError === 'string') {
          errorText = apiError;
        } else if (apiError && typeof apiError === 'object') {
          const errObj = apiError.data?.error || apiError.error || apiError;
          errorText = errObj.message || errObj.error || JSON.stringify(errObj);
        }
        throw new Error(errorText);
      }
      const jobId = res.data.job_id;

      // Create VideoNode
      const videoNodeId = `vid_${Date.now()}`;
      const yOffset = edgesRef.current.filter((e) => e.source === nodeId).length * 160;

      const promptIndex = node.data.promptIndex || node.data.sceneNumber || null;

      setNodes((nds) =>
        nds
          .map((n) => n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingVideo: false } } : n)
          .concat({
            id: videoNodeId,
            type: 'video',
            position: { x: (node.position?.x || 0) + 340, y: (node.position?.y || 0) + yOffset },
            style: { width: 240, height: 180 },
            data: { jobId, prompt, frameUrl, aspectRatio: videoAspect, isGeneratingVideo: true, promptIndex },
          })
      );
      // Auto-connect
      setEdges((eds) => eds.concat({
        id: `e_${nodeId}_${videoNodeId}`,
        source: nodeId,
        target: videoNodeId,
        animated: true,
        style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
      }));

      toast.success('Video generation started!');
    } catch (err: any) {
      toast.error('Video gen failed: ' + (err?.response?.data?.detail || err.message));
      setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingVideo: false } } : n));
    }
  }, [settings.flowkitProjectId, setNodes, setEdges]);

  // Generate videos from VideoPromptNode — finds upstream ImageNodes and matches prompts by order
  const onGenVideoFromVideoPrompt = useCallback(async (videoPromptNodeId: string) => {
    const vpNode = nodesRef.current.find(n => n.id === videoPromptNodeId);
    if (!vpNode) return;

    // ═══ GUARD: Prevent re-entry / duplicate generation ═══
    if (vpNode.data.isGeneratingVideo) {
      console.log(`[onGenVideoFromVideoPrompt] Node ${videoPromptNodeId} is already generating. Skipping.`);
      return;
    }

    const videoPromptText = (vpNode.data.videoPrompt as string) || '';
    const videoLines = videoPromptText.split('\n').filter(l => l.trim());
    if (videoLines.length === 0) {
      toast.error('Chưa nhập video prompt!');
      return;
    }

    const videoAspect = (vpNode.data.videoAspectRatio as string) || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
    const vpVideoModel = (vpNode.data.videoModel as string) || '';
    const audioVoiceId = (vpNode.data.audioVoiceId as string) || '';

    // Find upstream ImageNodes connected to this VideoPromptNode
    // Support: direct ImageNodes, PromptNode's children, ImageCollector's collected images
    const upstreamImages: { nodeId: string; mediaId: string; imageUrl: string; prompt: string }[] = [];
    const upstreamEntities: string[] = [];

    // Direct upstream: edges → this node
    const directEdges = edgesRef.current.filter(e => e.target === videoPromptNodeId);
    for (const edge of directEdges) {
      const srcNode = nodesRef.current.find(n => n.id === edge.source);
      if (!srcNode) continue;

      if (srcNode.type === 'character') {
        const entityId = (srcNode.data as any).entityId || charEntityIdsRef.current[srcNode.id]?.entityId || '';
        if (entityId) {
          upstreamEntities.push(entityId);
        }
        const charMediaIds = (srcNode.data as any).mediaIds || [];
        const charUrls = (srcNode.data as any).imageUrls || (srcNode.data as any).urls || [];
        for (let ci = 0; ci < charMediaIds.length; ci++) {
          upstreamImages.push({
            nodeId: srcNode.id,
            mediaId: charMediaIds[ci],
            imageUrl: charUrls[ci] || '',
            prompt: `${(srcNode.data as any).charName || 'character'}-ref-${ci + 1}`,
          });
        }
      }

      if (srcNode.type === 'imageUpload') {
        const { getImageFiles } = await import('../stores/imageFileStore');
        const files = getImageFiles(srcNode.id);
        if (files.length > 0) {
          toast.loading(`📤 Đang tải lên ${files.length} ảnh tham chiếu từ nút upload...`, { id: 'r2v-upload' });
          for (let fi = 0; fi < files.length; fi++) {
            try {
              const formData = new FormData();
              formData.append('file', files[fi]);
              formData.append('project_id', settings.flowkitProjectId || '');
              const res = await axios.post('/api/generate/upload-reference', formData);
              if (res.data.media_id) {
                upstreamImages.push({
                  nodeId: srcNode.id,
                  mediaId: res.data.media_id,
                  imageUrl: res.data.url || '',
                  prompt: `upload-image-${fi + 1}`,
                });
              }
            } catch (err: any) {
              console.error('Upload ref image failed:', err.message);
            }
          }
          toast.dismiss('r2v-upload');
        }
      }

      if (srcNode.type === 'image' && srcNode.data.mediaId) {
        upstreamImages.push({
          nodeId: srcNode.id,
          mediaId: srcNode.data.mediaId as string,
          imageUrl: (srcNode.data.imageUrl as string) || '',
          prompt: (srcNode.data.prompt as string) || '',
        });
      } else if (srcNode.type === 'prompt') {
        // PromptNode upstream → find all ImageNodes it generated
        const promptChildEdges = edgesRef.current.filter(e => e.source === srcNode.id && e.target !== videoPromptNodeId);
        for (const ce of promptChildEdges) {
          const childNode = nodesRef.current.find(n => n.id === ce.target);
          if (childNode && childNode.type === 'image' && childNode.data.mediaId) {
            upstreamImages.push({
              nodeId: childNode.id,
              mediaId: childNode.data.mediaId as string,
              imageUrl: (childNode.data.imageUrl as string) || '',
              prompt: (childNode.data.prompt as string) || '',
            });
          }
        }
      } else if (srcNode.type === 'imageCollector') {
        // ImageCollector upstream → use its collected mediaIds
        const collectedIds = (srcNode.data.collectedMediaIds as string[]) || [];
        const collectedUrls = (srcNode.data.collectedUrls as string[]) || [];

        if (collectedIds.length > 0) {
          for (let ci = 0; ci < collectedIds.length; ci++) {
            upstreamImages.push({
              nodeId: srcNode.id,
              mediaId: collectedIds[ci],
              imageUrl: collectedUrls[ci] || '',
              prompt: `ref-image-${ci + 1}`,
            });
          }
        } else {
          // Fallback: Find ImageNodes generated by upstream PromptNode of this collector
          const collectorUpEdges = edgesRef.current.filter(e => e.target === srcNode.id);
          for (const cue of collectorUpEdges) {
            const collectorSrc = nodesRef.current.find(n => n.id === cue.source);
            if (collectorSrc?.type === 'prompt') {
              const pChildEdges = edgesRef.current.filter(e => e.source === collectorSrc.id && e.target !== srcNode.id);
              for (const pce of pChildEdges) {
                const imgNode = nodesRef.current.find(n => n.id === pce.target);
                if (imgNode && imgNode.type === 'image' && imgNode.data.mediaId) {
                  upstreamImages.push({
                    nodeId: imgNode.id,
                    mediaId: imgNode.data.mediaId as string,
                    imageUrl: (imgNode.data.imageUrl as string) || '',
                    prompt: (imgNode.data.prompt as string) || '',
                  });
                }
              }
            }
          }
        }
      }
    }

    if (upstreamImages.length === 0) {
      toast.error('Chưa có ảnh upstream! Nối ImageNode, PromptNode hoặc ImageCollector vào.');
      return;
    }

    // ⚠️ CRITICAL: Sort by promptIndex to ensure correct order matching with video prompt lines
    // Without this, images from edges can be in arbitrary order → videos use wrong source images
    upstreamImages.sort((a, b) => {
      const aNode = nodesRef.current.find(n => n.id === a.nodeId);
      const bNode = nodesRef.current.find(n => n.id === b.nodeId);
      const aIdx = (aNode?.data?.promptIndex as number) || 0;
      const bIdx = (bNode?.data?.promptIndex as number) || 0;
      if (aIdx !== bIdx) return aIdx - bIdx;
      // Fallback: sort by Y position (top to bottom)
      const aY = aNode?.position?.y || 0;
      const bY = bNode?.position?.y || 0;
      return aY - bY;
    });

    console.log('[VP] Upstream images sorted:', upstreamImages.map((img, i) => {
      const n = nodesRef.current.find(nd => nd.id === img.nodeId);
      return `#${i}: promptIndex=${n?.data?.promptIndex}, label=${n?.data?.label || ''}, mediaId=${img.mediaId.slice(0,8)}...`;
    }));

    const vpModelType = (vpNode.data.videoModelType as string) || 'i2v';
    const isR2V = vpModelType === 'r2v';
    const limit = vpVideoModel.startsWith('abra_') ? 7 : 3;

    // Build lookup: index → { mediaId, url }
    const allRefMediaIds = upstreamImages.map(img => img.mediaId);
    const allRefUrls = upstreamImages.map(img => img.imageUrl).filter(Boolean);

    /**
     * Parse ref tags from prompt: {ref_0} {ref_1} ref_0 ref_1 [ref_0]
     * Returns { indices, cleanPrompt }
     */
    const parseRefTags = (prompt: string): { indices: number[]; cleanPrompt: string } => {
      const indices: number[] = [];
      const seen = new Set<number>();
      // Match {ref_N}, [ref_N], ref_N patterns
      const regex = /\{ref_(\d+)\}|\[ref_(\d+)\]|\bref_(\d+)\b/gi;
      let match;
      while ((match = regex.exec(prompt)) !== null) {
        const idx = parseInt(match[1] ?? match[2] ?? match[3], 10);
        if (!seen.has(idx) && idx < allRefMediaIds.length) {
          seen.add(idx);
          indices.push(idx);
        }
      }
      // Clean prompt: remove ref tags
      const cleanPrompt = prompt.replace(/\{ref_\d+\}\s*|\[ref_\d+\]\s*|\bref_\d+\b\s*/gi, '').trim();
      return { indices: indices.slice(0, limit), cleanPrompt }; // Max limit refs
    };

    const genItems: { videoPrompt: string; mediaId: string; imageUrl: string; refMediaIds: string[]; refUrls: string[]; entityIds: string[]; videoModel: string }[] = [];

    if (isR2V) {
      // R2V: Parse ref tags từ mỗi dòng prompt → lấy đúng ảnh đó
      for (let i = 0; i < videoLines.length; i++) {
        const { indices, cleanPrompt } = parseRefTags(videoLines[i]);
        let selectedMediaIds: string[];
        let selectedUrls: string[];

        if (indices.length > 0) {
          // Có ref tags → dùng đúng ảnh chỉ định
          selectedMediaIds = indices.map(idx => allRefMediaIds[idx]);
          selectedUrls = indices.map(idx => allRefUrls[idx] || '').filter(Boolean);
        } else {
          // Không có ref tags → dùng tối đa limit ảnh đầu
          selectedMediaIds = allRefMediaIds.slice(0, limit);
          selectedUrls = allRefUrls.slice(0, limit);
        }

        const { cleanPrompt: finalPrompt, model: lineModel } = parseModelOverride(cleanPrompt || videoLines[i], vpVideoModel, vpModelType);

        genItems.push({
          videoPrompt: finalPrompt,
          mediaId: selectedMediaIds[0] || '',
          imageUrl: '',
          refMediaIds: selectedMediaIds,
          refUrls: selectedUrls,
          entityIds: upstreamEntities,
          videoModel: lineModel,
        });
      }
    } else {
      // I2V: ảnh #N ↔ prompt #N (1:1)
      for (let i = 0; i < upstreamImages.length; i++) {
        const { cleanPrompt: finalPrompt, model: lineModel } = parseModelOverride(videoLines[i] || videoLines[videoLines.length - 1] || 'animate this', vpVideoModel, vpModelType);
        genItems.push({
          videoPrompt: finalPrompt,
          mediaId: upstreamImages[i].mediaId,
          imageUrl: upstreamImages[i].imageUrl,
          refMediaIds: [],
          refUrls: [],
          entityIds: [],
          videoModel: lineModel,
        });
      }
    }

    setNodes(nds => nds.map(n => n.id === videoPromptNodeId ? { ...n, data: { ...n.data, isGeneratingVideo: true } } : n));

    // Clear cache before gen (if enabled) — use standard function same as BatchNode
    const shouldClearCache = (vpNode.data.clearCacheBeforeGen as boolean) || false;
    if (shouldClearCache) {
      try {
        await clearCacheAndWaitForReady();
      } catch (err: any) {
        toast.error(`⚠️ Xoá cache lỗi: ${err.message}, vẫn tiếp tục...`);
      }
    }

    // ─── Concurrent video generation ───
    const concurrentCount = (vpNode.data.concurrent as number) || 1;
    let genCount = 0;
    let successCount = 0;
    let successesSinceLastClear = 0;
    const autoClearCache = localStorage.getItem('auto_clear_cache') !== 'false';

    // Helper: generate 1 video — sends request, creates node, polls until DONE/FAILED
    const genOneVideo = async (item: typeof genItems[0], idx: number): Promise<{ jobId: string; nodeId: string; status: string } | null> => {
      try {
        toast.loading(`🎬 ${isR2V ? 'R2V' : 'I2V'} Video ${idx + 1}/${genItems.length} — gửi request...`, { id: `vp-gen-${idx}` });

        let res: any;
        if (isR2V) {
          const r2vPayload: any = {
            prompt: item.videoPrompt,
            project_id: settings.flowkitProjectId,
            reference_media_ids: item.refMediaIds,
            entity_ids: item.entityIds,
            aspect_ratio: videoAspect,
            audio_voice_id: audioVoiceId || undefined,
          };
          if (item.videoModel || vpVideoModel) r2vPayload.video_model = item.videoModel || vpVideoModel;
          res = await axios.post('/api/generate/r2v', r2vPayload);
        } else {
          const videoPayload: any = {
            prompt: item.videoPrompt,
            project_id: settings.flowkitProjectId,
            start_image_media_id: item.mediaId,
            aspect_ratio: videoAspect,
          };
          if (item.videoModel || vpVideoModel) videoPayload.video_model = item.videoModel || vpVideoModel;
          res = await axios.post('/api/generate/video', videoPayload);
        }

        if (res.data.success && res.data.job_id) {
          const jobId = res.data.job_id;
          const videoNodeId = `vid_vp_${Date.now()}_${idx}`;
          const vpx = vpNode.position?.x || 0;
          const vpy = vpNode.position?.y || 0;

          const col = idx % 5;
          const row = Math.floor(idx / 5);
          const vx = vpx + 340 + col * 260;
          const vy = vpy + row * 200;

          setNodes(nds => nds.concat({
            id: videoNodeId,
            type: 'video',
            position: { x: vx, y: vy },
            style: { width: 240, height: 180 },
            data: {
              jobId,
              prompt: item.videoPrompt,
              frameUrl: item.imageUrl || '',
              aspectRatio: videoAspect,
              isGeneratingVideo: true,
              promptIndex: idx + 1,
              startedAt: Date.now(),
              sourceMediaId: item.mediaId,
              sourceVpNodeId: videoPromptNodeId,
              referenceUrls: item.refUrls,
              sourceRefMediaIds: item.refMediaIds,
              videoModel: item.videoModel || vpVideoModel,
              audioVoiceId: audioVoiceId || undefined,
              entityIds: item.entityIds || [],
              workflowIndex: vpNode.data?.workflowIndex,
              workflowId: vpNode.data?.workflowId,
            },
          }));
          setEdges(eds => eds.concat({
            id: `e_${videoPromptNodeId}_${videoNodeId}`,
            source: videoPromptNodeId,
            target: videoNodeId,
            animated: true,
            style: { stroke: '#14b8a6', strokeWidth: 2, opacity: 0.7 },
          }));
          toast.loading(`🎬 Video ${idx + 1}/${genItems.length} — đang render...`, { id: `vp-gen-${idx}` });
          return { jobId, nodeId: videoNodeId, status: 'PENDING' };
        } else {
          toast.error(`❌ Video ${idx + 1} failed to start`, { id: `vp-gen-${idx}` });
          return null;
        }
      } catch (err: any) {
        toast.error(`❌ Video ${idx + 1}: ${err?.response?.data?.detail || err.message}`, { id: `vp-gen-${idx}` });
        return null;
      }
    };

    // Helper: poll a batch of jobs until all are DONE/FAILED
    const waitForBatch = async (jobs: { jobId: string; nodeId: string; idx: number }[]) => {
      const pending = new Map(jobs.map(j => [j.jobId, j]));
      const maxWait = 300000; // 5 min max per batch
      const start = Date.now();

      while (pending.size > 0 && Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 5000)); // poll every 5s
        
        for (const [jobId, job] of Array.from(pending.entries())) {
          try {
            const res = await axios.get(`/api/generate/jobs/${jobId}`);
            const status = res.data.status;
            if (status === 'DONE') {
              const videoUrl = res.data.video_url || res.data.url || '';
              setNodes(nds => nds.map(n => n.id === job.nodeId ? {
                ...n, data: { ...n.data, videoUrl, isGeneratingVideo: false, status: 'done' }
              } : n));
              toast.success(`✅ Video ${job.idx + 1} hoàn thành!`, { id: `vp-gen-${job.idx}` });
              successCount++;
              successesSinceLastClear++;
              pending.delete(jobId);
            } else if (status === 'FAILED') {
              const errorMsg = res.data.url || 'Lỗi không xác định';
              setNodes(nds => nds.map(n => n.id === job.nodeId ? {
                ...n, data: { ...n.data, isGeneratingVideo: false, status: 'failed', errorMsg }
              } : n));
              toast.error(`❌ Video ${job.idx + 1} render lỗi: ${errorMsg}`, { id: `vp-gen-${job.idx}` });
              pending.delete(jobId);
            }
          } catch (err: any) {
            // Polling error — skip this round, retry next
            if (err?.response?.status === 429 || err?.response?.status === 503) {
              await new Promise(r => setTimeout(r, 10000));
            }
          }
        }
        
        // Show progress
        const remaining = pending.size;
        if (remaining > 0) {
          toast.loading(`⏳ Đang chờ ${remaining} video render xong...`, { id: 'vp-batch-wait' });
        }
      }
      
      toast.dismiss('vp-batch-wait');

      // Mark timeout jobs
      for (const [, job] of pending) {
        setNodes(nds => nds.map(n => n.id === job.nodeId ? {
          ...n, data: { ...n.data, isGeneratingVideo: false, status: 'failed' }
        } : n));
        toast.error(`⏰ Video ${job.idx + 1} timeout`, { id: `vp-gen-${job.idx}` });
      }
    };

    // ─── Run batches: send N → wait all done → next N ───
    for (let i = 0; i < genItems.length; i += concurrentCount) {
      const batchItems = genItems.slice(i, i + concurrentCount);
      const batchLabel = `Batch ${Math.floor(i / concurrentCount) + 1}/${Math.ceil(genItems.length / concurrentCount)}`;
      toast.loading(`🎬 ${batchLabel}: Gửi ${batchItems.length} video...`, { id: 'vp-batch-progress' });
      
      // Send requests in this batch sequentially with 5s delay
      const results = [];
      for (let batchIdx = 0; batchIdx < batchItems.length; batchIdx++) {
        if (batchIdx > 0) {
          toast.loading(`⏳ Chờ 5 giây trước khi kích hoạt video tiếp theo...`, { id: 'vp-batch-delay' });
          await new Promise(r => setTimeout(r, 5000));
          toast.dismiss('vp-batch-delay');
        }
        const res = await genOneVideo(batchItems[batchIdx], i + batchIdx);
        results.push(res);
      }

      // Collect successful jobs to poll
      const activeJobs = results
        .map((r, batchIdx) => r ? { jobId: r.jobId, nodeId: r.nodeId, idx: i + batchIdx } : null)
        .filter((j): j is { jobId: string; nodeId: string; idx: number } => j !== null);

      genCount += batchItems.length;

      // Wait for ALL jobs in this batch to complete before proceeding
      if (activeJobs.length > 0) {
        toast.loading(`⏳ ${batchLabel}: Chờ ${activeJobs.length} video render...`, { id: 'vp-batch-progress' });
        await waitForBatch(activeJobs);
      }

      // Auto-clear cache if needed
      if (autoClearCache && successesSinceLastClear >= 50) {
        try { await clearCacheAndWaitForReady(); } catch {}
        successesSinceLastClear = 0;
      }

      // Delay before next batch
      if (i + concurrentCount < genItems.length) {
        toast.loading(`⏳ Nghỉ 5s trước batch tiếp...`, { id: 'vp-batch-progress' });
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    toast.dismiss('vp-batch-progress');

    setNodes(nds => nds.map(n => n.id === videoPromptNodeId ? { ...n, data: { ...n.data, isGeneratingVideo: false, generatedCount: successCount } } : n));
    toast.success(`🎬 ${successCount}/${genItems.length} videos started!`);
  }, [settings.flowkitProjectId, setNodes, setEdges, clearCacheAndWaitForReady]);

  // Retry only failed/incomplete videos from VideoPromptNode
  const onRetryFailedFromVideoPrompt = useCallback(async (videoPromptNodeId: string) => {
    const vpNode = nodesRef.current.find(n => n.id === videoPromptNodeId);
    if (!vpNode) return;

    const videoPromptText = (vpNode.data.videoPrompt as string) || '';
    const videoLines = videoPromptText.split('\n').filter(l => l.trim());
    const videoAspect = (vpNode.data.videoAspectRatio as string) || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
    const vpVideoModel = (vpNode.data.videoModel as string) || '';
    const audioVoiceId = (vpNode.data.audioVoiceId as string) || '';
    const vpModelType = (vpNode.data.videoModelType as string) || 'i2v';
    const isR2V = vpModelType === 'r2v';
    const limit = vpVideoModel.startsWith('abra_') ? 7 : 3;

    // Find downstream VideoNodes that are failed or incomplete
    const downEdges = edgesRef.current.filter(e => e.source === videoPromptNodeId);
    const downVideoNodes = downEdges
      .map(e => nodesRef.current.find(n => n.id === e.target))
      .filter(n => n && n.type === 'video');

    const failedNodes = downVideoNodes.filter(n => {
      if (!n) return false;
      const hasUrl = !!n.data.videoUrl;
      const isFailed = n.data.status === 'failed';
      const isGenerating = !!n.data.isGeneratingVideo;
      // Failed, or no URL and not currently generating
      return isFailed || (!hasUrl && !isGenerating);
    });

    if (failedNodes.length === 0) {
      toast.success('✅ Không có video lỗi nào cần tạo lại!');
      return;
    }

    // Find upstream images to match with failed videos
    const upstreamImages: { nodeId: string; mediaId: string; imageUrl: string; prompt: string }[] = [];
    const upstreamEntities: string[] = [];
    const directEdges = edgesRef.current.filter(e => e.target === videoPromptNodeId);
    for (const edge of directEdges) {
      const srcNode = nodesRef.current.find(n => n.id === edge.source);
      if (!srcNode) continue;

      if (srcNode.type === 'character') {
        const entityId = (srcNode.data as any).entityId || charEntityIdsRef.current[srcNode.id]?.entityId || '';
        if (entityId) {
          upstreamEntities.push(entityId);
        }
        const charMediaIds = (srcNode.data as any).mediaIds || [];
        const charUrls = (srcNode.data as any).imageUrls || (srcNode.data as any).urls || [];
        for (let ci = 0; ci < charMediaIds.length; ci++) {
          upstreamImages.push({
            nodeId: srcNode.id,
            mediaId: charMediaIds[ci],
            imageUrl: charUrls[ci] || '',
            prompt: `${(srcNode.data as any).charName || 'character'}-ref-${ci + 1}`,
          });
        }
      }

      if (srcNode.type === 'imageUpload') {
        const { getImageFiles } = await import('../stores/imageFileStore');
        const files = getImageFiles(srcNode.id);
        if (files.length > 0) {
          toast.loading(`📤 Đang tải lên ${files.length} ảnh tham chiếu từ nút upload...`, { id: 'r2v-upload' });
          for (let fi = 0; fi < files.length; fi++) {
            try {
              const formData = new FormData();
              formData.append('file', files[fi]);
              formData.append('project_id', settings.flowkitProjectId || '');
              const res = await axios.post('/api/generate/upload-reference', formData);
              if (res.data.media_id) {
                upstreamImages.push({
                  nodeId: srcNode.id,
                  mediaId: res.data.media_id,
                  imageUrl: res.data.url || '',
                  prompt: `upload-image-${fi + 1}`,
                });
              }
            } catch (err: any) {
              console.error('Upload ref image failed:', err.message);
            }
          }
          toast.dismiss('r2v-upload');
        }
      }

      if (srcNode.type === 'image' && srcNode.data.mediaId) {
        upstreamImages.push({
          nodeId: srcNode.id,
          mediaId: srcNode.data.mediaId as string,
          imageUrl: (srcNode.data.imageUrl as string) || '',
          prompt: (srcNode.data.prompt as string) || '',
        });
      } else if (srcNode.type === 'prompt') {
        const promptChildEdges = edgesRef.current.filter(e => e.source === srcNode.id && e.target !== videoPromptNodeId);
        for (const ce of promptChildEdges) {
          const childNode = nodesRef.current.find(n => n.id === ce.target);
          if (childNode && childNode.type === 'image' && childNode.data.mediaId) {
            upstreamImages.push({
              nodeId: childNode.id,
              mediaId: childNode.data.mediaId as string,
              imageUrl: (childNode.data.imageUrl as string) || '',
              prompt: (childNode.data.prompt as string) || '',
            });
          }
        }
      } else if (srcNode.type === 'imageCollector') {
        const collectedIds = (srcNode.data.collectedMediaIds as string[]) || [];
        const collectedUrls = (srcNode.data.collectedUrls as string[]) || [];
        if (collectedIds.length > 0) {
          for (let ci = 0; ci < collectedIds.length; ci++) {
            upstreamImages.push({
              nodeId: srcNode.id,
              mediaId: collectedIds[ci],
              imageUrl: collectedUrls[ci] || '',
              prompt: `ref-image-${ci + 1}`,
            });
          }
        }
      }
    }

    if (upstreamImages.length === 0) {
      toast.error('Chưa có ảnh upstream! Nối ImageNode, PromptNode hoặc ImageCollector vào.');
      return;
    }

    // Sort by promptIndex to match correct ordering
    upstreamImages.sort((a, b) => {
      const aNode = nodesRef.current.find(n => n.id === a.nodeId);
      const bNode = nodesRef.current.find(n => n.id === b.nodeId);
      const aIdx = (aNode?.data?.promptIndex as number) || 0;
      const bIdx = (bNode?.data?.promptIndex as number) || 0;
      if (aIdx !== bIdx) return aIdx - bIdx;
      const aY = aNode?.position?.y || 0;
      const bY = bNode?.position?.y || 0;
      return aY - bY;
    });

    const allRefMediaIds = upstreamImages.map(img => img.mediaId);
    const allRefUrls = upstreamImages.map(img => img.imageUrl).filter(Boolean);

    const parseRefTags = (prompt: string): { indices: number[]; cleanPrompt: string } => {
      const indices: number[] = [];
      const seen = new Set<number>();
      const regex = /\{ref_(\d+)\}|\[ref_(\d+)\]|\bref_(\d+)\b/gi;
      let match;
      while ((match = regex.exec(prompt)) !== null) {
        const idx = parseInt(match[1] ?? match[2] ?? match[3], 10);
        if (!seen.has(idx) && idx < allRefMediaIds.length) {
          seen.add(idx);
          indices.push(idx);
        }
      }
      const cleanPrompt = prompt.replace(/\{ref_\d+\}\s*|\[ref_\d+\]\s*|\bref_\d+\b\s*/gi, '').trim();
      return { indices: indices.slice(0, limit), cleanPrompt };
    };

    // Helper: poll a batch of retried jobs until all are DONE/FAILED
    const waitForRetryBatch = async (jobs: { jobId: string; nodeId: string; idx: number }[]) => {
      const pending = new Map(jobs.map(j => [j.jobId, j]));
      const maxWait = 300000; // 5 phút tối đa
      const start = Date.now();

      while (pending.size > 0 && Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 5000)); // poll mỗi 5s
        
        for (const [jobId, job] of Array.from(pending.entries())) {
          try {
            const res = await axios.get(`/api/generate/jobs/${jobId}`);
            const status = res.data.status;
            if (status === 'DONE') {
              const videoUrl = res.data.video_url || res.data.url || '';
              setNodes(nds => nds.map(n => n.id === job.nodeId ? {
                ...n, data: { ...n.data, videoUrl, isGeneratingVideo: false, status: 'done' }
              } : n));
              toast.success(`✅ Video #${job.idx + 1} hoàn thành!`, { id: `vp-gen-${job.idx}` });
              pending.delete(jobId);
            } else if (status === 'FAILED') {
              const errorMsg = res.data.url || 'Lỗi không xác định';
              setNodes(nds => nds.map(n => n.id === job.nodeId ? {
                ...n, data: { ...n.data, isGeneratingVideo: false, status: 'failed', errorMsg }
              } : n));
              toast.error(`❌ Video #${job.idx + 1} render lỗi: ${errorMsg}`, { id: `vp-gen-${job.idx}` });
              pending.delete(jobId);
            }
          } catch (err) {
            // bỏ qua lỗi tạm thời
          }
        }
      }

      // Đánh dấu timeout
      for (const [, job] of pending) {
        setNodes(nds => nds.map(n => n.id === job.nodeId ? {
          ...n, data: { ...n.data, isGeneratingVideo: false, status: 'failed' }
        } : n));
      }
    };

    setNodes(nds => nds.map(n => n.id === videoPromptNodeId ? { ...n, data: { ...n.data, isGeneratingVideo: true } } : n));
    toast.loading(`🔄 Tạo lại ${failedNodes.length} video lỗi...`, { id: 'retry-failed' });

    let retryCount = 0;
    const retryJobs: { jobId: string; nodeId: string; idx: number }[] = [];

    for (const failedNode of failedNodes) {
      if (!failedNode) continue;
      const failedIdx = (failedNode.data.promptIndex as number) || 1;
      const promptLine = videoLines[failedIdx - 1] || videoLines[videoLines.length - 1] || (failedNode.data.prompt as string) || 'animate this';

      try {
        toast.loading(`🔄 Tạo lại video #${failedIdx} (${retryCount + 1}/${failedNodes.length})...`, { id: `retry-${failedIdx}` });

        let res: any;
        let finalPrompt = '';
        let lineModel: string | undefined = undefined;
        let selectedMediaIds: string[] = [];

        if (isR2V) {
          const { indices, cleanPrompt } = parseRefTags(promptLine);
          if (indices.length > 0) {
            selectedMediaIds = indices.map(idx => allRefMediaIds[idx]);
          } else {
            selectedMediaIds = allRefMediaIds.slice(0, limit);
          }
          const parsed = parseModelOverride(cleanPrompt || promptLine, vpVideoModel, vpModelType);
          finalPrompt = parsed.cleanPrompt;
          lineModel = parsed.model;

          const r2vPayload: any = {
            prompt: finalPrompt,
            project_id: settings.flowkitProjectId,
            reference_media_ids: selectedMediaIds,
            entity_ids: upstreamEntities,
            aspect_ratio: videoAspect,
            audio_voice_id: audioVoiceId || undefined,
          };
          if (lineModel) r2vPayload.video_model = lineModel;
          res = await axios.post('/api/generate/r2v', r2vPayload);
        } else {
          // I2V/T2V
          const matchedImage = upstreamImages[failedIdx - 1] || upstreamImages[0];
          const parsed = parseModelOverride(promptLine, vpVideoModel, vpModelType);
          finalPrompt = parsed.cleanPrompt;
          lineModel = parsed.model;

          const retryPayload: any = {
            prompt: finalPrompt,
            project_id: settings.flowkitProjectId,
            start_image_media_id: matchedImage?.mediaId,
            aspect_ratio: videoAspect,
          };
          if (lineModel) retryPayload.video_model = lineModel;
          res = await axios.post('/api/generate/video', retryPayload);
        }

        if (res.data.success && res.data.job_id) {
          const newJobId = res.data.job_id;
          setNodes(nds => nds.map(n => n.id === failedNode.id ? {
            ...n,
            data: {
              ...n.data,
              jobId: newJobId,
              prompt: finalPrompt, // Cập nhật prompt mới lên giao diện Node Video
              status: undefined,
              videoUrl: undefined,
              errorMsg: undefined,
              isGeneratingVideo: true,
              videoModel: lineModel || vpVideoModel,
              audioVoiceId: audioVoiceId || undefined,
              entityIds: upstreamEntities,
              sourceRefMediaIds: selectedMediaIds,
            }
          } : n));
          retryJobs.push({ jobId: newJobId, nodeId: failedNode.id, idx: failedIdx });
          retryCount++;
          toast.success(`✅ Video #${failedIdx} đã bắt đầu tạo lại`, { id: `retry-${failedIdx}` });
        } else {
          toast.error(`❌ Tạo lại video #${failedIdx} thất bại`, { id: `retry-${failedIdx}` });
        }

        if (retryCount < failedNodes.length) {
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (err: any) {
        toast.error(`❌ Lỗi video #${failedIdx}: ${err?.response?.data?.detail || err.message}`, { id: `retry-${failedIdx}` });
      }
    }

    setNodes(nds => nds.map(n => n.id === videoPromptNodeId ? { ...n, data: { ...n.data, isGeneratingVideo: false } } : n));
    toast.success(`🔄 ${retryCount}/${failedNodes.length} video lỗi đã được gửi lại thành công!`, { id: 'retry-failed' });

    // Bắt đầu poll trạng thái background cho các job tạo lại này
    if (retryJobs.length > 0) {
      waitForRetryBatch(retryJobs);
    }
  }, [settings.flowkitProjectId, setNodes, setEdges, clearCacheAndWaitForReady]);

  // Keep ref updated
  useEffect(() => { onGenVideoRef.current = onGenVideo; }, [onGenVideo]);

  // ═══════════════════════════════════════════════════════════════
  // Auto-timeout: Video generating > 8 phút → tự retry (tối đa 1 lần)
  // Veo 3.1 thường mất 4-8 phút, nên chỉ retry khi thực sự stuck
  // ═══════════════════════════════════════════════════════════════
  const VIDEO_TIMEOUT_MS = 8 * 60 * 1000; // 8 phút (tránh retry sớm khi Veo 3.1 đang render)
  const MAX_AUTO_RETRIES = 1; // Chỉ retry 1 lần duy nhất để tránh tạo lặp video

  useEffect(() => {
    const interval = setInterval(async () => {
      const now = Date.now();
      const allNodes = nodesRef.current;

      // Find stuck video nodes (generating > 8 min, no videoUrl, has startedAt)
      const stuckNodes = allNodes.filter(n => {
        if (n.type !== 'video') return false;
        if (!n.data.isGeneratingVideo) return false;
        if (n.data.videoUrl) return false; // Đã có video → skip
        const startedAt = n.data.startedAt as number;
        if (!startedAt) return false;
        const retries = (n.data.autoRetryCount as number) || 0;
        if (retries >= MAX_AUTO_RETRIES) return false; // Đã retry đủ → skip
        if (n.data.jobId) {
          // Nếu đã có jobId → kiểm tra backend trước khi retry
          // Backend poller có thể đang xử lý → không retry sớm
          return false;
        }
        return (now - startedAt) > VIDEO_TIMEOUT_MS;
      });

      if (stuckNodes.length === 0) return;

      for (const stuckNode of stuckNodes) {
        const prompt = (stuckNode.data.prompt as string) || 'animate this';
        const sourceMediaId = stuckNode.data.sourceMediaId as string;
        const sourceVpNodeId = stuckNode.data.sourceVpNodeId as string;
        const aspectRatio = (stuckNode.data.aspectRatio as string) || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
        const promptIndex = (stuckNode.data.promptIndex as number) || 0;
        const retries = (stuckNode.data.autoRetryCount as number) || 0;

        if (!sourceMediaId) continue;

        // Get video model from parent VideoPromptNode
        let vpModel = '';
        let vpModelType = 'i2v';
        if (sourceVpNodeId) {
          const vpNode = allNodes.find(n => n.id === sourceVpNodeId);
          vpModel = (vpNode?.data.videoModel as string) || '';
          vpModelType = (vpNode?.data.videoModelType as string) || 'i2v';
        }
        const timeoutIsR2V = vpModelType === 'r2v';

        toast.loading(`⏰ Video #${promptIndex} timeout (${retries + 1}/${MAX_AUTO_RETRIES})... Tự tạo lại`, { id: `timeout-${stuckNode.id}` });

        try {
          let res: any;
          if (timeoutIsR2V) {
            const savedRefIds = (stuckNode.data.sourceRefMediaIds as string[]) || [sourceMediaId];
            const r2vPayload: any = {
              prompt,
              project_id: settings.flowkitProjectId,
              reference_media_ids: savedRefIds,
              aspect_ratio: aspectRatio,
            };
            if (vpModel) r2vPayload.video_model = vpModel;
            res = await axios.post('/api/generate/r2v', r2vPayload);
          } else {
            const retryPayload: any = {
              prompt,
              project_id: settings.flowkitProjectId,
              start_image_media_id: sourceMediaId,
              aspect_ratio: aspectRatio,
            };
            if (vpModel) retryPayload.video_model = vpModel;
            res = await axios.post('/api/generate/video', retryPayload);
          }

          if (res.data.success && res.data.job_id) {
            // Update the stuck node with new jobId + reset timer
            setNodes(nds => nds.map(n => n.id === stuckNode.id ? {
              ...n,
              data: {
                ...n.data,
                jobId: res.data.job_id,
                startedAt: Date.now(),
                isGeneratingVideo: true,
                videoUrl: undefined,
                status: undefined,
                autoRetryCount: retries + 1,
              }
            } : n));
            toast.success(`🔄 Video #${promptIndex} retry ${retries + 1} started!`, { id: `timeout-${stuckNode.id}` });
          } else {
            // Mark as failed after max retries
            setNodes(nds => nds.map(n => n.id === stuckNode.id ? {
              ...n,
              data: { ...n.data, isGeneratingVideo: false, status: 'failed', autoRetryCount: retries + 1 }
            } : n));
            toast.error(`❌ Video #${promptIndex} retry failed`, { id: `timeout-${stuckNode.id}` });
          }
        } catch (err: any) {
          setNodes(nds => nds.map(n => n.id === stuckNode.id ? {
            ...n,
            data: { ...n.data, isGeneratingVideo: false, status: 'failed', autoRetryCount: retries + 1 }
          } : n));
          toast.error(`❌ Video #${promptIndex}: ${err?.response?.data?.detail || err.message}`, { id: `timeout-${stuckNode.id}` });
        }

        // Wait between retries
        await new Promise(r => setTimeout(r, 5000));
      }
    }, 60000); // Check mỗi 60 giây

    return () => clearInterval(interval);
  }, [settings.flowkitProjectId, setNodes]);

  // Batch: when a video is created from batch
  const onBatchVideoCreated = useCallback((
    batchNodeId: string, 
    jobId: string, 
    prompt: string, 
    extraData?: { 
      videoModel?: string; 
      audioVoiceId?: string; 
      entityIds?: string[]; 
      sourceRefMediaIds?: string[]; 
      referenceUrls?: string[]; 
    }
  ) => {
    const batchNode = nodesRef.current.find(n => n.id === batchNodeId);
    const existingEdges = edgesRef.current.filter(e => e.source === batchNodeId).length;

    const videoNodeId = `bvid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const bx = batchNode?.position?.x || 0;
    const by = batchNode?.position?.y || 0;
    const videoAspect = (batchNode?.data?.videoAspectRatio as string) || 'VIDEO_ASPECT_RATIO_LANDSCAPE';

    setNodes((nds) =>
      nds.concat({
        id: videoNodeId,
        type: 'video',
        position: { x: bx + 380, y: by + existingEdges * 160 },
        style: { width: 240, height: 180 },
        data: { 
          jobId, 
          prompt, 
          isGeneratingVideo: true, 
          promptIndex: parseSceneNumber(prompt, existingEdges + 1),
          aspectRatio: videoAspect,
          videoModel: extraData?.videoModel || undefined,
          audioVoiceId: extraData?.audioVoiceId || undefined,
          entityIds: extraData?.entityIds || [],
          sourceRefMediaIds: extraData?.sourceRefMediaIds || [],
          referenceUrls: extraData?.referenceUrls || [],
        },
      })
    );
    setEdges((eds) =>
      eds.concat({
        id: `e_${batchNodeId}_${videoNodeId}`,
        source: batchNodeId,
        target: videoNodeId,
        animated: true,
        style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
      })
    );
  }, [setNodes, setEdges]);

  // Batch generate images from PromptNode (one per prompt line) + optional inline I2V
  const onBatchGenImage = useCallback(async (nodeId: string, prompts: string[], aspectRatio: string, concurrentParam?: number, skipAutoVideoTrigger?: boolean) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    let refMediaIds = getUpstreamMediaIds(nodeId);

    // R2I: if upstream is ImageUploadNode, upload images to get mediaIds
    if (node.data.useReference && refMediaIds.length === 0) {
      const upstreamEdges = edgesRef.current.filter(e => e.target === nodeId);
      for (const edge of upstreamEdges) {
        const srcNode = nodesRef.current.find(n => n.id === edge.source);
        if (srcNode && srcNode.type === 'imageUpload') {
          const { getImageFiles } = await import('../stores/imageFileStore');
          const files = getImageFiles(srcNode.id);
          if (files.length === 0) {
            toast.error('⚠️ Chưa upload ảnh tham chiếu! Thêm ảnh vào node bên trái');
            return;
          }
          toast.loading(`📤 Uploading ${files.length} ảnh tham chiếu...`, { id: 'r2i-batch-upload' });
          for (const file of files) {
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('project_id', settings.flowkitProjectId || '');
              const res = await axios.post('/api/generate/upload-reference', formData);
              if (res.data.media_id) refMediaIds.push(res.data.media_id);
            } catch (err) {
              console.error('Upload ref failed:', err);
            }
          }
          toast.dismiss('r2i-batch-upload');
          if (refMediaIds.length > 0) {
            toast.success(`✅ ${refMediaIds.length} ảnh tham chiếu uploaded`);
            const waitTimeMs = refMediaIds.length * 2000;
            const steps = Math.ceil(waitTimeMs / 1000);
            for (let s = steps; s > 0; s--) {
              toast.loading(`⏳ Đồng bộ ${refMediaIds.length} ảnh tham chiếu: Còn ${s}s...`, { id: 'r2i-wait' });
              await new Promise(r => setTimeout(r, 1000));
            }
            toast.dismiss('r2i-wait');
            toast.success('✨ Đồng bộ hoàn tất! Bắt đầu tạo ảnh...');
          }
        }
      }
    }

    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingImage: true } } : n));

    const concurrentCount = concurrentParam || (node.data.concurrent as number) || 2;
    const isImageOnlyMode = node.data.imageOnly !== false;
    const upscaleQ = (node.data as any).upscaleQuality as string || '1K';
    let successCount = 0;
    let consecutiveFailures = 0;
    let isCancelled = false;

    // Fire-and-forget: send requests every 3s (image) / 5s (video)
    // Responses are handled asynchronously as they arrive
    const IMG_SPACING = 3000;
    const VID_SPACING = 5000;

    let completedCount = 0;
    const totalPrompts = prompts.length;

    await new Promise<void>((resolve) => {
      // Process a single prompt: gen image → display → gen video → display
      const processPrompt = async (current: number) => {
        // ═══════════════════════════════════════════
        // STEP 1: Generate image (with retry)
        // ═══════════════════════════════════════════
        let imageResult: { url: string; mediaId: string } | null = null;
        let lastErrorMsg = '';

        for (let attempt = 0; attempt < 9; attempt++) {
          if (isCancelled) break;
          if (attempt > 0) {
            toast.loading(`⏳ Thử lại ảnh ${current + 1} lần ${attempt + 1}/9...`, { id: `img-${current}` });
            await new Promise(r => setTimeout(r, 5000));
          }

          try {
            const upstreamChars = getUpstreamCharacterNodes(nodeId);
            const finalPrompt = processPromptReferences(prompts[current], refMediaIds, upstreamChars);

            const res = await axios.post('/api/generate/image', {
              prompt: finalPrompt,
              project_id: settings.flowkitProjectId,
              reference_media_ids: refMediaIds,
              aspect_ratio: aspectRatio,
            });

            if (res.data.success && res.data.url && res.data.media_id) {
              imageResult = { url: res.data.url, mediaId: res.data.media_id };
              break;
            }

            const errorDetail = res.data.error;
            let errorText = "";
            if (typeof errorDetail === 'string') {
              errorText = errorDetail;
            } else if (errorDetail && typeof errorDetail === 'object') {
              const errObj = errorDetail.data?.error || errorDetail.error || errorDetail;
              errorText = errObj.message || JSON.stringify(errObj);
            }

            if (isOverloadMsg(errorText)) {
              toast.loading(`⏳ Quá tải. Chờ 30s...`, { id: `img-${current}` });
              await new Promise(r => setTimeout(r, 30000));
              continue;
            }

            lastErrorMsg = errorText || 'No image URL returned';
          } catch (err: any) {
            const errorText = err?.response?.data?.detail || err.message || '';
            if (isOverloadMsg(errorText) || err?.response?.status === 429 || err?.response?.status === 503) {
              toast.loading(`⏳ Quá tải. Chờ 30s...`, { id: `img-${current}` });
              await new Promise(r => setTimeout(r, 30000));
              continue;
            }
            lastErrorMsg = errorText;
          }
        }

        if (!imageResult) {
          consecutiveFailures++;
          toast.error(`❌ Ảnh ${current + 1} lỗi: ${lastErrorMsg.slice(0, 60)}`, { id: `img-${current}` });
          if (consecutiveFailures >= 3) {
            isCancelled = true;
            toast.error('❌ Dừng do 3 lỗi liên tiếp!');
          }
          completedCount++;
          if (completedCount >= totalPrompts || isCancelled) resolve();
          return;
        }

        // Image success
        consecutiveFailures = 0;
        let finalUrl = imageResult.url;
        let finalMediaId = imageResult.mediaId;

        // ═══════════════════════════════════════════
        // STEP 2: Upscale image (if selected)
        // ═══════════════════════════════════════════
        if (upscaleQ && upscaleQ !== '1K' && finalMediaId) {
          try {
            toast.loading(`📈 Upscale ảnh ${current + 1} → ${upscaleQ}...`, { id: `img-${current}` });
            const upRes = await axios.post('/api/generate/upscale-image', {
              media_id: finalMediaId,
              project_id: settings.flowkitProjectId,
              quality: upscaleQ,
            });
            if (upRes.data?.success && upRes.data?.url) {
              finalUrl = upRes.data.url;
              if (upRes.data.media_id) finalMediaId = upRes.data.media_id;
              toast.success(`✅ Ảnh ${current + 1} upscale ${upscaleQ} xong`, { id: `img-${current}` });
            } else {
              toast.dismiss(`img-${current}`);
            }
          } catch (upErr) {
            console.error('Upscale image error:', upErr);
            toast.dismiss(`img-${current}`);
          }
        }

        // ═══════════════════════════════════════════
        // STEP 3: Display image node on canvas
        // ═══════════════════════════════════════════
        const imageNodeId = `img_${Date.now()}_${current}`;
        const nx = (node.position?.x || 0) + 320 + current * 260;
        const ny = (node.position?.y || 0) + 40;
        const vPrompts = ((node.data as any).videoPrompts as string[][] | undefined)?.[current] || [prompts[current]];

        setNodes((nds) =>
          nds.concat({
            id: imageNodeId,
            type: 'image',
            position: { x: nx, y: ny },
            style: nodeSize(aspectRatio),
            data: {
              imageUrl: finalUrl,
              mediaId: finalMediaId,
              prompt: prompts[current],
              videoPrompts: vPrompts,
              aspectRatio,
              isGeneratingVideo: false,
              promptIndex: parseSceneNumber(prompts[current], current + 1),
            },
          })
        );
        setEdges((eds) => eds.concat({
          id: `e_${nodeId}_${imageNodeId}`,
          source: nodeId,
          target: imageNodeId,
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
        }));
        successCount++;
        toast.success(`✅ Ảnh ${current + 1}/${totalPrompts} xong`, { id: `img-${current}` });



        // ═══════════════════════════════════════════
        // STEP 4: Generate video (if NOT image-only mode)
        // ═══════════════════════════════════════════
        if (!isImageOnlyMode) {
          const videoPrompt = Array.isArray(vPrompts) && vPrompts.length > 0
            ? vPrompts[0]
            : (prompts[current] || 'animate this');
          const videoAspect = aspectRatio ? aspectRatio.replace('IMAGE_', 'VIDEO_') : 'VIDEO_ASPECT_RATIO_LANDSCAPE';

          toast.loading(`🎬 Video ${current + 1}...`, { id: `vid-${current}` });

          let videoJobId = '';
          for (let vAttempt = 0; vAttempt < 9; vAttempt++) {
            if (isCancelled) break;
            if (vAttempt > 0) {
              toast.loading(`⏳ Thử lại video ${current + 1} lần ${vAttempt + 1}/9...`, { id: `vid-${current}` });
              await new Promise(r => setTimeout(r, 5000));
            }
            try {
              const res = await axios.post('/api/generate/video', {
                prompt: videoPrompt,
                project_id: settings.flowkitProjectId,
                start_image_media_id: finalMediaId,
                aspect_ratio: videoAspect,
              });
              if (res.data.success && res.data.job_id) {
                videoJobId = res.data.job_id;
                break;
              }
              const errDetail = res.data.error;
              let errText = typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail || '');
              if (isOverloadMsg(errText)) {
                toast.loading(`⏳ Quá tải. Chờ 30s...`, { id: `vid-${current}` });
                await new Promise(r => setTimeout(r, 30000));
                continue;
              }
            } catch (err: any) {
              const errText = err?.response?.data?.detail || err.message || '';
              if (isOverloadMsg(errText) || err?.response?.status === 429 || err?.response?.status === 503) {
                toast.loading(`⏳ Quá tải. Chờ 30s...`, { id: `vid-${current}` });
                await new Promise(r => setTimeout(r, 30000));
                continue;
              }
            }
          }

          if (videoJobId) {
            const videoNodeId = `vid_${Date.now()}_${current}`;
            setNodes((nds) =>
              nds.concat({
                id: videoNodeId,
                type: 'video',
                position: { x: nx + 340, y: ny },
                style: { width: 240, height: 180 },
                data: {
                  jobId: videoJobId,
                  prompt: videoPrompt,
                  frameUrl: finalUrl,
                  aspectRatio: videoAspect,
                  isGeneratingVideo: true,
                  promptIndex: parseSceneNumber(prompts[current], current + 1),
                },
              })
            );
            setEdges((eds) => eds.concat({
              id: `e_${imageNodeId}_${videoNodeId}`,
              source: imageNodeId,
              target: videoNodeId,
              animated: true,
              style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
            }));

            toast.loading(`⏳ Video ${current + 1} render...`, { id: `vid-${current}` });
            const vStatus = await waitForJob(videoJobId, `Video ${current + 1}`);
            if (vStatus === 'DONE') {
              toast.success(`✅ Video ${current + 1} hoàn thành!`, { id: `vid-${current}` });
            } else {
              toast.error(`❌ Video ${current + 1} thất bại!`, { id: `vid-${current}` });
            }
          } else {
            toast.error(`❌ Video ${current + 1} gửi thất bại!`, { id: `vid-${current}` });
          }
        }

        // Done with this prompt
        completedCount++;
        if (completedCount >= totalPrompts || isCancelled) resolve();
      };

      // ═══════════════════════════════════════════
      // SENDER: fire 1 request every spacing, all run in parallel
      // Image-only: 3s spacing | Image+Video: 5s spacing
      // Limit active concurrent requests to concurrentCount
      // ═══════════════════════════════════════════
      const spacing = isImageOnlyMode ? IMG_SPACING : VID_SPACING;

      let launched = 0;
      let activeCount = 0;

      const sendNext = () => {
        if (isCancelled || launched >= totalPrompts) return;

        // Concurrency control: if activeCount is at limit, check again later
        if (activeCount >= concurrentCount) {
          setTimeout(sendNext, 500);
          return;
        }

        const promptIdx = launched++;
        activeCount++;
        toast.loading(`🎨 Ảnh ${promptIdx + 1}/${totalPrompts}...`, { id: `img-${promptIdx}` });
        
        // Fire async — decrement activeCount when completed
        processPrompt(promptIdx).finally(() => {
          activeCount--;
        });

        // Schedule next request after spacing
        if (launched < totalPrompts && !isCancelled) {
          setTimeout(sendNext, spacing);
        }
      };

      sendNext();
    });

    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingImage: false } } : n));

    if (isCancelled) {
      toast.error(`🛑 Đã dừng Batch do lỗi liên tiếp.`);
      return;
    }

    toast.success(`🎉 Batch xong! ${successCount}/${prompts.length} ảnh${!isImageOnlyMode ? ' + video' : ''}`);

    if (!isCancelled && successCount > 0) {
      // Find downstream VideoPromptNodes
      let downstreamVPNodes = edgesRef.current
        .filter(e => e.source === nodeId)
        .map(e => nodesRef.current.find(n => n.id === e.target))
        .filter(n => n && n.type === 'videoPrompt') as any[];

      if (downstreamVPNodes.length === 0) {
        const downstreamCollectors = edgesRef.current
          .filter(e => e.source === nodeId)
          .map(e => nodesRef.current.find(n => n.id === e.target))
          .filter(n => n && n.type === 'imageCollector');
        
        for (const coll of downstreamCollectors) {
          if (!coll) continue;
          const collDownEdges = edgesRef.current.filter(e => e.source === coll.id);
          const vpNodes = collDownEdges
            .map(e => nodesRef.current.find(n => n.id === e.target))
            .filter(n => n && n.type === 'videoPrompt') as any[];
          if (vpNodes.length > 0) {
            downstreamVPNodes.push(...vpNodes);
          }
        }
      }

      if (!skipAutoVideoTrigger && downstreamVPNodes.length > 0) {
        const vpNode = downstreamVPNodes[0]!;
        toast.loading(`🎬 Bắt đầu tạo video tự động từ ${vpNode.data.label || 'VideoPromptNode'}...`, { id: 'auto-vp-trigger' });
        try {
          await onGenVideoFromVideoPrompt(vpNode.id);
          toast.success('🎉 Đã kích hoạt tạo video downstream thành công!', { id: 'auto-vp-trigger' });
        } catch (err: any) {
          toast.error(`❌ Lỗi tạo video tự động: ${err.message}`, { id: 'auto-vp-trigger' });
        }
      }
    }
  }, [settings.flowkitProjectId, getUpstreamMediaIds, setNodes, setEdges, isOverloadMsg, waitForJob, onGenVideoFromVideoPrompt]);


  // ─── Regen Image: re-generate using same prompt/refs ───
  const onRegenImage = useCallback(async (imageNodeId: string) => {
    const imgNode = nodesRef.current.find(n => n.id === imageNodeId);
    if (!imgNode) return;
    const prompt = imgNode.data.prompt as string;
    const aspectRatio = (imgNode.data.aspectRatio as string) || 'IMAGE_ASPECT_RATIO_LANDSCAPE';
    if (!prompt) { toast.error('Không có prompt để tạo lại'); return; }

    // Find upstream prompt node to get refs
    const upEdge = edgesRef.current.find(e => e.target === imageNodeId);
    const promptNodeId = upEdge?.source;
    let refMediaIds: string[] = [];
    if (promptNodeId) {
      refMediaIds = getUpstreamMediaIds(promptNodeId);
      // Also check ImageUploadNode refs
      const promptNode = nodesRef.current.find(n => n.id === promptNodeId);
      if (promptNode?.data.useReference && refMediaIds.length === 0) {
        const upEdges2 = edgesRef.current.filter(e => e.target === promptNodeId);
        for (const edge of upEdges2) {
          const srcNode = nodesRef.current.find(n => n.id === edge.source);
          if (srcNode && srcNode.type === 'imageUpload') {
            const { getImageFiles } = await import('../stores/imageFileStore');
            const files = getImageFiles(srcNode.id);
            for (const file of files) {
              try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('project_id', settings.flowkitProjectId || '');
                const res = await axios.post('/api/generate/upload-reference', formData);
                if (res.data.media_id) refMediaIds.push(res.data.media_id);
              } catch {}
            }
            if (refMediaIds.length > 0) {
              toast.success(`✅ ${refMediaIds.length} ảnh tham chiếu uploaded`);
              // Dynamic waiting delay to check and synchronize reference images (avoiding missing refs)
              const waitTimeMs = refMediaIds.length * 2000;
              const steps = Math.ceil(waitTimeMs / 1000);
              for (let s = steps; s > 0; s--) {
                toast.loading(`⏳ Đang đồng bộ hóa & kiểm tra ${refMediaIds.length} ảnh tham chiếu (tránh sót): Còn ${s} giây...`, { id: 'r2i-wait' });
                await new Promise(r => setTimeout(r, 1000));
              }
              toast.dismiss('r2i-wait');
              toast.success('✨ Đồng bộ hóa hoàn tất! Bắt đầu tạo ảnh...');
            }
          }
        }
      }
    }

    setNodes(nds => nds.map(n => n.id === imageNodeId ? { ...n, data: { ...n.data, isRegenerating: true, status: 'processing' } } : n));
    toast.loading('🔄 Tạo lại ảnh...', { id: 'regen-img' });

    try {
      const upstreamChars = promptNodeId ? getUpstreamCharacterNodes(promptNodeId) : [];
      const finalPrompt = processPromptReferences(prompt, refMediaIds, upstreamChars);

      const res = await axios.post('/api/generate/image', {
        prompt: finalPrompt,
        project_id: settings.flowkitProjectId,
        reference_media_ids: refMediaIds,
        aspect_ratio: aspectRatio,
      });

      if (!res.data.success || !res.data.url) {
        const apiError = res.data.error;
        let errorText = "No image URL returned";
        if (typeof apiError === 'string') {
          errorText = apiError;
        } else if (apiError && typeof apiError === 'object') {
          const errObj = apiError.data?.error || apiError.error || apiError;
          errorText = errObj.message || errObj.error || JSON.stringify(errObj);
        }
        throw new Error(errorText);
      }

      const imageUrl = res.data.url;
      const mediaId = res.data.media_id;

      setNodes(nds => nds.map(n => n.id === imageNodeId
        ? { ...n, data: { ...n.data, imageUrl, mediaId, isRegenerating: false, status: undefined } }
        : n
      ));
      toast.dismiss('regen-img');
      toast.success('✅ Ảnh mới đã tạo!');
    } catch (err: any) {
      toast.dismiss('regen-img');
      toast.error('Tạo lại ảnh lỗi: ' + (err?.response?.data?.detail || err.message));
      setNodes(nds => nds.map(n => n.id === imageNodeId ? { ...n, data: { ...n.data, isRegenerating: false, status: 'failed' } } : n));
    }
  }, [settings.flowkitProjectId, getUpstreamMediaIds, setNodes, getUpstreamCharacterNodes, processPromptReferences]);

  // ─── Regen Video: re-generate in-place using same prompt/aspectRatio ───
  const onRegenVideo = useCallback(async (videoNodeId: string) => {
    const vidNode = nodesRef.current.find(n => n.id === videoNodeId);
    if (!vidNode) {
      toast.error('Không tìm thấy video node');
      return;
    }

    const prompt = (vidNode.data.prompt as string) || '';
    const videoAspect = (vidNode.data.aspectRatio as string) || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
    const videoModel = (vidNode.data.videoModel as string) || undefined;
    const audioVoiceId = (vidNode.data.audioVoiceId as string) || undefined;
    const entityIds = (vidNode.data.entityIds as string[]) || [];
    const sourceRefMediaIds = (vidNode.data.sourceRefMediaIds as string[]) || [];

    const isR2V = sourceRefMediaIds.length > 0 || entityIds.length > 0;

    // Find upstream source image if any (for I2V fallback)
    let startImageMediaId: string | null = null;
    const upEdge = edgesRef.current.find(e => e.target === videoNodeId);
    if (upEdge) {
      const sourceImgNode = nodesRef.current.find(n => n.id === upEdge.source);
      if (sourceImgNode && sourceImgNode.data.mediaId) {
        startImageMediaId = sourceImgNode.data.mediaId as string;
      }
    }

    // Set node state to processing
    setNodes(nds => nds.map(n => n.id === videoNodeId ? {
      ...n,
      data: {
        ...n.data,
        isGeneratingVideo: true,
        videoUrl: undefined,
        status: 'processing',
        jobId: undefined, // Clear old jobId to trigger polling loop
      }
    } : n));

    toast.loading('🔄 Tạo lại video...', { id: 'regen-vid' });

    try {
      let res: any;
      if (isR2V) {
        const payload: any = {
          prompt,
          project_id: settings.flowkitProjectId,
          reference_media_ids: sourceRefMediaIds,
          entity_ids: entityIds,
          aspect_ratio: videoAspect,
          audio_voice_id: audioVoiceId,
        };
        if (videoModel) payload.video_model = videoModel;
        res = await axios.post('/api/generate/r2v', payload);
      } else {
        const payload: any = {
          prompt,
          project_id: settings.flowkitProjectId,
          start_image_media_id: startImageMediaId,
          aspect_ratio: videoAspect,
        };
        if (videoModel) payload.video_model = videoModel;
        res = await axios.post('/api/generate/video', payload);
      }

      if (!res.data.success || !res.data.job_id) {
        const apiError = res.data.error;
        let errorText = "Video generation failed";
        if (typeof apiError === 'string') {
          errorText = apiError;
        } else if (apiError && typeof apiError === 'object') {
          const errObj = apiError.data?.error || apiError.error || apiError;
          errorText = errObj.message || errObj.error || JSON.stringify(errObj);
        }
        throw new Error(errorText);
      }

      const jobId = res.data.job_id;

      // Update node with new jobId
      setNodes(nds => nds.map(n => n.id === videoNodeId ? {
        ...n,
        data: {
          ...n.data,
          jobId,
          isGeneratingVideo: true,
          status: 'processing',
        }
      } : n));

      toast.dismiss('regen-vid');
      toast.success('✅ Video generation started!');
    } catch (err: any) {
      toast.dismiss('regen-vid');
      const detail = err?.response?.data?.detail;
      const errMsg = typeof detail === 'object' ? JSON.stringify(detail) : (detail || err.message);
      toast.error('Tạo lại video lỗi: ' + errMsg);
      setNodes(nds => nds.map(n => n.id === videoNodeId ? {
        ...n,
        data: {
          ...n.data,
          isGeneratingVideo: false,
          status: 'failed',
        }
      } : n));
    }
  }, [settings.flowkitProjectId, setNodes]);

  // ─── Upscale Video: call upscale endpoint, poll for completion ───
  const onUpscaleVideo = useCallback(async (videoNodeId: string, resolution: '1080p' | '4K') => {
    const vidNode = nodesRef.current.find(n => n.id === videoNodeId);
    if (!vidNode) { toast.error('Không tìm thấy video node'); return; }

    // Try to get media_id from node data, or fetch from jobs using jobId
    let mediaId = vidNode.data.mediaId as string;
    const nodeJobId = vidNode.data.jobId as string;
    const nodeAspectRatio = (vidNode.data.aspectRatio as string) || '';

    if (!mediaId && nodeJobId) {
      try {
        const jobsRes = await axios.get('/api/generate/jobs');
        const job = (jobsRes.data?.jobs || []).find((j: any) => j.id === nodeJobId);
        if (job?.media_id) {
          mediaId = job.media_id;
          // Save it to node for future use
          setNodes(nds => nds.map(n => n.id === videoNodeId ? { ...n, data: { ...n.data, mediaId } } : n));
        }
      } catch {}
    }

    if (!mediaId) {
      toast.error('Không tìm thấy media_id cho video này');
      return;
    }

    toast.loading(`⬆️ Đang upscale video lên ${resolution}...`, { id: `upscale-vid-${videoNodeId}` });

    try {
      // Start upscale
      await axios.post('/api/generate/upscale-video', {
        media_id: mediaId,
        project_id: settings.flowkitProjectId,
        resolution,
        aspect_ratio: nodeAspectRatio,
      });

      // Poll for completion
      const startTime = Date.now();
      const timeout = 300000; // 5 min timeout
      while (Date.now() - startTime < timeout) {
        await new Promise(r => setTimeout(r, 5000));
        try {
          const statusRes = await axios.post('/api/generate/upscale-video/status', {
            media_id: mediaId,
            project_id: settings.flowkitProjectId,
            resolution,
          });
          const st = statusRes.data;
          if (st.status === 'done' && (st.url || st.local_file)) {
            const newUrl = st.url || st.local_file;
            setNodes(nds => nds.map(n => n.id === videoNodeId
              ? { ...n, data: { ...n.data, videoUrl: newUrl } }
              : n
            ));
            toast.success(`✅ Upscale video ${resolution} hoàn thành!`, { id: `upscale-vid-${videoNodeId}` });
            return;
          } else if (st.status === 'failed') {
            toast.error(`❌ Upscale video thất bại`, { id: `upscale-vid-${videoNodeId}` });
            return;
          }
          toast.loading(`⬆️ Đang upscale video lên ${resolution}...`, { id: `upscale-vid-${videoNodeId}` });
        } catch {}
      }
      toast.error(`⏱️ Upscale video timeout`, { id: `upscale-vid-${videoNodeId}` });
    } catch (err: any) {
      toast.error(`Upscale video lỗi: ${err?.response?.data?.detail || err.message}`, { id: `upscale-vid-${videoNodeId}` });
    }
  }, [settings.flowkitProjectId, setNodes]);

  // ─── Upscale Image: call upscale endpoint (synchronous response) ───
  const onUpscaleImage = useCallback(async (imageNodeId: string, quality: '2K' | '4K') => {
    const imgNode = nodesRef.current.find(n => n.id === imageNodeId);
    if (!imgNode) { toast.error('Không tìm thấy image node'); return; }

    const mediaId = imgNode.data.mediaId as string;
    if (!mediaId) {
      toast.error('Không tìm thấy media_id cho ảnh này');
      return;
    }

    toast.loading(`⬆️ Đang upscale ảnh lên ${quality}...`, { id: `upscale-img-${imageNodeId}` });

    try {
      const res = await axios.post('/api/generate/upscale-image', {
        media_id: mediaId,
        project_id: settings.flowkitProjectId,
        quality,
      });

      if (res.data.success && (res.data.url || res.data.local_file)) {
        const newUrl = res.data.url || res.data.local_file;
        setNodes(nds => nds.map(n => n.id === imageNodeId
          ? { ...n, data: { ...n.data, imageUrl: newUrl } }
          : n
        ));
        toast.success(`✅ Upscale ảnh ${quality} hoàn thành!`, { id: `upscale-img-${imageNodeId}` });
      } else {
        toast.error(`❌ Upscale ảnh thất bại`, { id: `upscale-img-${imageNodeId}` });
      }
    } catch (err: any) {
      toast.error(`Upscale ảnh lỗi: ${err?.response?.data?.detail || err.message}`, { id: `upscale-img-${imageNodeId}` });
    }
  }, [settings.flowkitProjectId, setNodes]);

  // ─── Batch Gen Video from all ImageNodes that have no video yet ───
  const onBatchGenVideoFromImages = useCallback(async () => {
    const imageNodes = nodesRef.current.filter(n => {
      if (n.type !== 'image' || !n.data.mediaId) return false;
      // Exclude reference images (characters, backgrounds, props)
      if (n.data.isReference === true) return false;
      const label = (n.data.label as string) || '';
      if (label.startsWith('👤') || label.startsWith('🏞️') || label.startsWith('🎭')) {
        return false;
      }
      // Exclude design/reference prompts (from Batch T2I character design)
      const prompt = (n.data.prompt as string) || '';
      const isDesignPrompt = /\bchar[_\s]?[a-z0-9]/i.test(prompt)
        || /\b(character\s+design|design\s+sheet|reference\s+sheet|model\s+sheet)\b/i.test(prompt)
        || /\b(bg[_\s]?[a-z0-9]|background\s+design|environment\s+design)\b/i.test(prompt)
        || /\b(prop[_\s]?[a-z0-9]|prop\s+design)\b/i.test(prompt);
      if (isDesignPrompt) return false;
      return true;
    });
    // Find image nodes that don't have a video edge going out
    const imgWithVideo = new Set(
      edgesRef.current
        .filter(e => {
          const targetNode = nodesRef.current.find(n => n.id === e.target);
          return targetNode?.type === 'video';
        })
        .map(e => e.source)
    );
    const imgWithoutVideo = imageNodes.filter(n => !imgWithVideo.has(n.id));

    if (imgWithoutVideo.length === 0) {
      toast.error('Tất cả ảnh đã có video!');
      return;
    }

    toast.loading(`🎬 Tạo video lần lượt cho ${imgWithoutVideo.length} ảnh...`, { id: 'batch-vid-gen' });
    
    let consecutiveFailures = 0;
    let isCancelled = false;

    for (let vi = 0; vi < imgWithoutVideo.length; vi++) {
      if (isCancelled) break;
      const imgNode = imgWithoutVideo[vi];
      toast.loading(`🎬 Video ${vi + 1}/${imgWithoutVideo.length} đang tạo...`, { id: 'batch-vid-gen' });

      // Parallel coordination: space starting of requests
      if (lastCompletionTimeRef.current > 0) {
        const elapsed = Date.now() - lastCompletionTimeRef.current;
        if (elapsed < 15000) {
          await new Promise(r => setTimeout(r, 15000 - elapsed));
        }
      }

      let jobId = '';
      let attempt = 0;
      const maxAttempts = 9;

      while (attempt < maxAttempts) {
        if (isCancelled) break;
        if (attempt > 0) {
          toast.loading(`⏳ Thử lại video ${vi + 1} lần ${attempt + 1}/9 (chờ 10s)...`, { id: 'batch-vid-gen' });
          await new Promise(r => setTimeout(r, 10000));
        }

        try {
          const imgData = imgNode.data as any;
          const imgAspect = (imgData.aspectRatio as string) || '';
          const videoAspect = imgAspect ? imgAspect.replace('IMAGE_', 'VIDEO_') : 'VIDEO_ASPECT_RATIO_LANDSCAPE';
          
          const vPrompts = imgData.videoPrompts || [];
          const videoPrompt = (Array.isArray(vPrompts) && vPrompts.length > 0)
            ? vPrompts[0]
            : (imgData.prompt || 'animate this');

          // Auto-detect R2V vs I2V based on whether image has reference media IDs
          const refIds = imgData.refMediaIds as string[] | undefined;
          const useR2V = refIds && refIds.length > 0;
          
          let res;
          if (useR2V) {
            // R2V: use reference images (max 3 for R2V)
            const r2vRefs = refIds.slice(0, 3);
            console.log(`[BatchGenVideo] Using R2V with ${r2vRefs.length} refs for scene ${vi + 1}`);
            res = await axios.post('/api/generate/r2v', {
              prompt: videoPrompt,
              project_id: settings.flowkitProjectId,
              reference_media_ids: r2vRefs,
              aspect_ratio: videoAspect,
            });
          } else {
            // I2V: use scene image as start frame
            console.log(`[BatchGenVideo] Using I2V for scene ${vi + 1}`);
            res = await axios.post('/api/generate/video', {
              prompt: videoPrompt,
              project_id: settings.flowkitProjectId,
              start_image_media_id: imgData.mediaId,
              aspect_ratio: videoAspect,
            });
          }

          if (res.data.success && res.data.job_id) {
            jobId = res.data.job_id;
            break;
          }

          const errorDetail = res.data.error;
          let errorText = "";
          if (typeof errorDetail === 'string') {
            errorText = errorDetail;
          } else if (errorDetail && typeof errorDetail === 'object') {
            const errObj = errorDetail.data?.error || errorDetail.error || errorDetail;
            errorText = errObj.message || JSON.stringify(errObj);
          }

          if (isOverloadMsg(errorText)) {
            toast.loading(`⏳ Quá tải hệ thống (Resource exhausted). Đang poll chờ 30s để gửi lại...`, { id: 'batch-vid-gen' });
            await new Promise(r => setTimeout(r, 30000));
            continue; // Retry without incrementing attempt
          }
          attempt++;
        } catch (err: any) {
          const errorText = err?.response?.data?.detail || err.message || '';
          if (isOverloadMsg(errorText) || err?.response?.status === 429 || err?.response?.status === 503) {
            toast.loading(`⏳ Quá tải hệ thống (Resource exhausted). Đang poll chờ 30s để gửi lại...`, { id: 'batch-vid-gen' });
            await new Promise(r => setTimeout(r, 30000));
            continue; // Retry without incrementing attempt
          }
          attempt++;
        }
      }

      lastCompletionTimeRef.current = Date.now();

      if (jobId) {
        const videoNodeId = `vid_${Date.now()}_${vi}`;
        const imgData = imgNode.data as any;
        
        const vPrompts = imgData.videoPrompts || [];
        const videoPrompt = (Array.isArray(vPrompts) && vPrompts.length > 0)
          ? vPrompts[0]
          : (imgData.prompt || 'animate this');

        setNodes((nds) =>
          nds.concat({
            id: videoNodeId,
            type: 'video',
            position: { x: imgNode.position.x + 340, y: imgNode.position.y },
            style: { width: 240, height: 180 },
            data: { jobId, prompt: videoPrompt, frameUrl: imgData.imageUrl, aspectRatio: imgData.aspectRatio?.replace('IMAGE_', 'VIDEO_'), isGeneratingVideo: true, promptIndex: imgData.promptIndex || parseSceneNumber(imgData.prompt || '', vi + 1) },
          })
        );
        setEdges((eds) => eds.concat({
          id: `e_${imgNode.id}_${videoNodeId}`,
          source: imgNode.id,
          target: videoNodeId,
          animated: true,
          style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
        }));

        const status = await waitForJob(jobId, `Video ${vi + 1}`);
        lastCompletionTimeRef.current = Date.now();

        if (status === 'DONE') {
          consecutiveFailures = 0;
          toast.success(`✅ Video ${vi + 1} hoàn thành!`);
          await new Promise(r => setTimeout(r, 5000)); // rest 5s
        } else {
          consecutiveFailures++;
          toast.error(`❌ Video ${vi + 1} render thất bại!`);
          if (consecutiveFailures >= 3) {
            isCancelled = true;
            toast.error('❌ Dừng tạo video do 3 video liên tiếp thất bại!');
          }
          await new Promise(r => setTimeout(r, 15000)); // rest 15s
        }
      } else {
        consecutiveFailures++;
        toast.error(`❌ Video ${vi + 1} gửi thất bại sau 9 lần thử!`);
        if (consecutiveFailures >= 3) {
          isCancelled = true;
          toast.error('❌ Dừng tạo video do 3 video liên tiếp thất bại!');
        }
        await new Promise(r => setTimeout(r, 15000)); // rest 15s
      }
    }
    toast.dismiss('batch-vid-gen');
    if (!isCancelled) {
      toast.success(`✅ Đã hoàn thành tất cả video!`);
    }
  }, [settings.flowkitProjectId, setNodes, setEdges, waitForJob, isOverloadMsg]);

  // Get names of created characters (for AgentPanel)
  const getCharacterNames = useCallback((): string[] => {
    return Object.values(charEntityIdsRef.current)
      .filter((e: any) => e.entityId)
      .map((e: any) => e.name);
  }, []);

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

    const isI2V = fallbackMode === 'i2v' || fallbackMode === 'image-to-video';

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
      // Determine standard Lite Low priority default model based on fallbackMode
      let base = 'veo_3_1_t2v_lite';
      if (fallbackMode === 'i2v') {
        base = 'veo_3_1_i2v_lite';
      }
      return targetDuration === '8s' ? `${base}_low_priority` : `${base}_${targetDuration}_low_priority`;
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

  // Fill prompts into BatchNode (from AgentPanel) — auto-create if needed
  // Model mapping: agent sends "pro"/"ultra"/"lite"/"omni_10s" → we map to actual model IDs
  const MODEL_MAP: Record<string, Record<string, string>> = {
    t2v: { ultra: 'veo_3_1_t2v_fast_ultra', pro: 'veo_3_1_t2v_fast', lite: 'veo_3_1_t2v_lite_low_priority', lite_4s: 'veo_3_1_t2v_lite_4s_low_priority', lite_6s: 'veo_3_1_t2v_lite_6s_low_priority', omni_10s: 'abra_t2v_10s' },
    i2v: { ultra: 'veo_3_1_i2v_s_fast_ultra', pro: 'veo_3_1_i2v_s_fast', lite: 'veo_3_1_i2v_lite_low_priority', lite_4s: 'veo_3_1_i2v_s_lite_4s_low_priority', lite_6s: 'veo_3_1_i2v_s_lite_6s_low_priority', omni_10s: 'abra_i2v_10s' },
    r2v: { ultra: 'veo_3_1_r2v_fast_landscape_ultra', pro: 'veo_3_1_r2v_fast_landscape', lite: 'veo_3_1_r2v_lite_low_priority', lite_4s: 'veo_3_1_r2v_lite_4s_low_priority', lite_6s: 'veo_3_1_r2v_lite_6s_low_priority', omni_10s: 'abra_r2v_10s' },
  };
  const ASPECT_MAP: Record<string, string> = {
    '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE',
    '9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT',
    '1:1': 'VIDEO_ASPECT_RATIO_SQUARE',
  };
  const IMG_ASPECT_MAP: Record<string, string> = {
    '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
    '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
    '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
  };

  // Helper: calculate image node size based on aspect ratio
  const nodeSize = (aspect?: string) => {
    if (aspect?.includes('PORTRAIT') || aspect === '9:16') return { width: 150, height: 260 };
    if (aspect?.includes('SQUARE') || aspect === '1:1') return { width: 200, height: 200 };
    return { width: 260, height: 150 }; // landscape default
  };

  const fillBatchPrompts = useCallback((prompts: string[], mode: string = 't2v', autoExecute: boolean = false, modelTier?: string, aspectRatio?: string) => {
    let batchNode = nodesRef.current.find(n => n.type === 'batch');

    const resolvedModel = MODEL_MAP[mode]?.[modelTier || 'pro'] || MODEL_MAP[mode]?.pro;
    const resolvedAspect = ASPECT_MAP[aspectRatio || '16:9'] || 'VIDEO_ASPECT_RATIO_LANDSCAPE';

    // Auto-create BatchNode if none exists
    if (!batchNode) {
      const id = `batch-${Date.now()}`;
      const newNode = {
        id,
        type: 'batch' as const,
        position: { x: 400, y: 200 },
        data: {
          label: 'Batch Video',
          mode,
          agentPrompts: prompts,
          agentAutoExecute: autoExecute,
          agentModel: resolvedModel,
          agentAspect: resolvedAspect,
        },
      };
      setNodes(nds => [...nds, newNode]);
      toast.success(`BatchNode [${(modelTier || 'pro').toUpperCase()}|${aspectRatio || '16:9'}] + ${prompts.length} prompt`);
      return;
    }

    // Update existing BatchNode
    setNodes(nds => nds.map(n =>
      n.id === batchNode!.id
        ? { ...n, data: { ...n.data, mode, agentPrompts: prompts, agentAutoExecute: autoExecute, agentModel: resolvedModel, agentAspect: resolvedAspect } }
        : n
    ));
    toast.success(`${prompts.length} prompt [${(modelTier || 'pro').toUpperCase()}|${aspectRatio || '16:9'}]${autoExecute ? ' — chạy...' : ''}`);
  }, [setNodes]);

  // Clear all nodes
  const clearAll = useCallback(() => {
    setNodes([]);
    setEdges([]);
  }, [setNodes, setEdges]);

  // Helper to hydrate raw nodes when loaded from JSON or preset
  const hydrateNodes = useCallback((rawNodes: Node[]) => {
    return rawNodes.map(n => {
      if (n.type === 'batch') {
        return {
          ...n,
          data: {
            ...n.data,
            getUpstreamCharacters,
            getUpstreamEntityIds,
            getUpstreamCharacterEntities,
            getUpstreamImageMediaId,
            getUpstreamImageUploadNodeId,
            getUpstreamCharacterDetails,
          },
        };
      }
      if (n.type === 'character') {
        if ((n.data as any).entityId) {
          charEntityIdsRef.current[n.id] = {
            name: (n.data as any).charName || 'Character',
            entityId: (n.data as any).entityId,
          };
        }
        return {
          ...n,
          data: {
            ...n.data,
            onMediaIdsChange: onCharMediaIdsChange,
            onEntityIdChange: onCharEntityIdChange,
          },
        };
      }
      return n;
    });
  }, [
    getUpstreamCharacters,
    getUpstreamEntityIds,
    getUpstreamCharacterEntities,
    getUpstreamImageMediaId,
    getUpstreamImageUploadNodeId,
    getUpstreamCharacterDetails,
    onCharMediaIdsChange,
    onCharEntityIdChange,
  ]);

  // Export current workflow as JSON file
  const exportWorkflow = useCallback(() => {
    try {
      const serializableNodes = nodesRef.current.map(n => ({
        ...n,
        data: Object.fromEntries(
          Object.entries(n.data).filter(([, v]) => typeof v !== 'function')
        ),
      }));
      const workflowData = {
        version: '1.0',
        timestamp: Date.now(),
        nodes: serializableNodes,
        edges: edgesRef.current,
      };
      const blob = new Blob([JSON.stringify(workflowData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workflow_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Đã xuất file workflow JSON!');
    } catch (error: any) {
      toast.error(`Lỗi khi xuất workflow: ${error.message}`);
    }
  }, []);

  // Import workflow from JSON file
  const importWorkflow = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const text = event.target?.result;
          if (typeof text !== 'string') return;
          const data = JSON.parse(text);
          if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
            toast.error('File workflow không đúng định dạng!');
            return;
          }

          const hydrated = hydrateNodes(data.nodes);
          setNodes(hydrated);
          setEdges(data.edges);
          toast.success('Đã nhập workflow thành công!');
        } catch (err: any) {
          toast.error(`Lỗi đọc file workflow: ${err.message}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [hydrateNodes, setNodes, setEdges]);

  // Preset Workflow 1: T2I -> Collector -> R2I -> Collector -> Video
  const loadPresetWorkflow1 = useCallback(() => {
    setNodes([]);
    setEdges([]);

    const t2iId = `prompt_t2i_${Date.now()}`;
    const collectorId1 = `collector_ref_${Date.now()}`;
    const r2iId = `prompt_r2i_${Date.now()}`;
    const collectorId2 = `collector_scene_${Date.now()}`;
    const vpId = `vidprompt_${Date.now()}`;

    const presetNodes: Node[] = [
      {
        id: t2iId,
        type: 'prompt',
        position: { x: 50, y: 150 },
        style: { width: 260, height: 220 },
        data: {
          prompt: 'Một chú mèo trắng nhỏ mắt xanh xoe tròn, lông xù mượt mà, phong cách hoạt hình Ghibli\nCô gái tóc nâu hạt dẻ buộc đuôi ngựa thấp, áo len sọc xám trắng, phong cách hoạt hình Ghibli',
          isGeneratingImage: false,
          imageOnly: true,
          modeLabel: 'T2I Batch',
        },
      },
      {
        id: collectorId1,
        type: 'imageCollector',
        position: { x: 380, y: 150 },
        style: { width: 260, height: 200 },
        data: { collectedMediaIds: [], collectedImageUrls: [] },
      },
      {
        id: r2iId,
        type: 'prompt',
        position: { x: 710, y: 150 },
        style: { width: 260, height: 220 },
        data: {
          prompt: 'Cảnh 1: Mèo trắng đang đùa nghịch nhảy lò cò trên thảm cỏ hoa cúc rực rỡ dưới nắng vàng\nCảnh 2: Cô gái mỉm cười tưới nước cho mấy chậu hoa hướng dương rực rỡ bên hiên nhà gỗ nhỏ ấm áp',
          isGeneratingImage: false,
          imageOnly: true,
          useReference: true,
          modeLabel: 'R2I Batch',
        },
      },
      {
        id: collectorId2,
        type: 'imageCollector',
        position: { x: 1040, y: 150 },
        style: { width: 260, height: 200 },
        data: { collectedMediaIds: [], collectedImageUrls: [] },
      },
      {
        id: vpId,
        type: 'videoPrompt',
        position: { x: 1370, y: 150 },
        style: { width: 260, height: 220 },
        data: {
          videoPrompt: 'Cảnh 1: Chú mèo trắng nhảy nhót vui tươi, các bông hoa lay động nhẹ theo gió bồng bềnh, hoạt ảnh mượt mà\nCảnh 2: Nước lấp lánh phun ra từ bình tưới, cô gái nhẹ nhàng chuyển động tưới cây, nắng lấp lánh chiếu rọi',
          isGeneratingVideo: false,
          generatedCount: 0,
        },
      },
    ];

    const presetEdges: Edge[] = [
      {
        id: `e_${t2iId}_${collectorId1}`,
        source: t2iId,
        target: collectorId1,
        animated: true,
        style: { stroke: '#6366f1', strokeWidth: 2, opacity: 0.7 } as any,
      },
      {
        id: `e_${collectorId1}_${r2iId}`,
        source: collectorId1,
        target: r2iId,
        animated: true,
        style: { stroke: '#ec4899', strokeWidth: 2, opacity: 0.7 } as any,
      },
      {
        id: `e_${r2iId}_${collectorId2}`,
        source: r2iId,
        target: collectorId2,
        animated: true,
        style: { stroke: '#ec4899', strokeWidth: 2, opacity: 0.7 } as any,
      },
      {
        id: `e_${collectorId2}_${vpId}`,
        source: collectorId2,
        target: vpId,
        animated: true,
        style: { stroke: '#14b8a6', strokeWidth: 2, opacity: 0.7 } as any,
      },
    ];

    const hydrated = hydrateNodes(presetNodes);
    setNodes(hydrated);
    setEdges(presetEdges);
    toast.success('Đã tải mẫu workflow 1: T2I → Collector → R2I → Collector → Video');
  }, [hydrateNodes, setNodes, setEdges]);

  // Preset Workflow 2: T2I -> Collector -> Video trực tiếp
  const loadPresetWorkflow2 = useCallback(() => {
    setNodes([]);
    setEdges([]);

    const t2iId = `prompt_t2i_${Date.now()}`;
    const collectorId = `collector_${Date.now()}`;
    const vpId = `vidprompt_${Date.now()}`;

    const presetNodes: Node[] = [
      {
        id: t2iId,
        type: 'prompt',
        position: { x: 50, y: 150 },
        style: { width: 260, height: 220 },
        data: {
          prompt: 'Một chú mèo trắng nhỏ mắt xanh xoe tròn, lông xù mượt mà, phong cách hoạt hình Ghibli\nCô gái tóc nâu hạt dẻ buộc đuôi ngựa thấp, áo len sọc xám trắng, phong cách hoạt hình Ghibli',
          isGeneratingImage: false,
          imageOnly: true,
          modeLabel: 'T2I Batch',
        },
      },
      {
        id: collectorId,
        type: 'imageCollector',
        position: { x: 380, y: 150 },
        style: { width: 260, height: 200 },
        data: { collectedMediaIds: [], collectedImageUrls: [] },
      },
      {
        id: vpId,
        type: 'videoPrompt',
        position: { x: 710, y: 150 },
        style: { width: 260, height: 220 },
        data: {
          videoPrompt: 'Cảnh 1: Chú mèo trắng nhảy nhót vui tươi trong vườn hoa cúc vàng rực, slow motion\nCảnh 2: Cô gái mỉm cười dịu dàng tưới nước cho khóm cây trước thềm nhà gỗ ấm áp dưới nắng chiều',
          isGeneratingVideo: false,
          generatedCount: 0,
        },
      },
    ];

    const presetEdges: Edge[] = [
      {
        id: `e_${t2iId}_${collectorId}`,
        source: t2iId,
        target: collectorId,
        animated: true,
        style: { stroke: '#6366f1', strokeWidth: 2, opacity: 0.7 } as any,
      },
      {
        id: `e_${collectorId}_${vpId}`,
        source: collectorId,
        target: vpId,
        animated: true,
        style: { stroke: '#14b8a6', strokeWidth: 2, opacity: 0.7 } as any,
      },
    ];

    const hydrated = hydrateNodes(presetNodes);
    setNodes(hydrated);
    setEdges(presetEdges);
    toast.success('Đã tải mẫu workflow 2: T2I → Collector → Video trực tiếp');
  }, [hydrateNodes, setNodes, setEdges]);

  // ─── Agent: Story Pipeline (multi-step) ───
  // Step 1: Create character design images (T2I)
  // Step 2: Create background/prop images (T2I)
  // Step 3: Use character images as reference for scene images (R2I)
  // Step 4: Create videos from scene images (I2V) — optional
  const agentStoryPipeline = useCallback(async (
    storyAction: any,
    _autoExecute: boolean,
    passedRefMediaIds?: string[],
  ) => {
    const characters = storyAction.characters || [];
    const backgrounds = storyAction.backgrounds || [];
    const props = storyAction.props || [];
    const scenes = storyAction.scenes || [];
    const aspectRatio = storyAction.aspect_ratio || '16:9';
    const modelTier = storyAction.model || 'pro';
    const autoVideo = storyAction.auto_video ?? false;

    const imgAspect = IMG_ASPECT_MAP[aspectRatio] || 'IMAGE_ASPECT_RATIO_LANDSCAPE';
    const vidAspect = ASPECT_MAP[aspectRatio] || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
    const vidModel = MODEL_MAP['i2v']?.[modelTier] || MODEL_MAP['i2v']?.pro || 'veo_3_1_i2v_s_fast';

    const totalSteps = characters.length + backgrounds.length + props.length + scenes.length;
    let completedSteps = 0;
    const failedPrompts: string[] = [];
    const failedVideoPrompts: string[] = [];
    let successesSinceLastClear = 0;
    let consecutive403 = 0;
    const autoClearCache = localStorage.getItem('auto_clear_cache') !== 'false';
    const charMediaIds: string[] = [];
    const charMediaMap: Record<string, string> = {};  // name → mediaId
    const bgMediaIds: string[] = [];
    const bgMediaMap: Record<string, string> = {};    // name → mediaId
    const propMediaIds: string[] = [];
    const propMediaMap: Record<string, string> = {};  // name → mediaId

    // Collect existing uploaded ref media IDs from CharacterNodes on canvas
    const canvasCharNodes = nodesRef.current.filter(n => n.type === 'character');
    const canvasCharMediaIds: string[] = [];
    for (const cn of canvasCharNodes) {
      const nodeMediaIds = charMediaIdsRef.current[cn.id] || [];
      canvasCharMediaIds.push(...nodeMediaIds);
    }
    // Also collect from existing reference image nodes (👤🏞️🎭) on canvas
    const canvasRefImageNodes = nodesRef.current.filter(n => {
      if (n.type !== 'image' || !n.data.mediaId) return false;
      if (n.data.isReference === true) return true;
      const lbl = (n.data.label as string) || '';
      return lbl.startsWith('👤') || lbl.startsWith('🏞️') || lbl.startsWith('🎭');
    });
    const canvasRefMediaIds = canvasRefImageNodes.map(n => n.data.mediaId as string);

    // Merge: passedRefMediaIds (from AgentPanel upload) + CharacterNode uploads + existing ref images
    const userRefMediaIds = [...new Set([
      ...(passedRefMediaIds || []),
      ...canvasCharMediaIds,
      ...canvasRefMediaIds,
    ])];

    // Helper: emit progress events for AgentPanel to listen to
    const emitProgress = (msg: string, phase?: string, current?: number, total?: number) => {
      window.dispatchEvent(new CustomEvent('pipeline-progress', {
        detail: { message: msg, phase, current, total, timestamp: Date.now() }
      }));
    };

    // Helper: process character names and background names to image_index.png in the story pipeline
    const processStoryPromptReferences = (p: string, refIds: string[]): string => {
      let processed = p;
      // Map charName -> mediaId
      for (const [name, mid] of Object.entries(charMediaMap)) {
        const idx = refIds.indexOf(mid);
        if (idx !== -1) {
          const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedName}\\b`, 'gi');
          processed = processed.replace(regex, `image_${idx}.png`);
        }
      }
      // Map bgName -> mediaId
      for (const [name, mid] of Object.entries(bgMediaMap)) {
        const idx = refIds.indexOf(mid);
        if (idx !== -1) {
          const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedName}\\b`, 'gi');
          processed = processed.replace(regex, `image_${idx}.png`);
        }
      }
      // Map propName -> mediaId
      for (const [name, mid] of Object.entries(propMediaMap)) {
        const idx = refIds.indexOf(mid);
        if (idx !== -1) {
          const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedName}\\b`, 'gi');
          processed = processed.replace(regex, `image_${idx}.png`);
        }
      }
      // Explicit tags
      for (let i = 0; i < refIds.length; i++) {
        const refPlaceholderRegex = new RegExp(`\\[ref_${i}\\]|\\bref_${i}\\b`, 'gi');
        processed = processed.replace(refPlaceholderRegex, `image_${i}.png`);
      }
      return processed;
    };

    let lastErrorMsg = "Không rõ nguyên nhân (Có thể do lỗi mạng hoặc extension)";
    let consecutiveFailures = 0;

    // Helper: try creating an image with auto-retry (max 9 attempts)
    const createImageWithRetry = async (
      prompt: string,
      label: string,
      refIds?: string[],
      maxRetries = 8, // 9 attempts total
    ): Promise<{ url: string; mediaId: string } | null> => {
      const finalPrompt = refIds && refIds.length > 0 ? processStoryPromptReferences(prompt, refIds) : prompt;
      let attempt = 0;
      const maxAttempts = maxRetries + 1;

      while (attempt < maxAttempts) {
        if (attempt > 0) {
          toast.loading(`⏳ Thử lại ${label} lần ${attempt + 1}/9 (chờ 10s)...`, { id: 'story-step' });
          await new Promise(r => setTimeout(r, 10000));
        }

        // Parallel coordination: wait 15s since last completed generation
        if (lastCompletionTimeRef.current > 0) {
          const elapsed = Date.now() - lastCompletionTimeRef.current;
          if (elapsed < 15000) {
            await new Promise(r => setTimeout(r, 15000 - elapsed));
          }
        }

        try {
          const res = await axios.post('/api/generate/image', {
            prompt: finalPrompt,
            project_id: settings.flowkitProjectId,
            ...(refIds && refIds.length > 0 ? { reference_media_ids: refIds } : {}),
            aspect_ratio: imgAspect,
          });

          if (res.data.success && res.data.url && res.data.media_id) {
            consecutive403 = 0; // reset
            successesSinceLastClear++;
            if (autoClearCache && successesSinceLastClear >= 50) {
              await clearCacheAndWaitForReady();
              successesSinceLastClear = 0;
            }
            return { url: res.data.url, mediaId: res.data.media_id };
          }

          // Check for overload in response details
          const apiError = res.data.error;
          let errorText = "";
          if (typeof apiError === 'string') {
            errorText = apiError;
          } else if (apiError && typeof apiError === 'object') {
            const errObj = apiError.data?.error || apiError.error || apiError;
            errorText = errObj.message || JSON.stringify(errObj);
          }

          if (isOverloadMsg(errorText)) {
            toast.loading(`⏳ Quá tải hệ thống (Resource exhausted). Đang poll chờ 30s để gửi lại...`, { id: 'story-step' });
            await new Promise(r => setTimeout(r, 30000));
            continue; // Retry without incrementing attempt
          }

          lastErrorMsg = errorText || "Không nhận được phản hồi hợp lệ từ Flow API";
          attempt++;
          if (attempt < maxAttempts) {
            toast.loading(`⚠️ ${label} thất bại, thử lại lần ${attempt + 1}/9...`, { id: 'story-step' });
          }
        } catch (err: any) {
          const errorText = err?.response?.data?.detail || err?.response?.data?.error || err.message || "Lỗi kết nối mạng";
          const is403 = err?.response?.status === 403 || String(errorText).includes('403');
          if (is403) {
            consecutive403++;
            if (consecutive403 >= 5) {
              toast('⚠️ Phát hiện lỗi 403 captcha 5 lần liên tiếp. Đang dọn cache & reload...', { id: 'story-step' });
              try {
                await clearCacheAndWaitForReady();
                consecutive403 = 0;
                attempt--; // retry this attempt
                continue;
              } catch (clearErr: any) {
                toast.error('Lỗi khi tự dọn cache captcha: ' + clearErr.message);
              }
            }
          } else {
            consecutive403 = 0;
          }

          if (isOverloadMsg(errorText) || err?.response?.status === 429 || err?.response?.status === 503) {
            toast.loading(`⏳ Quá tải hệ thống (Resource exhausted). Đang poll chờ 30s để gửi lại...`, { id: 'story-step' });
            await new Promise(r => setTimeout(r, 30000));
            continue; // Retry without incrementing attempt
          }

          lastErrorMsg = errorText;
          attempt++;
          if (attempt < maxAttempts) {
            toast.loading(`⚠️ ${label} lỗi, thử lại lần ${attempt + 1}/9...`, { id: 'story-step' });
          }
        }
      }
      return null;
    };

    // ══════════════════════════════════════════════════════════
    // PHASE 1: Tạo nhân vật (BẮT BUỘC — dừng nếu thất bại)
    // ══════════════════════════════════════════════════════════
    if (characters.length > 0) {
      emitProgress(`👤 Bước 1: Tạo ${characters.length} nhân vật...`, 'characters', 0, characters.length);
      toast.loading(`👤 Bước 1: Tạo ${characters.length} nhân vật...`, { id: 'story-step' });

      for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        toast.loading(`👤 Nhân vật ${i + 1}/${characters.length}: ${char.name}...`, { id: 'story-step' });

        const result = await createImageWithRetry(
          char.design_prompt,
          `Nhân vật "${char.name}"`,
          userRefMediaIds.length > 0 ? userRefMediaIds : undefined,
        );

        lastCompletionTimeRef.current = Date.now();

        if (!result) {
          consecutiveFailures++;
          failedPrompts.push(`[CHAR] ${char.design_prompt}`);
          toast.dismiss('story-step');

          if (consecutiveFailures >= 3) {
            toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại (lỗi CHAR)!`, { duration: 8000 });
            return {
              success: completedSteps, failed: failedPrompts.length, total: totalSteps,
              failedPrompts, charMediaIds,
              stoppedAt: 'characters',
              stoppedReason: `Dừng workflow do 3 prompt liên tiếp thất bại.\n\n❌ Lỗi cuối cùng:\n> ${lastErrorMsg}`,
            };
          }

          // Delay 15s on failure
          toast.loading(`⏳ Thất bại, nghỉ 15s trước khi tiếp tục...`, { id: 'story-step' });
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }

        consecutiveFailures = 0;

        // ✅ Thành công — add node
        const charNodeId = `char_story_${Date.now()}_${i}`;
        setNodes(nds => nds.concat({
          id: charNodeId, type: 'image',
          position: { x: 80 + i * 360, y: 80 },
          style: nodeSize(imgAspect),
          data: {
            imageUrl: result.url, mediaId: result.mediaId,
            prompt: char.design_prompt, aspectRatio: imgAspect,
            isGeneratingVideo: false, promptIndex: i + 1,
            label: `👤 ${char.name}`,
            isReference: true,
          },
        }));
        charMediaIds.push(result.mediaId);
        charMediaMap[char.name] = result.mediaId;
        addMedia({ id: result.mediaId, type: 'image', filename: `char_${char.name}.png`, path: result.url, url: result.url, prompt: char.design_prompt, createdAt: new Date().toISOString(), fileSize: 0, status: 'ready' });
        completedSteps++;
        emitProgress(`👤 ${char.name} ✅ (${i + 1}/${characters.length})`, 'characters', i + 1, characters.length);
        toast.loading(`👤 ${char.name} ✅ (${i + 1}/${characters.length})`, { id: 'story-step' });

        // Delay 5s after successful creation
        toast.loading(`✨ Nghĩ 5s trước khi tạo tiếp...`, { id: 'story-step' });
        await new Promise(r => setTimeout(r, 5000));
      }

      // ✅ CHECKPOINT 1: Tất cả nhân vật OK
      emitProgress(`✅ ${characters.length} nhân vật sẵn sàng → Tạo bối cảnh...`, 'checkpoint', characters.length, characters.length);
      toast.success(`✅ ${characters.length} nhân vật sẵn sàng (${charMediaIds.length} tham chiếu)`, { id: 'story-step', duration: 2000 });
      await new Promise(r => setTimeout(r, 1000));
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 2: Tạo bối cảnh (lỗi → cảnh báo, tiếp tục)
    // ══════════════════════════════════════════════════════════
    if (backgrounds.length > 0) {
      toast.loading(`🏞️ Bước 2: Tạo ${backgrounds.length} bối cảnh...`, { id: 'story-step' });

      for (let i = 0; i < backgrounds.length; i++) {
        const bg = backgrounds[i];
        toast.loading(`🏞️ Bối cảnh ${i + 1}/${backgrounds.length}: ${bg.name}...`, { id: 'story-step' });
        const result = await createImageWithRetry(bg.design_prompt, `Bối cảnh "${bg.name}"`);

        lastCompletionTimeRef.current = Date.now();

        if (!result) {
          consecutiveFailures++;
          failedPrompts.push(`[BG] ${bg.design_prompt}`);
          
          if (consecutiveFailures >= 3) {
            toast.dismiss('story-step');
            toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại (lỗi BG)!`, { duration: 8000 });
            return {
              success: completedSteps, failed: failedPrompts.length, total: totalSteps,
              failedPrompts, charMediaIds,
              stoppedAt: 'backgrounds',
              stoppedReason: `Dừng workflow do 3 prompt liên tiếp thất bại.\n\n❌ Lỗi cuối cùng:\n> ${lastErrorMsg}`,
            };
          }

          toast.loading(`⏳ Thất bại, nghỉ 15s trước khi tiếp tục...`, { id: 'story-step' });
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }

        consecutiveFailures = 0;

        const bgNodeId = `bg_story_${Date.now()}_${i}`;
        setNodes(nds => nds.concat({
          id: bgNodeId, type: 'image',
          position: { x: 80 + (characters.length + i) * 360, y: 80 },
          style: nodeSize(imgAspect),
          data: {
            imageUrl: result.url, mediaId: result.mediaId,
            prompt: bg.design_prompt, aspectRatio: imgAspect,
            isGeneratingVideo: false, label: `🏞️ ${bg.name}`,
            isReference: true,
          },
        }));
        bgMediaIds.push(result.mediaId);
        bgMediaMap[bg.name] = result.mediaId;
        addMedia({ id: result.mediaId || bgNodeId, type: 'image', filename: `bg_${bg.name}.png`, path: result.url, url: result.url, prompt: bg.design_prompt, createdAt: new Date().toISOString(), fileSize: 0, status: 'ready' });
        completedSteps++;

        // Delay 5s
        toast.loading(`✨ Nghĩ 5s trước khi tạo tiếp...`, { id: 'story-step' });
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    // ── PHASE 2b: Tạo đạo cụ (BẮT BUỘC — dừng nếu thất bại)
    if (props.length > 0) {
      toast.loading(`🎭 Tạo ${props.length} đạo cụ...`, { id: 'story-step' });
      for (let i = 0; i < props.length; i++) {
        const prop = props[i];
        const result = await createImageWithRetry(prop.design_prompt, `Đạo cụ "${prop.name}"`);

        lastCompletionTimeRef.current = Date.now();

        if (!result) {
          consecutiveFailures++;
          failedPrompts.push(`[PROP] ${prop.design_prompt}`);

          if (consecutiveFailures >= 3) {
            toast.dismiss('story-step');
            toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại (lỗi PROP)!`, { duration: 8000 });
            return {
              success: completedSteps, failed: failedPrompts.length, total: totalSteps,
              failedPrompts, charMediaIds,
              stoppedAt: 'props',
              stoppedReason: `Dừng workflow do 3 prompt liên tiếp thất bại.\n\n❌ Lỗi cuối cùng:\n> ${lastErrorMsg}`,
            };
          }

          toast.loading(`⏳ Thất bại, nghỉ 15s trước khi tiếp tục...`, { id: 'story-step' });
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }

        consecutiveFailures = 0;
        
        // Add to canvas as a Node
        const propNodeId = `prop_story_${Date.now()}_${i}`;
        setNodes(nds => nds.concat({
          id: propNodeId, type: 'image',
          position: { x: 80 + (characters.length + backgrounds.length + i) * 360, y: 80 },
          style: nodeSize(imgAspect),
          data: {
            imageUrl: result.url, mediaId: result.mediaId,
            prompt: prop.design_prompt, aspectRatio: imgAspect,
            isGeneratingVideo: false, label: `🎭 ${prop.name}`,
            isReference: true,
          },
        }));

        propMediaIds.push(result.mediaId);
        propMediaMap[prop.name] = result.mediaId;
        addMedia({ id: result.mediaId || propNodeId, type: 'image', filename: `prop_${prop.name}.png`, path: result.url, url: result.url, prompt: prop.design_prompt, createdAt: new Date().toISOString(), fileSize: 0, status: 'ready' });
        completedSteps++;

        // Delay 5s
        toast.loading(`✨ Nghĩ 5s trước khi tạo tiếp...`, { id: 'story-step' });
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    // ══════════════════════════════════════════════════════════
    // ✅ CHECKPOINT 2: Kiểm tra tham chiếu trước khi tạo cảnh
    // ══════════════════════════════════════════════════════════
    const allRefIds = [...charMediaIds, ...bgMediaIds, ...propMediaIds, ...userRefMediaIds];
    const hasRef = allRefIds.length > 0;

    if (characters.length > 0 && charMediaIds.length === 0) {
      toast.dismiss('story-step');
      toast.error('❌ Không có tham chiếu nhân vật nào. Kiểm tra prompt hoặc liên hệ Zalo hỗ trợ rồi thử lại.', { duration: 8000 });
      return {
        success: completedSteps, failed: failedPrompts.length, total: totalSteps,
        failedPrompts, charMediaIds,
        stoppedAt: 'pre-scene-check',
        stoppedReason: 'Không có ảnh tham chiếu nhân vật → không thể tạo cảnh R2I.\n\n👉 Kiểm tra prompt hoặc liên hệ Zalo trong trang hỗ trợ rồi thử lại.',
      };
    }

    // Helper: build per-scene reference IDs (chars in scene + matching background + matching props)
    const buildSceneRefIds = (scene: any): string[] => {
      const refs: string[] = [...userRefMediaIds];
      // Add characters in this scene
      const charsInScene = scene.characters_in_scene || [];
      if (charsInScene.length > 0) {
        for (const cName of charsInScene) {
          const mid = charMediaMap[cName];
          if (mid) refs.push(mid);
        }
      } else {
        // No specific chars listed → use ALL characters
        refs.push(...charMediaIds);
      }
      // Add matching background
      const bgName = scene.background_in_scene || '';
      if (bgName && bgMediaMap[bgName]) {
        refs.push(bgMediaMap[bgName]);
      } else if (bgMediaIds.length > 0) {
        // No specific bg → try to match from scene description/title
        const sceneText = `${scene.scene_title || ''} ${scene.description || ''} ${scene.image_prompt || ''}`.toLowerCase();
        for (const [name, mid] of Object.entries(bgMediaMap)) {
          if (sceneText.includes(name.toLowerCase())) {
            refs.push(mid);
            break;
          }
        }
        // If still no match, use all backgrounds
        if (refs.filter(r => bgMediaIds.includes(r)).length === 0) {
          refs.push(...bgMediaIds);
        }
      }
      // Add matching props
      const sceneText = `${scene.scene_title || ''} ${scene.description || ''} ${scene.image_prompt || ''}`.toLowerCase();
      for (const [name, mid] of Object.entries(propMediaMap)) {
        if (sceneText.includes(name.toLowerCase()) || name.toLowerCase().split(' ').some(word => word.length > 3 && sceneText.includes(word))) {
          refs.push(mid);
        }
      }
      // If no props matched but props exist, let's add all of them as reference to be safe, so they are available in refIds
      if (props.length > 0 && refs.filter(r => propMediaIds.includes(r)).length === 0) {
        refs.push(...propMediaIds);
      }
      return [...new Set(refs)]; // deduplicate
    };

    // ══════════════════════════════════════════════════════════
    // PHASE 3: Tạo cảnh R2I/T2I
    // ══════════════════════════════════════════════════════════
    emitProgress(`🎨 Bước 3: Tạo ${scenes.length} cảnh ${hasRef ? `(R2I — ${allRefIds.length} ref)` : '(T2I)'}...`, 'scenes', 0, scenes.length);
    toast.loading(
      `🎨 Bước 3: Tạo ${scenes.length} cảnh ${hasRef ? `(R2I — ${allRefIds.length} tham chiếu)` : '(T2I)'}...`,
      { id: 'story-step' },
    );

    const createdSceneImages: { nodeId: string; mediaId: string; prompt: string; videoPrompts: string[]; sceneNumber: number }[] = [];

    const startPos = getBatchStartPosition(nodesRef.current);
    const pX = startPos.x;
    const pY = startPos.y;

    const promptNodeId = `prompt_story_${Date.now()}`;
    const scenePrompts = scenes.map((s: any) => s.image_prompt || s.prompt);
    setNodes(nds => nds.concat({
      id: promptNodeId, type: 'prompt',
      position: { x: pX, y: pY },
      data: {
        prompt: scenePrompts.join('\n'), aspectRatio: imgAspect,
        isGeneratingImage: false, useReference: hasRef,
        modeLabel: `Story ${hasRef ? 'R2I' : 'T2I'}`,
      },
    }));

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const imgPrompt = scene.image_prompt || scene.prompt;
      const vidPrompts: string[] = scene.video_prompts
        ? (Array.isArray(scene.video_prompts) ? scene.video_prompts : [scene.video_prompts])
        : (scene.video_prompt ? [scene.video_prompt] : [scene.prompt]);
      toast.loading(`🎨 Cảnh ${i + 1}/${scenes.length}...`, { id: 'story-step' });

      // Build per-scene refs (characters + background relevant to this scene)
      const sceneRefIds = hasRef ? buildSceneRefIds(scene) : [];
      // Append previous scene's image as a reference to maintain excellent frame-to-frame key end-frame continuity!
      if (i > 0 && createdSceneImages[i - 1]?.mediaId) {
        sceneRefIds.push(createdSceneImages[i - 1].mediaId);
      }
      const refCount = sceneRefIds.length;
      toast.loading(`🎨 Cảnh ${i + 1}/${scenes.length} (${refCount} tham chiếu, ${vidPrompts.length} góc máy)...`, { id: 'story-step' });

      const result = await createImageWithRetry(imgPrompt, `Cảnh ${i + 1}`, sceneRefIds.length > 0 ? sceneRefIds : undefined);

      lastCompletionTimeRef.current = Date.now();

      const sceneNum = scene.number || i + 1;

      if (!result) {
        consecutiveFailures++;
        failedPrompts.push(imgPrompt);

        // Create a failed ImageNode on canvas
        const { imagePositions } = pipelineLayout(pX, pY, scenes.length, autoVideo);
        const imageNodeId = `img_scene_failed_${Date.now()}_${i}`;
        setNodes(nds => nds.concat({
          id: imageNodeId, type: 'image',
          position: imagePositions[i] || { x: pX + 380, y: pY + i * 260 },
          style: nodeSize(imgAspect),
          data: {
            imageUrl: undefined, mediaId: undefined,
            prompt: imgPrompt, videoPrompts: vidPrompts, aspectRatio: imgAspect,
            isGeneratingVideo: false, promptIndex: sceneNum,
            label: `🎬 Cảnh ${sceneNum}`,
            status: 'failed',
          },
        }));
        setEdges(eds => eds.concat({
          id: `e_${promptNodeId}_${imageNodeId}`,
          source: promptNodeId, target: imageNodeId,
          animated: true, style: { stroke: '#ef4444', strokeWidth: 2, opacity: 0.7 },
        }));

        if (consecutiveFailures >= 3) {
          toast.dismiss('story-step');
          toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại (lỗi SCENE)!`, { duration: 8000 });
          return {
            success: completedSteps, failed: failedPrompts.length, total: totalSteps,
            failedPrompts, charMediaIds,
            stoppedAt: 'scenes',
            stoppedReason: `Dừng workflow do 3 prompt liên tiếp thất bại.\n\n❌ Lỗi cuối cùng:\n> ${lastErrorMsg}`,
          };
        }

        toast.loading(`⏳ Thất bại, nghỉ 15s trước khi tiếp tục...`, { id: 'story-step' });
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }

      consecutiveFailures = 0;

      const { imagePositions } = pipelineLayout(pX, pY, scenes.length, autoVideo);
      const imageNodeId = `img_scene_${Date.now()}_${i}`;
      setNodes(nds => nds.concat({
        id: imageNodeId, type: 'image',
        position: imagePositions[i] || { x: pX + 380, y: pY + i * 260 },
        style: nodeSize(imgAspect),
        data: {
          imageUrl: result.url, mediaId: result.mediaId,
          prompt: imgPrompt, videoPrompts: vidPrompts, aspectRatio: imgAspect,
          isGeneratingVideo: false, promptIndex: sceneNum,
          label: `🎬 Cảnh ${sceneNum}`,
          refMediaIds: sceneRefIds.length > 0 ? sceneRefIds : undefined,
        },
      }));
      setEdges(eds => {
        let newEds = eds.concat({
          id: `e_${promptNodeId}_${imageNodeId}`,
          source: promptNodeId, target: imageNodeId,
          animated: true, style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
        });
        if (i > 0 && createdSceneImages[i - 1]) {
          newEds = newEds.concat({
            id: `e_keyframe_flow_img_${createdSceneImages[i - 1].nodeId}_${imageNodeId}`,
            source: createdSceneImages[i - 1].nodeId, target: imageNodeId,
            animated: true,
            style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
            label: 'Key End Frame',
          } as any);
        }
        return newEds;
      });

      createdSceneImages.push({ nodeId: imageNodeId, mediaId: result.mediaId, prompt: imgPrompt, videoPrompts: vidPrompts, sceneNumber: scene.number || i + 1 });
      addMedia({ id: result.mediaId, type: 'image', filename: `scene_${scene.number || i + 1}.png`, path: result.url, url: result.url, prompt: imgPrompt, createdAt: new Date().toISOString(), fileSize: 0, status: 'ready' });
      completedSteps++;
      emitProgress(`🎨 Cảnh ${i + 1}/${scenes.length} ✅`, 'scenes', i + 1, scenes.length);
      toast.loading(`🎨 Cảnh ${i + 1}/${scenes.length} ✅`, { id: 'story-step' });

      // Delay 5s
      toast.loading(`✨ Nghĩ 5s trước khi tạo tiếp...`, { id: 'story-step' });
      await new Promise(r => setTimeout(r, 5000));
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 3.5: Auto-retry ảnh cảnh lỗi (tối đa 3 vòng)
    // ══════════════════════════════════════════════════════════
    if (failedPrompts.length > 0 && autoVideo) {
      const maxRetryRounds = 3;
      for (let round = 1; round <= maxRetryRounds && failedPrompts.length > 0; round++) {
        const retryCount = failedPrompts.length;
        const retryDelay = round * 3000; // 3s, 6s, 9s increasing delay
        emitProgress(`🔄 Auto-retry vòng ${round}: ${retryCount} cảnh lỗi (chờ ${retryDelay / 1000}s)...`, 'retry', 0, retryCount);
        toast.loading(`🔄 Retry vòng ${round}/${maxRetryRounds}: ${retryCount} cảnh lỗi...`, { id: 'story-step' });
        await new Promise(r => setTimeout(r, retryDelay));

        const stillFailed: string[] = [];
        for (let ri = 0; ri < failedPrompts.length; ri++) {
          const retryPrompt = failedPrompts[ri];
          // Find matching scene to get refs + video prompts
          const matchScene = scenes.find((s: any) => (s.image_prompt || s.prompt) === retryPrompt);
          const sceneIdx = matchScene ? scenes.indexOf(matchScene) : createdSceneImages.length + ri;
          const sceneRefIds = hasRef && matchScene ? buildSceneRefIds(matchScene) : undefined;
          const vidPrompts: string[] = matchScene?.video_prompts
            ? (Array.isArray(matchScene.video_prompts) ? matchScene.video_prompts : [matchScene.video_prompts])
            : (matchScene?.video_prompt ? [matchScene.video_prompt] : [retryPrompt]);

          emitProgress(`🔄 Retry ${ri + 1}/${retryCount} (vòng ${round})...`, 'retry', ri + 1, retryCount);
          toast.loading(`🔄 Retry cảnh ${ri + 1}/${retryCount} (vòng ${round})...`, { id: 'story-step' });

          const result = await createImageWithRetry(retryPrompt, `Retry cảnh`, sceneRefIds, 1);

          lastCompletionTimeRef.current = Date.now();

          if (result) {
            consecutiveFailures = 0;
            // Success! Add to createdSceneImages
            const { imagePositions } = pipelineLayout(pX, pY, scenes.length, autoVideo);
            const imageNodeId = `img_scene_retry_${Date.now()}_${ri}`;
            const sceneNum = matchScene?.number || sceneIdx + 1;

            // Clean up the failed image node that we created earlier
            const oldFailedNodes = nodesRef.current.filter(n => n.type === 'image' && n.data?.promptIndex === sceneNum && n.data?.status === 'failed');
            const oldFailedNodeIds = oldFailedNodes.map(n => n.id);

            setNodes(nds => nds.filter(n => !oldFailedNodeIds.includes(n.id)).concat({
              id: imageNodeId, type: 'image',
              position: imagePositions[sceneIdx] || { x: pX + 380, y: pY + sceneIdx * 260 },
              style: nodeSize(imgAspect),
              data: {
                imageUrl: result.url, mediaId: result.mediaId,
                prompt: retryPrompt, videoPrompts: vidPrompts, aspectRatio: imgAspect,
                isGeneratingVideo: false, promptIndex: sceneNum,
                label: `🎬 Cảnh ${sceneNum}`,
              },
            }));
            setEdges(eds => {
              let newEds = eds.filter(e => !oldFailedNodeIds.includes(e.source) && !oldFailedNodeIds.includes(e.target)).concat({
                id: `e_${promptNodeId}_${imageNodeId}`,
                source: promptNodeId, target: imageNodeId,
                animated: true, style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
              });
              const prevIdx = sceneIdx - 1;
              const prevImage = createdSceneImages.find(img => img.sceneNumber === prevIdx + 1);
              if (prevImage) {
                newEds = newEds.concat({
                  id: `e_keyframe_flow_img_${prevImage.nodeId}_${imageNodeId}`,
                  source: prevImage.nodeId, target: imageNodeId,
                  animated: true,
                  style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                  label: 'Key End Frame',
                } as any);
              }
              return newEds;
            });
            createdSceneImages.push({ nodeId: imageNodeId, mediaId: result.mediaId, prompt: retryPrompt, videoPrompts: vidPrompts, sceneNumber: sceneNum });
            addMedia({ id: result.mediaId, type: 'image', filename: `scene_retry_${sceneNum}.png`, path: result.url, url: result.url, prompt: retryPrompt, createdAt: new Date().toISOString(), fileSize: 0, status: 'ready' });
            completedSteps++;
            toast.success(`✅ Retry cảnh ${sceneNum} thành công!`);

            // Delay 5s
            await new Promise(r => setTimeout(r, 5000));
          } else {
            consecutiveFailures++;
            stillFailed.push(retryPrompt);

            if (consecutiveFailures >= 3) {
              toast.dismiss('story-step');
              toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại (lỗi RETRY)!`, { duration: 8000 });
              return {
                success: completedSteps, failed: failedPrompts.length, total: totalSteps,
                failedPrompts, charMediaIds,
                stoppedAt: 'retry',
                stoppedReason: `Dừng workflow do 3 prompt liên tiếp thất bại.\n\n❌ Lỗi cuối cùng:\n> ${lastErrorMsg}`,
              };
            }

            // Delay 15s
            await new Promise(r => setTimeout(r, 15000));
          }
        }
        // Update failedPrompts with remaining failures
        failedPrompts.length = 0;
        failedPrompts.push(...stillFailed);

        if (failedPrompts.length === 0) {
          emitProgress(`✅ Tất cả cảnh đã tạo xong sau retry!`, 'retry', retryCount, retryCount);
          toast.success(`✅ Auto-retry thành công! Tất cả ${scenes.length} cảnh đã có ảnh.`);
          break;
        }
      }
      if (failedPrompts.length > 0) {
        toast.dismiss('story-step');
        toast.error(`❌ Vẫn còn ${failedPrompts.length} cảnh lỗi sau retry. Dừng pipeline tạo video để tránh lỗi.`, { duration: 8000 });
        return {
          success: completedSteps, failed: failedPrompts.length, total: totalSteps,
          failedPrompts, charMediaIds,
          stoppedAt: 'scenes',
          stoppedReason: `Vẫn còn ${failedPrompts.length} cảnh lỗi sau retry.\n\n❌ Chi tiết lỗi hệ thống:\n> ${lastErrorMsg}\n\n👉 Vui lòng kiểm tra lại prompt cảnh hoặc liên hệ Zalo hỗ trợ.`,
        };
      }
    }

    // ══════════════════════════════════════════════════════════
    // PHASE 4: Tạo video I2V từ ảnh cảnh (nếu auto_video)
    // ══════════════════════════════════════════════════════════
    if (autoVideo && createdSceneImages.length > 0) {
      // Count total videos across all scenes
      const totalVideos = createdSceneImages.reduce((sum, img) => sum + img.videoPrompts.length, 0);
      emitProgress(`🎬 Bước 4: Tạo ${totalVideos} video I2V từ ${createdSceneImages.length} ảnh cảnh...`, 'videos', 0, totalVideos);
      toast.loading(`🎬 Bước 4: Tạo ${totalVideos} video I2V (${createdSceneImages.length} cảnh)...`, { id: 'story-step' });

      // Helper: poll job status until DONE/FAILED or timeout
      const waitForJob = async (jobId: string, label: string, timeoutMs = 180000): Promise<string> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          try {
            const res = await axios.get(`/api/generate/jobs/${jobId}`);
            const status = res.data.status;
            if (status === 'DONE' || status === 'FAILED') {
              return status;
            }
            emitProgress(`⏳ ${label} đang render...`, 'videos');
          } catch { /* ignore poll errors */ }
          await new Promise(r => setTimeout(r, 5000)); // poll every 5s
        }
        return 'TIMEOUT';
      };

      let videoIndex = 0;
      const createdVideoNodeIds: Record<number, string> = {};
      for (let i = 0; i < createdSceneImages.length; i++) {
        const img = createdSceneImages[i];
        const narration = scenes.find((s: any) => s.number === img.sceneNumber || s.sceneNumber === img.sceneNumber)?.narration || scenes[i]?.narration || '';
        for (let j = 0; j < img.videoPrompts.length; j++) {
          const failedVidNode = nodesRef.current.find(n => 
            n.type === 'video' && 
            n.data?.promptIndex === img.sceneNumber && 
            (n.data?.status === 'failed' || (n.data?.videoUrl === undefined && !n.data?.isGeneratingVideo))
          );

          let vidPrompt = img.videoPrompts[j];
          if (failedVidNode && failedVidNode.data?.prompt) {
            vidPrompt = (failedVidNode.data.prompt as string) || '';
          }

          const angleLabel = img.videoPrompts.length > 1 ? ` (góc ${j + 1})` : '';
          const label = `Cảnh ${img.sceneNumber}${angleLabel}`;
          
          const parentNode = nodesRef.current.find(n => n.id === img.nodeId);
          const parentX = parentNode?.position?.x ?? (300 + 280);
          const parentY = parentNode?.position?.y ?? (350 + i * 240);
          const vidPos = failedVidNode?.position || {
            x: parentX + 350,
            y: parentY + j * 280,
          };

          let jobId = '';
          let submitRetries = 8; // 9 attempts total

          for (let attempt = 0; attempt <= submitRetries; attempt++) {
            try {
              if (attempt > 0) {
                toast.loading(`⏳ Thử lại video ${label} lần ${attempt + 1}/9 (chờ 10s)...`, { id: 'story-step' });
                await new Promise(r => setTimeout(r, 10000));
              }

              // Parallel coordination check
              if (lastCompletionTimeRef.current > 0) {
                const elapsed = Date.now() - lastCompletionTimeRef.current;
                if (elapsed < 15000) {
                  await new Promise(r => setTimeout(r, 15000 - elapsed));
                }
              }

              const res = await axios.post('/api/generate/video', {
                prompt: vidPrompt,
                project_id: settings.flowkitProjectId,
                video_model: vidModel,
                aspect_ratio: vidAspect,
                start_image_media_id: img.mediaId,
              });

              if (res.data?.success && res.data?.job_id) {
                jobId = res.data.job_id;
                consecutive403 = 0;
                break;
              }

              // Check if response contains overload/exhausted error
              const apiError = res.data?.error;
              let errorText = "";
              if (typeof apiError === 'string') {
                errorText = apiError;
              } else if (apiError && typeof apiError === 'object') {
                const errObj = apiError.data?.error || apiError.error || apiError;
                errorText = errObj.message || JSON.stringify(errObj);
              }

              if (isOverloadMsg(errorText)) {
                toast.loading(`⏳ Server quá tải (Resource exhausted). Nghỉ 30s rồi thử lại video...`, { id: 'story-step' });
                await new Promise(r => setTimeout(r, 30000));
                attempt--;
                continue;
              }
            } catch (err: any) {
              const errMsg = err?.response?.data?.detail || err.message || '';
              const is403 = err?.response?.status === 403 || String(errMsg).includes('403');
              if (is403) {
                consecutive403++;
                if (consecutive403 >= 5) {
                  toast('⚠️ Phát hiện lỗi 403 captcha 5 lần liên tiếp. Đang dọn cache & reload...', { id: 'story-step' });
                  try {
                    await clearCacheAndWaitForReady();
                    consecutive403 = 0;
                    attempt--; // retry this attempt
                    continue;
                  } catch (clearErr: any) {
                    toast.error('Lỗi khi tự dọn cache captcha: ' + clearErr.message);
                  }
                }
              } else {
                consecutive403 = 0;
              }

              if (isOverloadMsg(errMsg) || err?.response?.status === 429 || err?.response?.status === 503) {
                toast.loading(`⏳ Server quá tải (Rate limit/Exhausted). Nghỉ 30s rồi thử lại video...`, { id: 'story-step' });
                await new Promise(r => setTimeout(r, 30000));
                attempt--;
                continue;
              }
              if (attempt === submitRetries) {
                // Let jobId be empty to trigger failed flow
              }
            }
          }

          lastCompletionTimeRef.current = Date.now();

          if (jobId) {
            const videoNodeId = `vid_story_${Date.now()}_${i}_${j}`;
            try {
              const oldVidNodes = nodesRef.current.filter(n => n.data?.promptIndex === img.sceneNumber && n.type === 'video');
              const oldVidNodeIds = oldVidNodes.map(n => n.id);

              setNodes(nds => nds.filter(n => !oldVidNodeIds.includes(n.id)).concat({
                id: videoNodeId, type: 'video',
                position: vidPos,
                style: { width: 280, height: 240 },
                data: { jobId, prompt: vidPrompt, narration, status: 'processing', isGeneratingVideo: true, aspectRatio: vidAspect, label: `🎬 Cảnh ${img.sceneNumber}${angleLabel}`, promptIndex: img.sceneNumber },
              }));
              if (j === 0) {
                createdVideoNodeIds[i] = videoNodeId;
              }
              setEdges(eds => {
                let updatedEds = eds.filter(e => !oldVidNodeIds.includes(e.source) && !oldVidNodeIds.includes(e.target)).concat({
                  id: `e_${img.nodeId}_${videoNodeId}`,
                  source: img.nodeId, target: videoNodeId,
                  animated: true, style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
                });
                
                // Reconnect keyframe flow: prev video -> current image
                if (img.sceneNumber > 1 && j === 0) {
                  const prevVidNode = nodesRef.current.find(n => n.type === 'video' && n.data?.promptIndex === img.sceneNumber - 1);
                  if (prevVidNode) {
                    updatedEds = updatedEds.filter(e => e.id !== `e_keyframe_flow_img_${createdSceneImages[i - 1]?.nodeId}_${img.nodeId}`);
                    updatedEds = updatedEds.concat({
                      id: `e_keyframe_flow_${prevVidNode.id}_${img.nodeId}`,
                      source: prevVidNode.id, target: img.nodeId,
                      animated: true,
                      style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                      label: 'Key End Frame',
                    } as any);
                  }
                }
                
                // Reconnect keyframe flow: current video -> next image
                const nextImgNode = nodesRef.current.find(n => n.type === 'image' && n.data?.promptIndex === img.sceneNumber + 1);
                if (nextImgNode && j === 0) {
                  updatedEds = updatedEds.filter(e => e.target !== nextImgNode.id || !e.id.includes('keyframe'));
                  updatedEds = updatedEds.concat({
                    id: `e_keyframe_flow_${videoNodeId}_${nextImgNode.id}`,
                    source: videoNodeId, target: nextImgNode.id,
                    animated: true,
                    style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                    label: 'Key End Frame',
                  } as any);
                }
                return updatedEds;
              });

              emitProgress(`🎬 Video ${videoIndex + 1}/${totalVideos} (${label}) đang render...`, 'videos', videoIndex + 1, totalVideos);
              toast.loading(`📤 Video ${videoIndex + 1}/${totalVideos} (${label}) đã gửi render...`, { id: 'story-step' });

              // Wait for this video to complete before starting next one
              const status = await waitForJob(jobId, label);
              lastCompletionTimeRef.current = Date.now();

              if (status === 'DONE') {
                consecutiveFailures = 0;
                successesSinceLastClear++;
                emitProgress(`✅ ${label} hoàn thành!`, 'videos', videoIndex + 1, totalVideos);
                toast.success(`✅ ${label} xong!`);

                if (autoClearCache && successesSinceLastClear >= 50) {
                  await clearCacheAndWaitForReady();
                  successesSinceLastClear = 0;
                }

                // Delay 5s after successful video
                await new Promise(r => setTimeout(r, 5000));
              } else {
                // FAILED or TIMEOUT
                consecutiveFailures++;
                failedVideoPrompts.push(vidPrompt);
                setNodes(nds => nds.map(n => n.id === videoNodeId ? { ...n, data: { ...n.data, status: 'failed', isGeneratingVideo: false } } : n));
                emitProgress(`❌ ${label} ${status === 'FAILED' ? 'thất bại' : 'quá hạn'}`, 'videos', videoIndex + 1, totalVideos);
                toast.error(`❌ ${label} ${status === 'FAILED' ? 'thất bại' : 'quá hạn'}`);

                if (consecutiveFailures >= 3) {
                  toast.dismiss('story-step');
                  toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại (lỗi render video)!`, { duration: 8000 });
                  const remainingVideoPrompts: string[] = [];
                  remainingVideoPrompts.push(...img.videoPrompts.slice(j + 1));
                  for (let k = i + 1; k < createdSceneImages.length; k++) {
                    remainingVideoPrompts.push(...createdSceneImages[k].videoPrompts);
                  }
                  return {
                    success: completedSteps,
                    failed: failedPrompts.length + failedVideoPrompts.length + remainingVideoPrompts.length,
                    total: totalSteps,
                    failedPrompts: [...failedPrompts, ...failedVideoPrompts, ...remainingVideoPrompts],
                    charMediaIds,
                    hasVideos: true,
                    stoppedAt: 'videos',
                    stoppedReason: `Dừng workflow do 3 prompt liên tiếp thất bại.`,
                  };
                }

                // Delay 15s on failure/timeout
                await new Promise(r => setTimeout(r, 15000));
              }
            } catch (err: any) {
              consecutiveFailures++;
              failedVideoPrompts.push(vidPrompt);
              setNodes(nds => nds.map(n => n.id === videoNodeId ? { ...n, data: { ...n.data, status: 'failed', isGeneratingVideo: false } } : n));
              const errMsg = err?.response?.data?.detail || err.message;
              toast.error(`I2V ${label} lỗi: ${errMsg}`);
              if (consecutiveFailures >= 3) {
                const remainingVideoPrompts: string[] = [];
                remainingVideoPrompts.push(...img.videoPrompts.slice(j + 1));
                for (let k = i + 1; k < createdSceneImages.length; k++) {
                  remainingVideoPrompts.push(...createdSceneImages[k].videoPrompts);
                }
                return {
                  success: completedSteps,
                  failed: failedPrompts.length + failedVideoPrompts.length + remainingVideoPrompts.length,
                  total: totalSteps,
                  failedPrompts: [...failedPrompts, ...failedVideoPrompts, ...remainingVideoPrompts],
                  charMediaIds,
                  hasVideos: true,
                  stoppedAt: 'videos',
                  stoppedReason: `Dừng workflow do 3 prompt liên tiếp thất bại.`,
                };
              }
              await new Promise(r => setTimeout(r, 15000));
            }
          } else {
            // Submission failed completely after 9 attempts
            consecutiveFailures++;
            failedVideoPrompts.push(vidPrompt);
            toast.error(`❌ Gửi ${label} thất bại sau 9 lần thử`);

            // Create failed placeholder video node
            const videoNodeId = `vid_story_failed_${Date.now()}_${i}_${j}`;
            const oldVidNodes = nodesRef.current.filter(n => n.data?.promptIndex === img.sceneNumber && n.type === 'video');
            const oldVidNodeIds = oldVidNodes.map(n => n.id);

            setNodes(nds => nds.filter(n => !oldVidNodeIds.includes(n.id)).concat({
              id: videoNodeId, type: 'video',
              position: vidPos,
              style: { width: 280, height: 240 },
              data: {
                jobId: undefined,
                prompt: vidPrompt,
                narration,
                status: 'failed',
                isGeneratingVideo: false,
                aspectRatio: vidAspect,
                label: `🎬 Cảnh ${img.sceneNumber}${angleLabel}`,
                promptIndex: img.sceneNumber
              },
            }));

            if (j === 0) {
              createdVideoNodeIds[i] = videoNodeId;
            }

            setEdges(eds => {
              let updatedEds = eds.concat({
                id: `e_${img.nodeId}_${videoNodeId}`,
                source: img.nodeId, target: videoNodeId,
                animated: true, style: { stroke: '#ef4444', strokeWidth: 2, opacity: 0.7 },
              });
              
              // Reconnect keyframe flow: prev video -> current image
              if (img.sceneNumber > 1 && j === 0) {
                const prevVidNode = nodesRef.current.find(n => n.type === 'video' && n.data?.promptIndex === img.sceneNumber - 1);
                if (prevVidNode) {
                  updatedEds = updatedEds.filter(e => e.id !== `e_keyframe_flow_img_${createdSceneImages[i - 1]?.nodeId}_${img.nodeId}`);
                  updatedEds = updatedEds.concat({
                    id: `e_keyframe_flow_${prevVidNode.id}_${img.nodeId}`,
                    source: prevVidNode.id, target: img.nodeId,
                    animated: true,
                    style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                    label: 'Key End Frame',
                  } as any);
                }
              }
              
              // Reconnect keyframe flow: current video -> next image
              const nextImgNode = nodesRef.current.find(n => n.type === 'image' && n.data?.promptIndex === img.sceneNumber + 1);
              if (nextImgNode && j === 0) {
                updatedEds = updatedEds.filter(e => e.target !== nextImgNode.id || !e.id.includes('keyframe'));
                updatedEds = updatedEds.concat({
                  id: `e_keyframe_flow_${videoNodeId}_${nextImgNode.id}`,
                  source: videoNodeId, target: nextImgNode.id,
                  animated: true,
                  style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                  label: 'Key End Frame',
                } as any);
              }
              return updatedEds;
            });

            if (consecutiveFailures >= 3) {
              toast.dismiss('story-step');
              const remainingVideoPrompts: string[] = [];
              remainingVideoPrompts.push(...img.videoPrompts.slice(j + 1));
              for (let k = i + 1; k < createdSceneImages.length; k++) {
                remainingVideoPrompts.push(...createdSceneImages[k].videoPrompts);
              }
              return {
                success: completedSteps,
                failed: failedPrompts.length + failedVideoPrompts.length + remainingVideoPrompts.length,
                total: totalSteps,
                failedPrompts: [...failedPrompts, ...failedVideoPrompts, ...remainingVideoPrompts],
                charMediaIds,
                hasVideos: true,
                stoppedAt: 'videos',
                stoppedReason: `Dừng workflow do 3 prompt liên tiếp thất bại.`,
              };
            }

            await new Promise(r => setTimeout(r, 15000));
          }
          videoIndex++;
        }
      }
    }

    const hasVideos = autoVideo && createdSceneImages.length > 0;
    emitProgress(
      failedPrompts.length > 0 || failedVideoPrompts.length > 0
        ? `⚠️ Story: ${completedSteps}/${totalSteps} thành công`
        : hasVideos
        ? `📤 Ảnh xong! Video đang render trên máy chủ...`
        : `✅ Hoàn thành! ${completedSteps}/${totalSteps}`,
      'done', completedSteps, totalSteps
    );
    toast.dismiss('story-step');
    const successCount = completedSteps;
    const finalFailedPrompts = [...failedPrompts, ...failedVideoPrompts];
    if (finalFailedPrompts.length > 0) {
      toast.error(`⚠️ Story: ${successCount}/${totalSteps} thành công, ${finalFailedPrompts.length} lỗi`);
    } else if (hasVideos) {
      toast.success(`📤 Ảnh xong! ${createdSceneImages.length} video đã gửi render — theo dõi tại Gallery`);
    } else {
      toast.success(`✅ Story hoàn thành! ${characters.length} nhân vật + ${scenes.length} cảnh`);
    }

    return {
      success: successCount, failed: finalFailedPrompts.length, total: totalSteps,
      failedPrompts: finalFailedPrompts, charMediaIds, hasVideos,
    };
  }, [setNodes, setEdges, settings.flowkitProjectId, addMedia]);

  // Agent: I2V Pipeline — R2I (tạo ảnh từ tham chiếu) → I2V (animate thành video)
  // Flow: Upload ảnh user → R2I tạo ảnh mới → I2V animate
  const agentI2VPipeline = useCallback(async (scenes: any[], autoExecute: boolean, modelTier?: string, aspectRatio?: string, passedRefMediaIds?: string[]) => {
    const imgAspect = IMG_ASPECT_MAP[aspectRatio || '16:9'] || 'IMAGE_ASPECT_RATIO_LANDSCAPE';
    const vidAspect = ASPECT_MAP[aspectRatio || '16:9'] || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
    const vidModel = MODEL_MAP['i2v']?.[modelTier || 'pro'] || MODEL_MAP['i2v']?.pro || 'veo_3_1_i2v_s_fast';

    // Use passed ref media IDs (from agent upload) or get from CharacterNodes + existing ref images on canvas
    let refMediaIds = [...(passedRefMediaIds || [])];
    
    // Collect from CharacterNodes on canvas
    const charNodes = nodesRef.current.filter(n => n.type === 'character');
    for (const cn of charNodes) {
      const nodeMediaIds = charMediaIdsRef.current[cn.id] || [];
      refMediaIds.push(...nodeMediaIds);
    }
    if (refMediaIds.length === 0 && charNodes.length > 0) {
      refMediaIds = getUpstreamMediaIds(charNodes[0].id);
    }
    
    // Collect from existing reference image nodes (👤🏞️🎭) on canvas
    const canvasRefImageNodes = nodesRef.current.filter(n => {
      if (n.type !== 'image' || !n.data.mediaId) return false;
      if (n.data.isReference === true) return true;
      const lbl = (n.data.label as string) || '';
      return lbl.startsWith('👤') || lbl.startsWith('🏞️') || lbl.startsWith('🎭');
    });
    refMediaIds.push(...canvasRefImageNodes.map(n => n.data.mediaId as string));
    
    // Deduplicate
    refMediaIds = [...new Set(refMediaIds)];

    const hasRef = refMediaIds.length > 0;
    const modeLabel = hasRef ? 'R2I → I2V' : 'T2I → I2V';

    // Step 1: Tạo PromptNode với các image prompts
    const imagePrompts = scenes.map((s: any) => s.image_prompt || s.prompt);
    const videoPromptsPerScene = scenes.map((s: any) => {
      if (s.video_prompts && Array.isArray(s.video_prompts) && s.video_prompts.length > 0) return s.video_prompts;
      if (s.video_prompt) return [s.video_prompt];
      return [s.prompt];
    });
    const allPromptText = imagePrompts.join('\n');

    // Reuse or create PromptNode to keep canvas intact
    let promptNodeId = '';
    const existingPromptNode = nodesRef.current.find(n => n.type === 'prompt');
    if (existingPromptNode) {
      promptNodeId = existingPromptNode.id;
      setNodes(nds => nds.map(n => n.id === promptNodeId ? {
        ...n,
        data: {
          ...n.data,
          prompt: n.data.prompt ? `${n.data.prompt}\n${allPromptText}` : allPromptText,
          videoPrompts: (n.data as any).videoPrompts ? [...((n.data as any).videoPrompts as string[][]), ...videoPromptsPerScene] : videoPromptsPerScene,
          useReference: hasRef || n.data.useReference,
        }
      } : n));
    } else {
      const startPos = getBatchStartPosition(nodesRef.current);
      promptNodeId = `prompt_${hasRef ? 'r2i' : 't2i'}_${Date.now()}`;
      setNodes(nds => nds.concat({
        id: promptNodeId,
        type: 'prompt',
        position: startPos,
        data: {
          prompt: allPromptText,
          videoPrompts: videoPromptsPerScene,
          aspectRatio: imgAspect,
          isGeneratingImage: false,
          useReference: hasRef,
          modeLabel,
        },
      }));

      // Connect CharacterNodes → PromptNode (R2I reference) if any
      if (charNodes.length > 0) {
        const newEdges = charNodes.map(cn => ({
          id: `e_${cn.id}_${promptNodeId}`,
          source: cn.id,
          target: promptNodeId,
          animated: true,
          style: { stroke: '#f43f5e', strokeWidth: 2, opacity: 0.7 },
        }));
        setEdges(eds => [...eds, ...newEdges]);
      }
    }

    toast.success(`📸 Pipeline ${modeLabel}: ${imagePrompts.length} ảnh → video`);

    if (!autoExecute) return { success: 0, failed: 0, total: imagePrompts.length, failedPrompts: [] };

    // Auto-execute Step 1: tạo ảnh (R2I nếu có tham chiếu, T2I nếu không)
    const emitProg = (msg: string, phase?: string, cur?: number, tot?: number) => {
      window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: msg, phase, current: cur, total: tot, timestamp: Date.now() } }));
    };
    await new Promise(r => setTimeout(r, 800));
    emitProg(`🎨 Bước 1: ${hasRef ? 'R2I' : 'T2I'} tạo ${imagePrompts.length} ảnh...`, 'images', 0, imagePrompts.length);
    toast.loading(`🎨 Bước 1: ${hasRef ? 'R2I' : 'T2I'} tạo ${imagePrompts.length} ảnh${hasRef ? ' từ tham chiếu' : ''}...`, { id: 'r2i-step' });

    const createdImages: { nodeId: string; mediaId: string; prompt: string; videoPrompts: string[]; sceneNumber: number }[] = [];
    const failedPrompts: string[] = [];
    const failedVideoPrompts: string[] = [];
    let successesSinceLastClear = 0;
    let consecutive403 = 0;
    const autoClearCache = localStorage.getItem('auto_clear_cache') !== 'false';
    let upstreamChars: { nodeId: string; name: string; mediaIds: string[]; entityId: string }[] = [];

    // Helper: create image with retry (max 9 attempts)
    const createWithRetry = async (prompt: string, label: string, refs?: string[]) => {
      const maxRetries = 8;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            emitProg(`🔄 ${label} — retry ${attempt + 1}/9 (chờ 10s)...`, 'images');
            await new Promise(r => setTimeout(r, 10000));
          }

          // Parallel coordination: wait 15s since last completed generation
          if (lastCompletionTimeRef.current > 0) {
            const elapsed = Date.now() - lastCompletionTimeRef.current;
            if (elapsed < 15000) {
              await new Promise(r => setTimeout(r, 15000 - elapsed));
            }
          }

          const res = await axios.post('/api/generate/image', {
            prompt,
            project_id: settings.flowkitProjectId,
            ...(refs && refs.length > 0 ? { reference_media_ids: refs } : {}),
            aspect_ratio: imgAspect,
          });
          if (res.data.url && res.data.media_id) {
            consecutive403 = 0; // reset
            successesSinceLastClear++;
            if (autoClearCache && successesSinceLastClear >= 50) {
              await clearCacheAndWaitForReady();
              successesSinceLastClear = 0;
            }
            return { url: res.data.url, mediaId: res.data.media_id };
          }

          // Check if response has overload/exhausted error
          const apiError = res.data.error;
          let errorText = "";
          if (typeof apiError === 'string') {
            errorText = apiError;
          } else if (apiError && typeof apiError === 'object') {
            const errObj = apiError.data?.error || apiError.error || apiError;
            errorText = errObj.message || JSON.stringify(errObj);
          }

          if (isOverloadMsg(errorText)) {
            toast.loading(`⏳ Server quá tải (Resource exhausted). Nghỉ 30s rồi thử lại ảnh...`, { id: 'r2i-step' });
            emitProg(`⏳ Server quá tải (${errorText}). Chờ 30s...`, 'images');
            await new Promise(r => setTimeout(r, 30000));
            attempt--;
            continue;
          }
        } catch (err: any) {
          const errMsg = err?.response?.data?.detail || err.message || '';
          const is403 = err?.response?.status === 403 || String(errMsg).includes('403');
          if (is403) {
            consecutive403++;
            if (consecutive403 >= 5) {
              toast('⚠️ Phát hiện lỗi 403 captcha 5 lần liên tiếp. Đang dọn cache & reload...', { id: 'r2i-step' });
              try {
                await clearCacheAndWaitForReady();
                consecutive403 = 0;
                attempt--; // retry this attempt
                continue;
              } catch (clearErr: any) {
                toast.error('Lỗi khi tự dọn cache captcha: ' + clearErr.message);
              }
            }
          } else {
            consecutive403 = 0;
          }

          if (isOverloadMsg(errMsg) || err?.response?.status === 429 || err?.response?.status === 503) {
            toast.loading(`⏳ Server quá tải (Rate limit/Exhausted). Nghỉ 30s rồi thử lại ảnh...`, { id: 'r2i-step' });
            emitProg(`⏳ Server quá tải (${errMsg}). Chờ 30s...`, 'images');
            await new Promise(r => setTimeout(r, 30000));
            attempt--;
            continue;
          }
          if (attempt === maxRetries) return null;
        }
      }
      return null;
    };

    try {
      const promptNode = nodesRef.current.find(n => n.id === promptNodeId);
      const pX = promptNode?.position?.x || existingPromptNode?.position?.x || 100;
      const pY = promptNode?.position?.y || existingPromptNode?.position?.y || 100;

      upstreamChars = charNodes.map(cn => {
        const name = (cn.data as any).charName || charEntityIdsRef.current[cn.id]?.name || 'Nhân vật';
        const mediaIds = charMediaIdsRef.current[cn.id] || [];
        const entityId = (cn.data as any).entityId || charEntityIdsRef.current[cn.id]?.entityId || '';
        return { nodeId: cn.id, name, mediaIds, entityId };
      });

      let consecutiveFailures = 0;

      for (let i = 0; i < imagePrompts.length; i++) {
        const sceneNum = scenes[i]?.number || (i + 1);
        emitProg(`🎨 Cảnh ${sceneNum}: Ảnh ${i + 1}/${imagePrompts.length}...`, 'images', i, imagePrompts.length);

        const finalPrompt = processPromptReferences(imagePrompts[i], refMediaIds, upstreamChars);
        
        // Build per-scene references including the previous scene's image for key end-frame continuity!
        const sceneRefs = hasRef ? [...refMediaIds] : [];
        if (i > 0 && createdImages[i - 1]?.mediaId) {
          sceneRefs.push(createdImages[i - 1].mediaId);
        }
        
        const result = await createWithRetry(finalPrompt, `Ảnh cảnh ${sceneNum}`, sceneRefs.length > 0 ? sceneRefs : undefined);

        lastCompletionTimeRef.current = Date.now();

        if (!result) {
          consecutiveFailures++;
          failedPrompts.push(imagePrompts[i]);

          const imageNodeId = `img_r2i_failed_${Date.now()}_${i}`;
          const visualPos = { x: pX + 320, y: pY + (sceneNum - 1) * 220 };
          const oldNodes = nodesRef.current.filter(n => n.data?.promptIndex === sceneNum && (n.type === 'image' || n.type === 'video'));
          const oldNodeIds = oldNodes.map(n => n.id);

          setNodes(nds => nds.filter(n => !oldNodeIds.includes(n.id)).concat({
            id: imageNodeId,
            type: 'image',
            position: visualPos,
            style: nodeSize(imgAspect),
            data: { imageUrl: undefined, mediaId: undefined, prompt: imagePrompts[i], videoPrompts: videoPromptsPerScene[i], aspectRatio: imgAspect, isGeneratingVideo: false, promptIndex: sceneNum, status: 'failed' },
          }));

          setEdges(eds => eds.filter(e => !oldNodeIds.includes(e.source) && !oldNodeIds.includes(e.target)).concat({
            id: `e_${promptNodeId}_${imageNodeId}`,
            source: promptNodeId,
            target: imageNodeId,
            animated: true,
            style: { stroke: '#ef4444', strokeWidth: 2, opacity: 0.7 },
          }));

          if (consecutiveFailures >= 3) {
            toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại!`);
            return {
              success: createdImages.length, failed: failedPrompts.length, total: imagePrompts.length,
              failedPrompts,
              stoppedAt: 'images',
              stoppedReason: `Vẫn còn cảnh lỗi sau 3 lần thất bại liên tiếp.`
            };
          }

          // Delay 15s on failure
          emitProg(`⏳ Thất bại, nghỉ 15s trước khi tiếp tục...`, 'images');
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }

        consecutiveFailures = 0;

        const imageNodeId = `img_r2i_${Date.now()}_${i}`;
        const visualPos = { x: pX + 320, y: pY + (sceneNum - 1) * 220 };

        // Clean up existing image or video nodes of this scene to prevent overlay/duplicates on canvas
        const oldNodes = nodesRef.current.filter(n => n.data?.promptIndex === sceneNum && (n.type === 'image' || n.type === 'video'));
        const oldNodeIds = oldNodes.map(n => n.id);

        setNodes(nds => nds.filter(n => !oldNodeIds.includes(n.id)).concat({
          id: imageNodeId,
          type: 'image',
          position: visualPos,
          style: nodeSize(imgAspect),
          data: { imageUrl: result.url, mediaId: result.mediaId, prompt: imagePrompts[i], videoPrompts: videoPromptsPerScene[i], aspectRatio: imgAspect, isGeneratingVideo: false, promptIndex: sceneNum, refMediaIds: hasRef ? refMediaIds : undefined },
        }));

        setEdges(eds => {
          let updatedEds = eds.filter(e => !oldNodeIds.includes(e.source) && !oldNodeIds.includes(e.target)).concat({
            id: `e_${promptNodeId}_${imageNodeId}`,
            source: promptNodeId,
            target: imageNodeId,
            animated: true,
            style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
          });
          if (i > 0 && createdImages[i - 1]) {
            updatedEds = updatedEds.concat({
              id: `e_keyframe_flow_img_${createdImages[i - 1].nodeId}_${imageNodeId}`,
              source: createdImages[i - 1].nodeId, target: imageNodeId,
              animated: true,
              style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
              label: 'Key End Frame',
            } as any);
          }
          return updatedEds;
        });

        createdImages.push({ nodeId: imageNodeId, mediaId: result.mediaId, prompt: imagePrompts[i], videoPrompts: videoPromptsPerScene[i] || [imagePrompts[i]], sceneNumber: sceneNum });
        addMedia({ id: result.mediaId || imageNodeId, type: 'image', filename: `agent_${sceneNum}.png`, path: result.url, url: result.url, prompt: imagePrompts[i], createdAt: new Date().toISOString(), fileSize: 0, status: 'ready' });
        emitProg(`🎨 Ảnh ${i + 1}/${imagePrompts.length} ✅`, 'images', i + 1, imagePrompts.length);

        // Success delay: wait 5s
        emitProg(`✨ Nghĩ 5s trước khi tạo tiếp...`, 'images');
        await new Promise(r => setTimeout(r, 5000));
      }

      // ── Auto-retry ảnh lỗi (tối đa 3 vòng) ──
      if (failedPrompts.length > 0) {
        const maxRetryRounds = 3;
        for (let round = 1; round <= maxRetryRounds && failedPrompts.length > 0; round++) {
          const retryCount = failedPrompts.length;
          const retryDelay = round * 3000;
          emitProg(`🔄 Auto-retry vòng ${round}: ${retryCount} ảnh lỗi...`, 'retry', 0, retryCount);
          toast.loading(`🔄 Retry vòng ${round}/${maxRetryRounds}: ${retryCount} ảnh lỗi...`, { id: 'r2i-step' });
          await new Promise(r => setTimeout(r, retryDelay));

          const stillFailed: string[] = [];
          for (let ri = 0; ri < failedPrompts.length; ri++) {
            const retryPrompt = failedPrompts[ri];
            const origIdx = imagePrompts.indexOf(retryPrompt);
            const sceneNum = scenes[origIdx]?.number || (origIdx + 1);
            emitProg(`🔄 Retry ${ri + 1}/${retryCount} (vòng ${round})...`, 'retry', ri + 1, retryCount);

            const finalPrompt = processPromptReferences(retryPrompt, refMediaIds, upstreamChars);
            const result = await createWithRetry(finalPrompt, `Retry ảnh`, hasRef ? refMediaIds : undefined);

            lastCompletionTimeRef.current = Date.now();

            if (result) {
              consecutiveFailures = 0;
              const imageNodeId = `img_r2i_retry_${Date.now()}_${ri}`;
              const visualPos = { x: pX + 320, y: pY + (sceneNum - 1) * 220 };

              // Clean up existing nodes to prevent overlay
              const oldNodes = nodesRef.current.filter(n => n.data?.promptIndex === sceneNum && (n.type === 'image' || n.type === 'video'));
              const oldNodeIds = oldNodes.map(n => n.id);

              setNodes(nds => nds.filter(n => !oldNodeIds.includes(n.id)).concat({
                id: imageNodeId, type: 'image',
                position: visualPos,
                style: nodeSize(imgAspect),
                data: { imageUrl: result.url, mediaId: result.mediaId, prompt: retryPrompt, videoPrompts: videoPromptsPerScene[origIdx], aspectRatio: imgAspect, isGeneratingVideo: false, promptIndex: sceneNum, refMediaIds: hasRef ? refMediaIds : undefined },
              }));

              setEdges(eds => {
                let updatedEds = eds.filter(e => !oldNodeIds.includes(e.source) && !oldNodeIds.includes(e.target)).concat({
                  id: `e_${promptNodeId}_${imageNodeId}`, source: promptNodeId, target: imageNodeId,
                  animated: true, style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
                });
                const prevIdx = sceneNum - 2;
                const prevImage = createdImages.find(img => img.sceneNumber === prevIdx + 1);
                if (prevImage) {
                  updatedEds = updatedEds.concat({
                    id: `e_keyframe_flow_img_${prevImage.nodeId}_${imageNodeId}`,
                    source: prevImage.nodeId, target: imageNodeId,
                    animated: true,
                    style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                    label: 'Key End Frame',
                  } as any);
                }
                return updatedEds;
              });

              createdImages.push({ nodeId: imageNodeId, mediaId: result.mediaId, prompt: retryPrompt, videoPrompts: videoPromptsPerScene[origIdx] || [retryPrompt], sceneNumber: sceneNum });
              addMedia({ id: result.mediaId, type: 'image', filename: `agent_${sceneNum}.png`, path: result.url, url: result.url, prompt: retryPrompt, createdAt: new Date().toISOString(), fileSize: 0, status: 'ready' });
              toast.success(`✅ Retry ảnh ${sceneNum} thành công!`);

              // Delay 5s
              await new Promise(r => setTimeout(r, 5000));
            } else {
              consecutiveFailures++;
              stillFailed.push(retryPrompt);

              if (consecutiveFailures >= 3) {
                toast.dismiss('r2i-step');
                toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại!`);
                return {
                  success: createdImages.length, failed: failedPrompts.length, total: imagePrompts.length,
                  failedPrompts,
                  stoppedAt: 'images',
                  stoppedReason: `Vẫn còn cảnh lỗi sau 3 lần thất bại liên tiếp.`
                };
              }

              // Delay 15s
              await new Promise(r => setTimeout(r, 15000));
            }
          }
          failedPrompts.length = 0;
          failedPrompts.push(...stillFailed);
          if (failedPrompts.length === 0) {
            toast.success(`✅ Auto-retry thành công! Tất cả ảnh đã tạo xong.`);
            break;
          }
        }
      }

      toast.dismiss('r2i-step');
      emitProg(`✅ ${createdImages.length}/${imagePrompts.length} ảnh hoàn thành → Tạo video...`, 'checkpoint');
      toast.success(`✅ ${hasRef ? 'R2I' : 'T2I'}: ${createdImages.length}/${imagePrompts.length} ảnh tạo xong!`);
    } catch (err) {
      toast.dismiss('r2i-step');
      toast.error('Lỗi R2I');
      return { success: 0, failed: imagePrompts.length, total: imagePrompts.length, failedPrompts: imagePrompts };
    }

    // CHECKPOINT: nếu vẫn thiếu ảnh sau retry → BẮT BUỘC DỪNG luồng tạo video
    if (failedPrompts.length > 0) {
      emitProg(`🛑 Dừng luồng: Có ${failedPrompts.length} ảnh cảnh bị lỗi sau retry — không tạo video.`, 'done');
      toast.error(`❌ Vẫn còn ${failedPrompts.length} ảnh cảnh lỗi sau retry. Dừng pipeline tạo video để tránh lỗi.`, { duration: 8000 });
      return {
        success: createdImages.length, failed: failedPrompts.length, total: imagePrompts.length,
        failedPrompts,
        stoppedAt: 'images',
        stoppedReason: `Vẫn còn ${failedPrompts.length} ảnh cảnh lỗi sau retry.\n\n👉 Vui lòng sửa lại prompt hoặc liên hệ hỗ trợ Zalo.`,
      };
    }

    if (createdImages.length === 0) {
      return { success: 0, failed: failedPrompts.length, total: imagePrompts.length, failedPrompts };
    }

    // Auto-execute Step 2: I2V — animate ảnh thành video TUẦN TỰ (chờ từng video xong)
    await new Promise(r => setTimeout(r, 5000));
    const totalVids = createdImages.reduce((sum, img) => sum + (img.videoPrompts?.length || 1), 0);
    emitProg(`🎬 Bước 2: I2V animate ${totalVids} video từ ${createdImages.length} ảnh...`, 'videos', 0, totalVids);
    toast.loading(`🎬 Bước 2: I2V animate ${totalVids} video tuần tự...`, { id: 'i2v-step' });

    // Helper: poll job status until DONE/FAILED or timeout
    const waitForJob = async (jobId: string, label: string, timeoutMs = 180000): Promise<string> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const res = await axios.get(`/api/generate/jobs/${jobId}`);
          const status = res.data.status;
          if (status === 'DONE' || status === 'FAILED') {
            return status;
          }
          emitProg(`⏳ ${label} đang render...`, 'videos');
        } catch (err: any) {
          const errMsg = err?.response?.data?.detail || err.message || '';
          if (isOverloadMsg(errMsg) || err?.response?.status === 429 || err?.response?.status === 503) {
            await new Promise(r => setTimeout(r, 10000));
            continue;
          }
        }
        await new Promise(r => setTimeout(r, 5000)); // poll every 5s
      }
      return 'TIMEOUT';
    };

    let vidCount = 0;
    try {
      let consecutiveFailures = 0;
      const createdVideoNodeIds: Record<number, string> = {};
      for (const img of createdImages) {
        const prompts = img.videoPrompts || [img.prompt];
        const narration = scenes.find((s: any) => s.number === img.sceneNumber || s.sceneNumber === img.sceneNumber)?.narration || '';
        // Mark image as generating video
        setNodes(nds => nds.map(n => n.id === img.nodeId ? { ...n, data: { ...n.data, isGeneratingVideo: true } } : n));

        for (let vIdx = 0; vIdx < prompts.length; vIdx++) {
          const failedVidNode = nodesRef.current.find(n => 
            n.type === 'video' && 
            n.data?.promptIndex === img.sceneNumber && 
            (n.data?.status === 'failed' || (n.data?.videoUrl === undefined && !n.data?.isGeneratingVideo))
          );

          let vPrompt = prompts[vIdx];
          if (failedVidNode && failedVidNode.data?.prompt) {
            vPrompt = (failedVidNode.data.prompt as string) || '';
          }

          vidCount++;
          const label = `Video ${img.sceneNumber}`;
          emitProg(`🎬 ${label} đang gửi yêu cầu...`, 'videos', vidCount, totalVids);
          toast.loading(`🎬 ${label} đang tạo...`, { id: 'i2v-step' });
          
          const imgNode = nodesRef.current.find(n => n.id === img.nodeId);
          const parentX = imgNode?.position?.x ?? (300 + 280);
          const parentY = imgNode?.position?.y ?? (350 + img.sceneNumber * 240);
          const vidPos = failedVidNode?.position || {
            x: parentX + 350,
            y: parentY + vIdx * 280,
          };

          let jobId = '';
          let frameUrl = '';
          let submitRetries = 8; // 9 attempts total

          for (let attempt = 0; attempt <= submitRetries; attempt++) {
            try {
              if (attempt > 0) {
                toast.loading(`⏳ Thử lại video ${label} lần ${attempt + 1}/9 (chờ 10s)...`, { id: 'i2v-step' });
                await new Promise(r => setTimeout(r, 10000));
              }

              // Parallel coordination check
              if (lastCompletionTimeRef.current > 0) {
                const elapsed = Date.now() - lastCompletionTimeRef.current;
                if (elapsed < 15000) {
                  await new Promise(r => setTimeout(r, 15000 - elapsed));
                }
              }
              const finalVideoPrompt = processPromptReferences(vPrompt, refMediaIds, upstreamChars);
              const res = await axios.post('/api/generate/video', {
                prompt: finalVideoPrompt,
                project_id: settings.flowkitProjectId,
                video_model: vidModel,
                aspect_ratio: vidAspect,
                start_image_media_id: img.mediaId,
              });

              if (res.data?.success && res.data?.job_id) {
                jobId = res.data.job_id;
                frameUrl = res.data.frame_url;
                consecutive403 = 0; // reset
                break;
              }

              const apiError = res.data?.error;
              let errorText = "";
              if (typeof apiError === 'string') {
                errorText = apiError;
              } else if (apiError && typeof apiError === 'object') {
                const errObj = apiError.data?.error || apiError.error || apiError;
                errorText = errObj.message || JSON.stringify(errObj);
              }

              if (isOverloadMsg(errorText)) {
                toast.loading(`⏳ Server quá tải (Resource exhausted). Nghỉ 30s rồi thử lại video...`, { id: 'i2v-step' });
                await new Promise(r => setTimeout(r, 30000));
                attempt--;
                continue;
              }
            } catch (err: any) {
              const errMsg = err?.response?.data?.detail || err.message || '';
              const is403 = err?.response?.status === 403 || String(errMsg).includes('403');
              if (is403) {
                consecutive403++;
                if (consecutive403 >= 5) {
                  toast('⚠️ Phát hiện lỗi 403 captcha 5 lần liên tiếp. Đang dọn cache & reload...', { id: 'i2v-step' });
                  try {
                    await clearCacheAndWaitForReady();
                    consecutive403 = 0;
                    attempt--; // retry this attempt
                    continue;
                  } catch (clearErr: any) {
                    toast.error('Lỗi khi tự dọn cache captcha: ' + clearErr.message);
                  }
                }
              } else {
                consecutive403 = 0;
              }

              if (isOverloadMsg(errMsg) || err?.response?.status === 429 || err?.response?.status === 503) {
                toast.loading(`⏳ Server quá tải (Rate limit/Exhausted). Nghỉ 30s rồi thử lại video...`, { id: 'i2v-step' });
                await new Promise(r => setTimeout(r, 30000));
                attempt--;
                continue;
              }
              if (attempt === submitRetries) {
                // Keep jobId empty
              }
            }
          }

          lastCompletionTimeRef.current = Date.now();

          if (jobId) {
            const videoNodeId = `vid_story_${Date.now()}_${img.nodeId}_v${vIdx}`;
            try {
              const oldVidNodes = nodesRef.current.filter(n => n.data?.promptIndex === img.sceneNumber && n.type === 'video');
              const oldVidNodeIds = oldVidNodes.map(n => n.id);

              setNodes(nds => nds.filter(n => !oldVidNodeIds.includes(n.id)).concat({
                id: videoNodeId,
                type: 'video',
                position: vidPos,
                style: { width: 240, height: 220 },
                data: { jobId, prompt: vPrompt, narration, frameUrl, aspectRatio: vidAspect, isGeneratingVideo: true, promptIndex: img.sceneNumber },
              }));

              if (vIdx === 0) {
                createdVideoNodeIds[img.sceneNumber] = videoNodeId;
              }
              setEdges(eds => {
                let updatedEds = eds.filter(e => !oldVidNodeIds.includes(e.source) && !oldVidNodeIds.includes(e.target)).concat({
                  id: `e_${img.nodeId}_${videoNodeId}`,
                  source: img.nodeId,
                  target: videoNodeId,
                  animated: true,
                  style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
                });
                
                // Reconnect keyframe flow: prev video -> current image
                if (img.sceneNumber > 1 && vIdx === 0) {
                  const prevVidNode = nodesRef.current.find(n => n.type === 'video' && n.data?.promptIndex === img.sceneNumber - 1);
                  if (prevVidNode) {
                    updatedEds = updatedEds.filter(e => e.id !== `e_keyframe_flow_img_${createdImages[img.sceneNumber - 2]?.nodeId}_${img.nodeId}`);
                    updatedEds = updatedEds.concat({
                      id: `e_keyframe_flow_${prevVidNode.id}_${img.nodeId}`,
                      source: prevVidNode.id, target: img.nodeId,
                      animated: true,
                      style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                      label: 'Key End Frame',
                    } as any);
                  }
                }
                
                // Reconnect keyframe flow: current video -> next image
                const nextImgNode = nodesRef.current.find(n => n.type === 'image' && n.data?.promptIndex === img.sceneNumber + 1);
                if (nextImgNode && vIdx === 0) {
                  updatedEds = updatedEds.filter(e => e.target !== nextImgNode.id || !e.id.includes('keyframe'));
                  updatedEds = updatedEds.concat({
                    id: `e_keyframe_flow_${videoNodeId}_${nextImgNode.id}`,
                    source: videoNodeId, target: nextImgNode.id,
                    animated: true,
                    style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                    label: 'Key End Frame',
                  } as any);
                }
                return updatedEds;
              });
              
              emitProg(`⏳ ${label} đang render trên Google...`, 'videos', vidCount, totalVids);
              toast.loading(`⏳ ${label} đang render...`, { id: 'i2v-step' });

              // Wait for this video to complete before starting next one
              const status = await waitForJob(jobId, label);
              lastCompletionTimeRef.current = Date.now();

              if (status === 'DONE') {
                consecutiveFailures = 0;
                successesSinceLastClear++;
                emitProg(`✅ ${label} hoàn thành!`, 'videos', vidCount, totalVids);
                toast.success(`✅ ${label} xong!`);

                if (autoClearCache && successesSinceLastClear >= 50) {
                  await clearCacheAndWaitForReady();
                  successesSinceLastClear = 0;
                }

                // Delay 5s after success
                await new Promise(r => setTimeout(r, 5000));
              } else {
                // FAILED or TIMEOUT
                consecutiveFailures++;
                failedVideoPrompts.push(vPrompt);
                emitProg(`❌ ${label} ${status === 'FAILED' ? 'thất bại' : 'quá hạn'}`, 'videos', vidCount, totalVids);
                toast.error(`❌ ${label} ${status === 'FAILED' ? 'thất bại' : 'quá hạn'}`);

                setNodes(nds => nds.map(n => n.id === videoNodeId ? { ...n, data: { ...n.data, isGeneratingVideo: false, status: 'failed' } } : n));

                if (consecutiveFailures >= 3) {
                  toast.dismiss('i2v-step');
                  toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại!`);
                  const remainingVideoPrompts: string[] = [];
                  remainingVideoPrompts.push(...prompts.slice(vIdx + 1));
                  for (let k = createdImages.indexOf(img) + 1; k < createdImages.length; k++) {
                    remainingVideoPrompts.push(...(createdImages[k].videoPrompts || [createdImages[k].prompt]));
                  }
                  return {
                    success: createdImages.length + vidCount - failedVideoPrompts.length - remainingVideoPrompts.length - 1,
                    failed: failedPrompts.length + failedVideoPrompts.length + remainingVideoPrompts.length,
                    total: imagePrompts.length + totalVids,
                    failedPrompts: [...failedPrompts, ...failedVideoPrompts, ...remainingVideoPrompts],
                    stoppedAt: 'videos',
                    stoppedReason: `3 prompt video liên tiếp thất bại.`
                  };
                }

                // Delay 15s on failure
                await new Promise(r => setTimeout(r, 15000));
              }
            } catch (err: any) {
              consecutiveFailures++;
              failedVideoPrompts.push(vPrompt);
              setNodes(nds => nds.map(n => n.id === img.nodeId ? { ...n, data: { ...n.data, isGeneratingVideo: false } } : n));
              setNodes(nds => nds.map(n => n.id === videoNodeId ? { ...n, data: { ...n.data, isGeneratingVideo: false, status: 'failed' } } : n));
              const errMsg = err?.response?.data?.detail || err.message;
              toast.error(`I2V lỗi: ${errMsg}`);
              
              if (consecutiveFailures >= 3) {
                toast.dismiss('i2v-step');
                const remainingVideoPrompts: string[] = [];
                remainingVideoPrompts.push(...prompts.slice(vIdx + 1));
                for (let k = createdImages.indexOf(img) + 1; k < createdImages.length; k++) {
                  remainingVideoPrompts.push(...(createdImages[k].videoPrompts || [createdImages[k].prompt]));
                }
                return {
                  success: createdImages.length + vidCount - failedVideoPrompts.length - remainingVideoPrompts.length - 1,
                  failed: failedPrompts.length + failedVideoPrompts.length + remainingVideoPrompts.length,
                  total: imagePrompts.length + totalVids,
                  failedPrompts: [...failedPrompts, ...failedVideoPrompts, ...remainingVideoPrompts],
                  stoppedAt: 'videos',
                  stoppedReason: `${label} lỗi: ${errMsg}`
                };
              }

              await new Promise(r => setTimeout(r, 15000));
            }
          } else {
            consecutiveFailures++;
            failedVideoPrompts.push(vPrompt);
            setNodes(nds => nds.map(n => n.id === img.nodeId ? { ...n, data: { ...n.data, isGeneratingVideo: false } } : n));
            toast.error(`❌ Gửi ${label} thất bại sau 9 lần thử`);

            // Create a failed VideoNode so the user can see it and retry it!
            const videoNodeId = `vid_story_failed_${Date.now()}_${img.nodeId}_v${vIdx}`;
            
            // Clean up any old video nodes with same promptIndex
            const oldVidNodes = nodesRef.current.filter(n => n.data?.promptIndex === img.sceneNumber && n.type === 'video');
            const oldVidNodeIds = oldVidNodes.map(n => n.id);

            setNodes(nds => nds.filter(n => !oldVidNodeIds.includes(n.id)).concat({
              id: videoNodeId,
              type: 'video',
              position: vidPos,
              style: { width: 240, height: 220 },
              data: { jobId: undefined, prompt: vPrompt, narration, frameUrl: imgNode?.data.imageUrl || undefined, aspectRatio: vidAspect, isGeneratingVideo: false, promptIndex: img.sceneNumber, status: 'failed' },
            }));

            setEdges(eds => eds.filter(e => !oldVidNodeIds.includes(e.source) && !oldVidNodeIds.includes(e.target)).concat({
              id: `e_${img.nodeId}_${videoNodeId}`,
              source: img.nodeId,
              target: videoNodeId,
              animated: true,
              style: { stroke: '#ef4444', strokeWidth: 2, opacity: 0.7 },
            }));

            // Reconnect keyframe flow: prev video -> current image
            if (img.sceneNumber > 1 && vIdx === 0) {
              const prevVidNode = nodesRef.current.find(n => n.type === 'video' && n.data?.promptIndex === img.sceneNumber - 1);
              if (prevVidNode) {
                setEdges(eds => eds.filter(e => e.id !== `e_keyframe_flow_img_${createdImages[img.sceneNumber - 2]?.nodeId}_${img.nodeId}`).concat({
                  id: `e_keyframe_flow_${prevVidNode.id}_${img.nodeId}`,
                  source: prevVidNode.id, target: img.nodeId,
                  animated: true,
                  style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                  label: 'Key End Frame',
                } as any));
              }
            }

            // Reconnect keyframe flow: current video -> next image
            const nextImgNode = nodesRef.current.find(n => n.type === 'image' && n.data?.promptIndex === img.sceneNumber + 1);
            if (nextImgNode && vIdx === 0) {
              setEdges(eds => eds.filter(e => e.target !== nextImgNode.id || !e.id.includes('keyframe')).concat({
                id: `e_keyframe_flow_${videoNodeId}_${nextImgNode.id}`,
                source: videoNodeId, target: nextImgNode.id,
                animated: true,
                style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                label: 'Key End Frame',
              } as any));
            }

            if (consecutiveFailures >= 3) {
              toast.dismiss('i2v-step');
              const remainingVideoPrompts: string[] = [];
              remainingVideoPrompts.push(...prompts.slice(vIdx + 1));
              for (let k = createdImages.indexOf(img) + 1; k < createdImages.length; k++) {
                remainingVideoPrompts.push(...(createdImages[k].videoPrompts || [createdImages[k].prompt]));
              }
              return {
                success: createdImages.length + vidCount - failedVideoPrompts.length - remainingVideoPrompts.length - 1,
                failed: failedPrompts.length + failedVideoPrompts.length + remainingVideoPrompts.length,
                total: imagePrompts.length + totalVids,
                failedPrompts: [...failedPrompts, ...failedVideoPrompts, ...remainingVideoPrompts],
                stoppedAt: 'videos',
                stoppedReason: `${label} gửi thất bại`
              };
            }

            await new Promise(r => setTimeout(r, 15000));
          }
        }
      }

      toast.dismiss('i2v-step');
      toast.success(`✅ I2V hoàn thành: ${vidCount} video!`);
    } catch (err) {
      toast.dismiss('i2v-step');
      toast.error('Lỗi I2V');
    }
    const hasVideos = autoExecute && createdImages.length > 0;
    const finalFailedPrompts = [...failedPrompts, ...failedVideoPrompts];
    return {
      success: createdImages.length + vidCount - failedVideoPrompts.length,
      failed: finalFailedPrompts.length,
      total: imagePrompts.length + totalVids,
      failedPrompts: finalFailedPrompts,
      hasVideos
    };
  }, [setNodes, setEdges, settings.flowkitProjectId, getUpstreamMediaIds, nodesRef]);

  // Agent: T2V Direct Pipeline — Create PromptNode connected directly to VideoNodes (NO images!)
  const agentT2VPipeline = useCallback(async (scenes: any[], autoExecute: boolean, modelTier?: string, aspectRatio?: string) => {
    const vidAspect = ASPECT_MAP[aspectRatio || '16:9'] || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
    const vidModel = MODEL_MAP['t2v']?.[modelTier || 'pro'] || MODEL_MAP['t2v']?.pro || 'veo_3_1_t2v_fast';

    const prompts = scenes.map((s: any) => {
      if (s.video_prompts && Array.isArray(s.video_prompts) && s.video_prompts.length > 0) return s.video_prompts[0];
      if (s.video_prompt) return s.video_prompt;
      return s.prompt || s.image_prompt;
    });
    const allPromptText = prompts.join('\n');

    const startPos = getBatchStartPosition(nodesRef.current);
    const pX = startPos.x;
    const pY = startPos.y;

    // Reuse or create PromptNode to keep canvas intact
    let promptNodeId = '';
    const existingPromptNode = nodesRef.current.find(n => n.type === 'prompt');
    if (existingPromptNode) {
      promptNodeId = existingPromptNode.id;
      setNodes(nds => nds.map(n => n.id === promptNodeId ? {
        ...n,
        data: {
          ...n.data,
          prompt: n.data.prompt ? `${n.data.prompt}\n${allPromptText}` : allPromptText,
        }
      } : n));
    } else {
      promptNodeId = `prompt_t2v_${Date.now()}`;
      setNodes(nds => nds.concat({
        id: promptNodeId,
        type: 'prompt',
        position: { x: pX, y: pY },
        data: {
          prompt: allPromptText,
          aspectRatio: '16:9',
          isGeneratingImage: false,
          useReference: false,
          modeLabel: 'T2V Direct',
        },
      }));
    }

    toast.success(`🎬 T2V Direct: ${prompts.length} video từ văn bản`);

    if (!autoExecute) return { success: 0, failed: 0, total: prompts.length, failedPrompts: [] };

    const emitProg = (msg: string, phase?: string, cur?: number, tot?: number) => {
      window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: msg, phase, current: cur, total: tot, timestamp: Date.now() } }));
    };
    await new Promise(r => setTimeout(r, 800));
    emitProg(`🎬 Khởi tạo tạo ${prompts.length} video T2V...`, 'videos', 0, prompts.length);
    toast.loading(`🎬 Đang tạo ${prompts.length} video T2V trực tiếp...`, { id: 't2v-step' });

    const waitForJob = async (jobId: string, label: string, timeoutMs = 180000): Promise<string> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const res = await axios.get(`/api/generate/jobs/${jobId}`);
          const status = res.data.status;
          if (status === 'DONE' || status === 'FAILED') return status;
          emitProg(`⏳ ${label} đang render...`, 'videos');
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

    const autoClearCache = localStorage.getItem('auto_clear_cache') !== 'false';
    const failedT2VPrompts: string[] = [];
    let successesSinceLastClear = 0;
    let consecutive403 = 0;

    try {
      const createdVideoNodeIds: Record<number, string> = {};
      let consecutiveFailures = 0;
      
      for (let i = 0; i < prompts.length; i++) {
        const sceneNum = scenes[i]?.number || scenes[i]?.sceneNumber || (i + 1);
        
        // Find failed video node on canvas
        const failedVidNode = nodesRef.current.find(n => 
          n.type === 'video' && 
          n.data?.promptIndex === sceneNum && 
          (n.data?.status === 'failed' || (n.data?.videoUrl === undefined && !n.data?.isGeneratingVideo))
        );

        let vPrompt = prompts[i];
        if (failedVidNode && failedVidNode.data?.prompt) {
          vPrompt = failedVidNode.data.prompt; // Use exact prompt of that failed video node!
        }

        const label = `Video ${i + 1}/${prompts.length}`;
        emitProg(`🎬 ${label} đang gửi yêu cầu T2V...`, 'videos', i + 1, prompts.length);
        toast.loading(`🎬 ${label} đang gửi...`, { id: 't2v-step' });

        // Submission with auto-retry of 9 times total spaced by 10s
        let jobId = '';
        let frameUrl = '';
        let submitRetries = 8; // 9 attempts total

        for (let attempt = 0; attempt <= submitRetries; attempt++) {
          try {
            if (attempt > 0) {
              emitProg(`⏳ Thử lại gửi ${label} lần ${attempt + 1}/9 (chờ 10s)...`, 'videos');
              await new Promise(r => setTimeout(r, 10000));
            }

            // Parallel coordination check
            if (lastCompletionTimeRef.current > 0) {
              const elapsed = Date.now() - lastCompletionTimeRef.current;
              if (elapsed < 15000) {
                await new Promise(r => setTimeout(r, 15000 - elapsed));
              }
            }

            const res = await axios.post('/api/generate/video', {
              prompt: vPrompt,
              project_id: settings.flowkitProjectId,
              video_model: vidModel,
              aspect_ratio: vidAspect,
            });
            jobId = res.data.job_id;
            frameUrl = res.data.frame_url;
            if (jobId) {
              consecutive403 = 0; // reset
              break;
            }

            const apiError = res.data?.error;
            let errorText = "";
            if (typeof apiError === 'string') {
              errorText = apiError;
            } else if (apiError && typeof apiError === 'object') {
              const errObj = apiError.data?.error || apiError.error || apiError;
              errorText = errObj.message || JSON.stringify(errObj);
            }

            if (isOverloadMsg(errorText)) {
              toast.loading(`⏳ Server quá tải (Resource exhausted). Nghỉ 30s rồi thử lại video...`, { id: 't2v-step' });
              await new Promise(r => setTimeout(r, 30000));
              attempt--;
              continue;
            }
          } catch (err: any) {
            const errMsg = err?.response?.data?.detail || err.message || '';
            const is403 = err?.response?.status === 403 || String(errMsg).includes('403');
            if (is403) {
              consecutive403++;
              if (consecutive403 >= 5) {
                toast('⚠️ Phát hiện lỗi 403 captcha 5 lần liên tiếp. Đang dọn cache & reload...', { id: 't2v-step' });
                try {
                  await clearCacheAndWaitForReady();
                  consecutive403 = 0;
                  attempt--; // retry this attempt
                  continue;
                } catch (clearErr: any) {
                  toast.error('Lỗi khi tự dọn cache captcha: ' + clearErr.message);
                }
              }
            } else {
              consecutive403 = 0;
            }

            if (isOverloadMsg(errMsg) || err?.response?.status === 429 || err?.response?.status === 503) {
              toast.loading(`⏳ Server quá tải (Rate limit/Exhausted). Nghỉ 30s rồi thử lại video...`, { id: 't2v-step' });
              await new Promise(r => setTimeout(r, 30000));
              attempt--;
              continue;
            }
            if (attempt === submitRetries) {
              // Ignore to let fail flow trigger
            }
          }
        }

        lastCompletionTimeRef.current = Date.now();

        if (jobId) {
          const videoNodeId = `vid_t2v_${Date.now()}_${i}`;
          const narration = scenes[i]?.narration || '';
          
          if (failedVidNode) {
            // Delete old failed node and replace it in the nodes array (preserving position)
            setNodes(nds => nds.filter(n => n.id !== failedVidNode.id).concat({
              id: videoNodeId,
              type: 'video',
              position: failedVidNode.position || { x: pX + 380, y: pY + (sceneNum - 1) * 260 },
              style: { width: 280, height: 240 },
              data: { jobId, prompt: vPrompt, narration, frameUrl, aspectRatio: vidAspect, isGeneratingVideo: true, promptIndex: sceneNum },
            }));
            
            // Delete old edges of failed node and connect prompt -> video
            setEdges(eds => {
              let updatedEds = eds.filter(e => e.source !== failedVidNode.id && e.target !== failedVidNode.id).concat({
                id: `e_${promptNodeId}_${videoNodeId}`,
                source: promptNodeId,
                target: videoNodeId,
                animated: true,
                style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
              });
              
              // Reconnect keyframe flow: prev -> new video
              const prevVidNode = nodesRef.current.find(n => n.type === 'video' && n.data?.promptIndex === sceneNum - 1);
              if (prevVidNode) {
                updatedEds = updatedEds.concat({
                  id: `e_keyframe_flow_${prevVidNode.id}_${videoNodeId}`,
                  source: prevVidNode.id, target: videoNodeId,
                  animated: true,
                  style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                  label: 'Key End Frame',
                } as any);
              }
              // Reconnect keyframe flow: new video -> next
              const nextVidNode = nodesRef.current.find(n => n.type === 'video' && n.data?.promptIndex === sceneNum + 1);
              if (nextVidNode) {
                updatedEds = updatedEds.filter(e => e.target !== nextVidNode.id || !e.id.includes('keyframe'));
                updatedEds = updatedEds.concat({
                  id: `e_keyframe_flow_${videoNodeId}_${nextVidNode.id}`,
                  source: videoNodeId, target: nextVidNode.id,
                  animated: true,
                  style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                  label: 'Key End Frame',
                } as any);
              }
              return updatedEds;
            });
          } else {
            setNodes(nds => nds.concat({
              id: videoNodeId,
              type: 'video',
              position: { x: pX + 380, y: pY + (sceneNum - 1) * 260 },
              style: { width: 280, height: 240 },
              data: { jobId, prompt: vPrompt, narration, frameUrl, aspectRatio: vidAspect, isGeneratingVideo: true, promptIndex: sceneNum },
            }));
            
            setEdges(eds => {
              let updatedEds = eds.concat({
                id: `e_${promptNodeId}_${videoNodeId}`,
                source: promptNodeId,
                target: videoNodeId,
                animated: true,
                style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
              });
              if (i > 0) {
                const prevVidNodeId = createdVideoNodeIds[i - 1];
                if (prevVidNodeId) {
                  updatedEds = updatedEds.concat({
                    id: `e_keyframe_flow_${prevVidNodeId}_${videoNodeId}`,
                    source: prevVidNodeId, target: videoNodeId,
                    animated: true,
                    style: { stroke: '#fbbf24', strokeWidth: 2, strokeDasharray: '5,5', opacity: 0.8 },
                    label: 'Key End Frame',
                  } as any);
                }
              }
              return updatedEds;
            });
          }
          createdVideoNodeIds[i] = videoNodeId;

          emitProg(`⏳ ${label} đang render trên Google...`, 'videos', i + 1, prompts.length);
          toast.loading(`⏳ ${label} đang render...`, { id: 't2v-step' });

          // Wait for this video to complete before starting next one
          const status = await waitForJob(jobId, label);
          lastCompletionTimeRef.current = Date.now();

          if (status === 'DONE') {
            consecutiveFailures = 0;
            successesSinceLastClear++;
            emitProg(`✅ ${label} hoàn thành!`, 'videos', i + 1, prompts.length);
            toast.success(`✅ ${label} xong!`);

            if (autoClearCache && successesSinceLastClear >= 50) {
              await clearCacheAndWaitForReady();
              successesSinceLastClear = 0;
            }

            // Delay 5s after success
            await new Promise(r => setTimeout(r, 5000));
          } else {
            // FAILED or TIMEOUT
            consecutiveFailures++;
            failedT2VPrompts.push(vPrompt);
            emitProg(`❌ ${label} thất bại`, 'videos', i + 1, prompts.length);
            toast.error(`❌ ${label} thất bại`);

            setNodes(nds => nds.map(n => n.id === videoNodeId ? { ...n, data: { ...n.data, isGeneratingVideo: false, status: 'failed' } } : n));

            if (consecutiveFailures >= 3) {
              toast.dismiss('t2v-step');
              toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại!`);
              return { success: i, failed: prompts.length - i, total: prompts.length, failedPrompts: failedT2VPrompts.concat(prompts.slice(i + 1)) };
            }

            // Delay 15s on failure
            await new Promise(r => setTimeout(r, 15000));
          }
        } else {
          consecutiveFailures++;
          failedT2VPrompts.push(vPrompt);
          toast.error(`❌ ${label} thất bại khi gửi sau 9 lần thử`);

          const videoNodeId = `vid_t2v_failed_${Date.now()}_${i}`;
          const narration = scenes[i]?.narration || '';
          
          if (failedVidNode) {
            setNodes(nds => nds.filter(n => n.id !== failedVidNode.id).concat({
              id: videoNodeId,
              type: 'video',
              position: failedVidNode.position || { x: pX + 380, y: pY + (sceneNum - 1) * 260 },
              style: { width: 280, height: 240 },
              data: { jobId: undefined, prompt: vPrompt, narration, frameUrl: undefined, aspectRatio: vidAspect, isGeneratingVideo: false, promptIndex: sceneNum, status: 'failed' },
            }));
            
            setEdges(eds => eds.filter(e => e.source !== failedVidNode.id && e.target !== failedVidNode.id).concat({
              id: `e_${promptNodeId}_${videoNodeId}`,
              source: promptNodeId,
              target: videoNodeId,
              animated: true,
              style: { stroke: '#ef4444', strokeWidth: 2, opacity: 0.7 },
            }));
          } else {
            setNodes(nds => nds.concat({
              id: videoNodeId,
              type: 'video',
              position: { x: pX + 380, y: pY + (sceneNum - 1) * 260 },
              style: { width: 280, height: 240 },
              data: { jobId: undefined, prompt: vPrompt, narration, frameUrl: undefined, aspectRatio: vidAspect, isGeneratingVideo: false, promptIndex: sceneNum, status: 'failed' },
            }));

            setEdges(eds => eds.concat({
              id: `e_${promptNodeId}_${videoNodeId}`,
              source: promptNodeId,
              target: videoNodeId,
              animated: true,
              style: { stroke: '#ef4444', strokeWidth: 2, opacity: 0.7 },
            }));
          }

          if (consecutiveFailures >= 3) {
            toast.dismiss('t2v-step');
            toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại!`);
            return { success: i, failed: prompts.length - i, total: prompts.length, failedPrompts: failedT2VPrompts.concat(prompts.slice(i + 1)) };
          }

          // Delay 15s on failure
          await new Promise(r => setTimeout(r, 15000));
        }
      }
      toast.dismiss('t2v-step');
      toast.success('✅ T2V hoàn thành!');
    } catch (err: any) {
      toast.dismiss('t2v-step');
      toast.error('Lỗi T2V: ' + err.message);
    }
    return {
      success: prompts.length - failedT2VPrompts.length,
      failed: failedT2VPrompts.length,
      total: prompts.length,
      failedPrompts: failedT2VPrompts,
      hasVideos: true
    };
  }, [setNodes, setEdges, settings.flowkitProjectId, clearCacheAndWaitForReady]);

  // Agent: Generate images only (batch T2I or R2I) — NO auto video
  // Agent: Generate images only (batch T2I or R2I) — NO auto video
  const agentGenerateImages = useCallback(async (imagePromptsOrScenes: (string | any)[], autoExecute: boolean, useReference: boolean = false, aspectRatio?: string, passedRefMediaIds?: string[]) => {
    const imagePrompts = imagePromptsOrScenes.map(item => typeof item === 'string' ? item : (item.prompt || item.image_prompt || ''));
    const scenesList = imagePromptsOrScenes.map((item, idx) => typeof item === 'string' ? { number: idx + 1, prompt: item } : item);
    const allPromptText = imagePrompts.join('\n');
    const imgAspect = IMG_ASPECT_MAP[aspectRatio || '16:9'] || 'IMAGE_ASPECT_RATIO_LANDSCAPE';

    const startPos = getBatchStartPosition(nodesRef.current);

    // Create 1 PromptNode with all prompts
    const nodeId = `prompt_imgs_${Date.now()}`;
    setNodes(nds => nds.concat({
      id: nodeId,
      type: 'prompt',
      position: startPos,
      data: {
        prompt: allPromptText,
        aspectRatio: imgAspect,
        isGeneratingImage: false,
      },
    }));

    // R2I: Auto-connect to existing CharacterNodes for reference
    if (useReference) {
      const charNodes = nodesRef.current.filter(n => n.type === 'character');
      if (charNodes.length > 0) {
        // Connect all character nodes to this prompt node
        const newEdges = charNodes.map(cn => ({
          id: `e_${cn.id}_${nodeId}`,
          source: cn.id,
          target: nodeId,
          animated: true,
          style: { stroke: '#f43f5e', strokeWidth: 2, opacity: 0.7 },
        }));
        setEdges(eds => [...eds, ...newEdges]);
        toast.success(`R2I: Nối ${charNodes.length} nhân vật → PromptNode — ${imagePrompts.length} prompt`);
      } else if (!passedRefMediaIds?.length) {
        toast.error('⚠️ R2I cần ảnh tham chiếu! Tải ảnh lên hoặc tạo nhân vật trước');
        return;
      } else {
        toast.success(`R2I: ${passedRefMediaIds.length} ảnh tham chiếu → ${imagePrompts.length} prompt`);
      }
    } else {
      toast.success(`Tạo PromptNode T2I — ${imagePrompts.length} prompt ảnh`);
    }

    if (autoExecute) {
      await new Promise(r => setTimeout(r, 800));
      window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: `🎨 Tạo ${imagePrompts.length} ảnh ${useReference ? '(R2I)' : '(T2I)'}...`, phase: 'images', current: 0, total: imagePrompts.length, timestamp: Date.now() } }));
      toast.loading(`🎨 Tạo ${imagePrompts.length} ảnh ${useReference ? '(R2I)' : '(T2I)'}...`, { id: 'gen-images' });
      const failedPrompts: string[] = [];
      try {
        const node = nodesRef.current.find(n => n.id === nodeId);
        if (node) {
          const refMediaIds = useReference ? (passedRefMediaIds?.length ? passedRefMediaIds : getUpstreamMediaIds(nodeId)) : [];
          const upstreamChars = getUpstreamCharacterNodes(nodeId);
          const nX = node.position?.x || 300;
          const nY = node.position?.y || 100;
          const { imagePositions } = pipelineLayout(nX, nY, imagePrompts.length, false);
          let successCount = 0;
          let consecutiveFailures = 0;

          // Helper: create image with retry (max 9 attempts)
          const createWithRetry = async (prompt: string, label: string, refs?: string[], maxR?: number) => {
            const maxRetries = maxR !== undefined ? maxR : 8;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              try {
                if (attempt > 0) {
                  window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: `🔄 ${label} — retry ${attempt + 1}/9 (chờ 10s)...`, phase: 'images', timestamp: Date.now() } }));
                  await new Promise(r => setTimeout(r, 10000));
                }

                // Parallel coordination check
                if (lastCompletionTimeRef.current > 0) {
                  const elapsed = Date.now() - lastCompletionTimeRef.current;
                  if (elapsed < 15000) {
                    await new Promise(r => setTimeout(r, 15000 - elapsed));
                  }
                }

                const res = await axios.post('/api/generate/image', {
                  prompt,
                  project_id: settings.flowkitProjectId,
                  ...(refs && refs.length > 0 ? { reference_media_ids: refs } : {}),
                  aspect_ratio: imgAspect,
                });
                if (res.data.url && res.data.media_id) {
                  return { url: res.data.url, mediaId: res.data.media_id };
                }

                // Check for overload in response details
                const apiError = res.data.error;
                let errorText = "";
                if (typeof apiError === 'string') {
                  errorText = apiError;
                } else if (apiError && typeof apiError === 'object') {
                  const errObj = apiError.data?.error || apiError.error || apiError;
                  errorText = errObj.message || JSON.stringify(errObj);
                }

                if (isOverloadMsg(errorText)) {
                  toast.loading(`⏳ Server quá tải (Resource exhausted). Nghỉ 30s rồi thử lại...`, { id: 'gen-images' });
                  window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: `⏳ Server quá tải (${errorText}). Chờ 30s...`, phase: 'images', timestamp: Date.now() } }));
                  await new Promise(r => setTimeout(r, 30000));
                  attempt--;
                  continue;
                }
              } catch (err: any) {
                const errMsg = err?.response?.data?.detail || err.message || '';
                if (isOverloadMsg(errMsg) || err?.response?.status === 429 || err?.response?.status === 503) {
                  toast.loading(`⏳ Server quá tải (Rate limit/Exhausted). Nghỉ 30s rồi thử lại...`, { id: 'gen-images' });
                  window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: `⏳ Server quá tải (${errMsg}). Chờ 30s...`, phase: 'images', timestamp: Date.now() } }));
                  await new Promise(r => setTimeout(r, 30000));
                  attempt--;
                  continue;
                }
                if (attempt === maxRetries) return null;
              }
            }
            return null;
          };

          for (let i = 0; i < imagePrompts.length; i++) {
            window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: `🎨 Ảnh ${i + 1}/${imagePrompts.length}...`, phase: 'images', current: i, total: imagePrompts.length, timestamp: Date.now() } }));

            const finalPrompt = processPromptReferences(imagePrompts[i], refMediaIds, upstreamChars);

            const imageResult = await createWithRetry(finalPrompt, `Ảnh ${i + 1}`, refMediaIds);

            lastCompletionTimeRef.current = Date.now();

            const sceneNum = scenesList[i]?.number || scenesList[i]?.sceneNumber || (i + 1);

            if (!imageResult) {
              consecutiveFailures++;
              failedPrompts.push(imagePrompts[i]);

              const imageNodeId = `img_failed_${Date.now()}_${i}`;
              setNodes(nds => nds.concat({
                id: imageNodeId,
                type: 'image',
                position: imagePositions[sceneNum - 1] || { x: nX + 320, y: nY + (sceneNum - 1) * 200 },
                style: nodeSize(aspectRatio),
                data: { imageUrl: undefined, mediaId: undefined, prompt: imagePrompts[i], aspectRatio: imgAspect, isGeneratingVideo: false, promptIndex: sceneNum, status: 'failed' },
              }));
              setEdges(eds => eds.concat({
                id: `e_${nodeId}_${imageNodeId}`,
                source: nodeId,
                target: imageNodeId,
                animated: true,
                style: { stroke: '#ef4444', strokeWidth: 2, opacity: 0.7 },
              }));

              if (consecutiveFailures >= 3) {
                toast.dismiss('gen-images');
                toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại!`);
                return { success: successCount, failed: failedPrompts.length, total: imagePrompts.length, failedPrompts };
              }

              // Delay 15s on failure
              await new Promise(r => setTimeout(r, 15000));
              continue;
            }

            consecutiveFailures = 0;

            const imageNodeId = `img_${Date.now()}_${i}`;
            setNodes(nds => nds.concat({
              id: imageNodeId,
              type: 'image',
              position: imagePositions[sceneNum - 1] || { x: nX + 320, y: nY + (sceneNum - 1) * 200 },
              style: nodeSize(aspectRatio),
              data: { imageUrl: imageResult.url, mediaId: imageResult.mediaId, prompt: imagePrompts[i], aspectRatio: imgAspect, isGeneratingVideo: false, promptIndex: sceneNum },
            }));
            setEdges(eds => eds.concat({
              id: `e_${nodeId}_${imageNodeId}`,
              source: nodeId,
              target: imageNodeId,
              animated: true,
              style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
            }));
            successCount++;
            addMedia({ id: imageResult.mediaId || imageNodeId, type: 'image', filename: `gen_${sceneNum}.png`, path: imageResult.url, url: imageResult.url, prompt: imagePrompts[i], createdAt: new Date().toISOString(), fileSize: 0, status: 'ready' });
            window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: `🎨 Ảnh ${i + 1}/${imagePrompts.length} ✅`, phase: 'images', current: i + 1, total: imagePrompts.length, timestamp: Date.now() } }));

            // Delay 5s on success
            await new Promise(r => setTimeout(r, 5000));
          }

          // ── Auto-retry failed prompts (up to 3 rounds) ──
          if (failedPrompts.length > 0) {
            const maxRetryRounds = 3;
            for (let round = 1; round <= maxRetryRounds && failedPrompts.length > 0; round++) {
              const retryCount = failedPrompts.length;
              const retryDelay = round * 3000;
              window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: `🔄 Auto-retry vòng ${round}: ${retryCount} ảnh lỗi...`, phase: 'images', current: 0, total: retryCount, timestamp: Date.now() } }));
              toast.loading(`🔄 Retry vòng ${round}/${maxRetryRounds}: ${retryCount} ảnh lỗi...`, { id: 'gen-images' });
              await new Promise(r => setTimeout(r, retryDelay));

              const stillFailed: string[] = [];
              for (let ri = 0; ri < failedPrompts.length; ri++) {
                const retryPrompt = failedPrompts[ri];
                const origIdx = imagePrompts.indexOf(retryPrompt);
                window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: `🔄 Retry ${ri + 1}/${retryCount} (vòng ${round})...`, phase: 'images', current: ri + 1, total: retryCount, timestamp: Date.now() } }));

                const finalPrompt = processPromptReferences(retryPrompt, refMediaIds, upstreamChars);
                const imageResult = await createWithRetry(finalPrompt, `Retry ảnh`, refMediaIds, 1);

                lastCompletionTimeRef.current = Date.now();

                const sceneNum = scenesList[origIdx]?.number || scenesList[origIdx]?.sceneNumber || (origIdx + 1);

                if (imageResult) {
                  consecutiveFailures = 0;
                  const imageNodeId = `img_retry_${Date.now()}_${ri}`;
                  
                  // Clean up the failed image node that we created earlier
                  const oldFailedNodes = nodesRef.current.filter(n => n.type === 'image' && n.data?.promptIndex === sceneNum && n.data?.status === 'failed');
                  const oldFailedNodeIds = oldFailedNodes.map(n => n.id);

                  setNodes(nds => nds.filter(n => !oldFailedNodeIds.includes(n.id)).concat({
                    id: imageNodeId,
                    type: 'image',
                    position: imagePositions[sceneNum - 1] || { x: nX + 320, y: nY + (sceneNum - 1) * 200 },
                    style: nodeSize(aspectRatio),
                    data: { imageUrl: imageResult.url, mediaId: imageResult.mediaId, prompt: retryPrompt, aspectRatio: imgAspect, isGeneratingVideo: false, promptIndex: sceneNum },
                  }));
                  setEdges(eds => eds.filter(e => !oldFailedNodeIds.includes(e.source) && !oldFailedNodeIds.includes(e.target)).concat({
                    id: `e_${nodeId}_${imageNodeId}`,
                    source: nodeId,
                    target: imageNodeId,
                    animated: true,
                    style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
                  }));
                  successCount++;
                  addMedia({ id: imageResult.mediaId || imageNodeId, type: 'image', filename: `retry_${sceneNum}.png`, path: imageResult.url, url: imageResult.url, prompt: retryPrompt, createdAt: new Date().toISOString(), fileSize: 0, status: 'ready' });
                  toast.success(`✅ Retry ảnh ${sceneNum} thành công!`);

                  // Delay 5s
                  await new Promise(r => setTimeout(r, 5000));
                } else {
                  consecutiveFailures++;
                  stillFailed.push(retryPrompt);

                  if (consecutiveFailures >= 3) {
                    toast.dismiss('gen-images');
                    toast.error(`❌ Dừng workflow ngay lập tức do 3 prompt liên tiếp thất bại!`);
                    return { success: successCount, failed: failedPrompts.length, total: imagePrompts.length, failedPrompts };
                  }

                  // Delay 15s
                  await new Promise(r => setTimeout(r, 15000));
                }
              }
              failedPrompts.length = 0;
              failedPrompts.push(...stillFailed);
              if (failedPrompts.length === 0) {
                toast.success(`✅ Auto-retry thành công! Tất cả ảnh đã tạo xong.`);
                break;
              }
            }
          }

          toast.dismiss('gen-images');
          window.dispatchEvent(new CustomEvent('pipeline-progress', { detail: { message: `✅ ${successCount}/${imagePrompts.length} ảnh hoàn thành!`, phase: 'done', current: successCount, total: imagePrompts.length, timestamp: Date.now() } }));
          toast.success(`✅ ${successCount}/${imagePrompts.length} ảnh ${useReference ? '(R2I)' : '(T2I)'}`);
          return { success: successCount, failed: failedPrompts.length, total: imagePrompts.length, failedPrompts };
        }
      } catch (err) {
        toast.dismiss('gen-images');
        toast.error('Lỗi tạo ảnh');
        return { success: 0, failed: imagePrompts.length, total: imagePrompts.length, failedPrompts: imagePrompts };
      }
    }
    return { success: 0, failed: 0, total: imagePrompts.length, failedPrompts: [] };
  }, [setNodes, setEdges, settings.flowkitProjectId, getUpstreamMediaIds]);

  // ─── Merge All Videos (nối video theo thứ tự prompt) ───
  const mergeAllVideos = useCallback(async (transition: string = 'none', transitionDuration: number = 0.5) => {
    // Check if any video nodes are still rendering
    const allVideoNodes = nodesRef.current.filter(n => n.type === 'video' && !(n.data as any).videoUrl?.includes('merged'));
    const pendingVideos = allVideoNodes.filter(n => (n.data as any).jobId && !(n.data as any).videoUrl);

    if (pendingVideos.length > 0) {
      toast.loading(`⏳ Chờ ${pendingVideos.length} video đang render xong...`, { id: 'merge' });

      // Poll until all videos are done (max 10 min)
      const maxWait = 10 * 60 * 1000;
      const startTime = Date.now();
      const pollInterval = 5000;

      while (Date.now() - startTime < maxWait) {
        await new Promise(r => setTimeout(r, pollInterval));

        const currentPending = nodesRef.current.filter(
          n => n.type === 'video' && (n.data as any).jobId && !(n.data as any).videoUrl && !(n.data as any).videoUrl?.includes('merged')
        );
        const currentDone = nodesRef.current.filter(
          n => n.type === 'video' && (n.data as any).videoUrl && !(n.data as any).videoUrl?.includes('merged')
        );

        if (currentPending.length === 0) {
          toast.loading(`✅ Tất cả video đã xong! Đang nối...`, { id: 'merge' });
          break;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        toast.loading(`⏳ Chờ ${currentPending.length} video (đã ${currentDone.length} xong)... ${elapsed}s`, { id: 'merge' });
      }

      // Check again after waiting
      const stillPending = nodesRef.current.filter(
        n => n.type === 'video' && (n.data as any).jobId && !(n.data as any).videoUrl
      );
      if (stillPending.length > 0) {
        toast.error(`⚠️ ${stillPending.length} video vẫn chưa xong sau 10 phút. Nối các video đã hoàn thành.`, { id: 'merge' });
      }
    }

    // Group completed video nodes by workflowIndex or workflowId
    const completedVideos = nodesRef.current.filter(
      n => n.type === 'video' && (n.data as any).videoUrl && !(n.data as any).videoUrl?.includes('merged')
    );

    if (completedVideos.length === 0) {
      toast.error('Không tìm thấy video nào đã hoàn thành để nối!', { id: 'merge' });
      return null;
    }

    const groups: Record<string, typeof completedVideos> = {};
    completedVideos.forEach(n => {
      const gId = (n.data as any).workflowId || (n.data as any).workflowIndex || 'manual_canvas';
      if (!groups[gId]) groups[gId] = [];
      groups[gId].push(n);
    });

    const groupKeys = Object.keys(groups);
    let totalMergedCount = 0;
    let lastMergedUrl = '';

    toast.loading(`🔗 Đang tiến hành phân loại và nối video theo từng Workflow...`, { id: 'merge' });

    for (const gId of groupKeys) {
      const groupNodes = groups[gId];
      if (groupNodes.length < 2) {
        console.log(`[Merge] Bỏ qua nhóm ${gId} vì chỉ có ${groupNodes.length} video`);
        continue;
      }

      // Sort nodes in this group
      groupNodes.sort((a, b) => {
        const aIdx = (a.data as any).promptIndex !== undefined ? Number((a.data as any).promptIndex) : null;
        const bIdx = (b.data as any).promptIndex !== undefined ? Number((b.data as any).promptIndex) : null;
        if (aIdx !== null && bIdx !== null) return aIdx - bIdx;

        const getLabelNum = (node: typeof a): number | null => {
          const lbl = (node.data.label as string) || '';
          const match = lbl.match(/\d+/);
          return match ? Number(match[0]) : null;
        };
        const aLabelNum = getLabelNum(a);
        const bLabelNum = getLabelNum(b);
        if (aLabelNum !== null && bLabelNum !== null) return aLabelNum - bLabelNum;

        const getTimestamp = (node: typeof a): number => {
          const match = node.id.match(/\d+/);
          return match ? Number(match[0]) : 0;
        };
        return getTimestamp(a) - getTimestamp(b);
      });

      const videoUrls = groupNodes.map(n => n.data.videoUrl as string);
      const isManual = gId === 'manual_canvas';
      const wfLabel = isManual ? 'Canvas Thủ Công' : `Workflow #${gId}`;

      toast.loading(`🔗 Đang nối ${videoUrls.length} video của ${wfLabel}...`, { id: 'merge' });

      try {
        const res = await axios.post('/api/generate/merge-videos', {
          video_urls: videoUrls,
          transition,
          transition_duration: transitionDuration,
        });

        if (res.data.success) {
          const mergedUrl = res.data.url;
          const mergedNodeId = `merged_${Date.now()}_${gId}`;
          lastMergedUrl = mergedUrl;
          totalMergedCount++;

          const maxX = Math.max(...groupNodes.map(n => n.position.x), 300);
          const avgY = groupNodes.reduce((s, n) => s + n.position.y, 0) / groupNodes.length;

          // Create merged video node
          setNodes(nds => nds.concat({
            id: mergedNodeId,
            type: 'video',
            position: { x: maxX + 350, y: avgY },
            style: { width: 300, height: 250 },
            data: {
              videoUrl: mergedUrl,
              prompt: `🔗 Video đã nối cho ${wfLabel} (${res.data.video_count} video)`,
              aspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE',
              isGeneratingVideo: false,
              label: `🔗 Merged ${wfLabel} (${res.data.video_count})`,
              workflowId: isManual ? undefined : gId,
            },
          }));

          // Draw edges from source videos to merged node
          const newEdges = groupNodes.map(vn => ({
            id: `e_${vn.id}_${mergedNodeId}`,
            source: vn.id,
            target: mergedNodeId,
            animated: false,
            style: { stroke: '#f59e0b', strokeWidth: 2, opacity: 0.5 },
          }));
          setEdges(eds => eds.concat(...newEdges));

          addMedia({
            id: mergedNodeId, type: 'video',
            filename: res.data.filename, path: mergedUrl, url: mergedUrl,
            prompt: `Merged ${res.data.video_count} videos of ${wfLabel}`,
            createdAt: new Date().toISOString(),
            fileSize: res.data.file_size, status: 'ready',
          });
        } else {
          toast.error(`Lỗi khi nối nhóm ${wfLabel}: ${res.data.error || 'Không rõ nguyên nhân'}`, { id: 'merge' });
        }
      } catch (err: any) {
        console.error(`Lỗi khi nối nhóm ${wfLabel}:`, err.message);
        const errMsg = err.response?.data?.detail || err.message || 'Lỗi kết nối';
        toast.error(`Lỗi kết nối khi nối nhóm ${wfLabel}: ${errMsg}`, { id: 'merge' });
      }
    }

    if (totalMergedCount > 0) {
      toast.success(`✅ Đã nối thành công video cho ${totalMergedCount} Workflow riêng biệt!`, { id: 'merge' });
      return lastMergedUrl;
    } else {
      toast.error('Không nhóm nào đủ điều kiện nối (yêu cầu tối thiểu 2 video đã hoàn thành mỗi nhóm)!', { id: 'merge' });
      return null;
    }
  }, [setNodes, setEdges, addMedia]);

  // ═══════════════════════════════════════════════════════════════
  // Full Pipeline: Auto-detect flow type
  // Flow A: T2I → Collector → VideoPrompt (direct I2V)
  // Flow B: T2I → Collector → R2I → VideoPrompt (scene images first)
  // ═══════════════════════════════════════════════════════════════
  const runFullPipeline = useCallback(async () => {
    const allNodes = nodesRef.current;
    const allEdges = edgesRef.current;

    // Find ImageCollector
    const collectorNodes = allNodes.filter(n => n.type === 'imageCollector');
    if (collectorNodes.length === 0) {
      toast.error('❌ Chưa có Image Collector trên canvas!');
      return;
    }

    const collector = collectorNodes[0];

    // Find T2I PromptNode → Collector
    const t2iEdges = allEdges.filter(e => e.target === collector.id);
    const t2iNodes = t2iEdges
      .map(e => allNodes.find(n => n.id === e.source))
      .filter(n => n && n.type === 'prompt');

    if (t2iNodes.length === 0) {
      toast.error('❌ Chưa nối PromptNode T2I → Image Collector!');
      return;
    }

    // Detect downstream: R2I PromptNode or VideoPromptNode
    const collectorDownEdges = allEdges.filter(e => e.source === collector.id);
    const downstreamNodes = collectorDownEdges
      .map(e => allNodes.find(n => n.id === e.target))
      .filter(Boolean);

    const r2iNodes = downstreamNodes.filter(n => n!.type === 'prompt');
    const vpDirectNodes = downstreamNodes.filter(n => n!.type === 'videoPrompt');

    // Determine flow type
    const hasR2I = r2iNodes.length > 0;
    const hasDirectVP = vpDirectNodes.length > 0;

    if (!hasR2I && !hasDirectVP) {
      toast.error('❌ Chưa nối Collector → R2I PromptNode hoặc VideoPromptNode!');
      return;
    }

    const flowType = hasR2I ? 'B' : 'A';
    toast.success(`🚀 Pipeline ${flowType === 'A' ? '(T2I → Video)' : '(T2I → R2I → Video)'} bắt đầu!`);

    // ─── STEP 1: Run T2I (tạo ảnh tham chiếu) ───
    for (const t2iNode of t2iNodes) {
      if (!t2iNode) continue;
      const prompt = (t2iNode.data.prompt as string) || '';
      const prompts = prompt.split('\n').filter(l => l.trim());
      const ratio = (t2iNode.data.aspectRatio as string) || 'IMAGE_ASPECT_RATIO_LANDSCAPE';

      if (prompts.length === 0) {
        toast.error('❌ T2I PromptNode chưa có prompt!');
        return;
      }

      toast.loading(`📸 Bước 1: Tạo ${prompts.length} ảnh tham chiếu...`, { id: 'pipeline-step1' });

      const origImageOnly = t2iNode.data.imageOnly;
      setNodes(nds => nds.map(n => n.id === t2iNode.id ? { ...n, data: { ...n.data, imageOnly: true } } : n));
      await onBatchGenImage(t2iNode.id, prompts, ratio, (t2iNode.data.concurrent as number) || 2, true); // skipAutoVideoTrigger=true: pipeline sẽ tự gọi video ở Step 2
      setNodes(nds => nds.map(n => n.id === t2iNode.id ? { ...n, data: { ...n.data, imageOnly: origImageOnly } } : n));
    }

    toast.success('✅ Bước 1 hoàn tất: Ảnh tham chiếu đã tạo!', { id: 'pipeline-step1' });

    // ─── Wait for Collector ───
    toast.loading('⏳ Đợi Image Collector thu thập...', { id: 'pipeline-wait' });
    await new Promise(r => setTimeout(r, 3000));
    let finalCollected = (nodesRef.current.find(n => n.id === collector.id)?.data.collectedMediaIds as string[]) || [];
    if (finalCollected.length === 0) {
      await new Promise(r => setTimeout(r, 5000));
      finalCollected = (nodesRef.current.find(n => n.id === collector.id)?.data.collectedMediaIds as string[]) || [];
    }
    toast.success(`✅ Collector: ${finalCollected.length} ảnh`, { id: 'pipeline-wait' });

    if (flowType === 'A') {
      // ─── Flow A: Collector → VideoPrompt (direct I2V) ───
      const vpNode = vpDirectNodes[0]!;
      toast.loading(`🎬 Bước 2: Tạo video từ ${finalCollected.length} ảnh tham chiếu...`, { id: 'pipeline-step2' });

      // Sync data and trigger gen
      await onGenVideoFromVideoPrompt(vpNode.id);

      toast.success('✅ Bước 2 hoàn tất: Video đang tạo!', { id: 'pipeline-step2' });
    } else {
      // ─── Flow B: Collector → R2I → VideoPrompt ───
      const r2iNode = r2iNodes[0]!;
      const r2iPrompt = (r2iNode.data.prompt as string) || '';
      const r2iPrompts = r2iPrompt.split('\n').filter(l => l.trim());
      const r2iRatio = (r2iNode.data.aspectRatio as string) || 'IMAGE_ASPECT_RATIO_LANDSCAPE';

      if (r2iPrompts.length === 0) {
        toast.error('❌ R2I PromptNode chưa có prompt!');
        return;
      }

      // Find VideoPromptNode downstream of R2I (either direct or through an ImageCollector)
      const r2iDownEdges = allEdges.filter(e => e.source === r2iNode.id);
      let vpFromR2I = r2iDownEdges
        .map(e => allNodes.find(n => n.id === e.target))
        .filter(n => n && n.type === 'videoPrompt') as Node[];

      if (vpFromR2I.length === 0) {
        const downstreamCollectors = r2iDownEdges
          .map(e => allNodes.find(n => n.id === e.target))
          .filter(n => n && n.type === 'imageCollector');
        
        for (const coll of downstreamCollectors) {
          if (!coll) continue;
          const collDownEdges = allEdges.filter(e => e.source === coll.id);
          const vpNodes = collDownEdges
            .map(e => allNodes.find(n => n.id === e.target))
            .filter(n => n && n.type === 'videoPrompt') as Node[];
          if (vpNodes.length > 0) {
            vpFromR2I.push(...vpNodes);
          }
        }
      }

      toast.loading(`🎨 Bước 2: Tạo ${r2iPrompts.length} ảnh cảnh (R2I)...${vpFromR2I.length > 0 ? ' → Auto Video' : ''}`, { id: 'pipeline-step2' });

      setNodes(nds => nds.map(n => n.id === r2iNode.id ? { ...n, data: { ...n.data, useReference: true, imageOnly: true } } : n));
      await onBatchGenImage(r2iNode.id, r2iPrompts, r2iRatio, (r2iNode.data.concurrent as number) || 2);

      toast.success('✅ Bước 2 hoàn tất: Ảnh cảnh đã tạo!', { id: 'pipeline-step2' });

      if (vpFromR2I.length > 0) {
        toast.success('🎬 Bước 3: Video đang tự động tạo từ VideoPromptNode!');
      }
    }

    toast.success('🎉 Pipeline hoàn tất!');
  }, [setNodes, onBatchGenImage, onGenVideoFromVideoPrompt]);

  return {
    nodes, setNodes, onNodesChange,
    edges, setEdges, onEdgesChange,
    nodeTypes, edgeTypes,
    onConnect,
    reactFlowInstance, setReactFlowInstance,
    addPromptNode, addBatchNode, addCharacterNode, addImageUploadNode, addBatchT2INode, addBatchR2INode,
    addImageCollectorNode, addVideoPromptNode,
    onDeleteNode,
    onGenImage, onGenVideo, onGenVideoFromVideoPrompt, onRetryFailedFromVideoPrompt, onBatchVideoCreated, onBatchGenImage,
    onRegenImage, onRegenVideo, onUpscaleVideo, onUpscaleImage, onBatchGenVideoFromImages,
    getCharacterNames, fillBatchPrompts,
    agentI2VPipeline, agentT2VPipeline, agentGenerateImages, agentStoryPipeline,
    mergeAllVideos,
    clearAll,
    runFullPipeline,
    exportWorkflow,
    importWorkflow,
    loadPresetWorkflow1,
    loadPresetWorkflow2,
    hydrateNodes,
  };
}
