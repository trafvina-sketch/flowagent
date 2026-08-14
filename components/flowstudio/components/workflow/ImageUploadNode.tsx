import { useState, useRef, useCallback, useContext, useEffect } from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import { ImagePlus, Upload, X, Trash2 } from 'lucide-react';
import { WorkflowContext } from './WorkflowContext';
import { setImageFiles } from '../../stores/imageFileStore';

interface LocalImg {
  file: File;
  preview: string;
}

export default function ImageUploadNode({ id, data: _data, selected }: { id: string; data: any; selected?: boolean }) {
  const { onDeleteNode } = useContext(WorkflowContext);
  const { setNodes } = useReactFlow();

  const [images, setImages] = useState<LocalImg[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sync initial previews from node data if exported from MultiWorkflowPanel
  useEffect(() => {
    const initialUrl = _data?.imageUrl || _data?.preview;
    const initialPreviews = _data?.initialPreviews || (initialUrl ? [initialUrl] : []);
    if (initialPreviews.length > 0 && images.length === 0) {
      Promise.all(
        initialPreviews.map(async (url: string, idx: number) => {
          try {
            if (url.startsWith('blob:')) {
              const res = await fetch(url);
              const blob = await res.blob();
              return {
                file: new File([blob], `ref_${idx + 1}.png`, { type: blob.type || 'image/png' }),
                preview: url,
              };
            }
          } catch (e) {
            console.error('Failed to restore file from blob:', e);
          }
          return {
            file: new File([], `ref_${idx + 1}.png`, { type: 'image/png' }),
            preview: url,
          };
        })
      ).then(resolvedImgs => {
        setImages(resolvedImgs);
      });
    }
  }, [_data?.imageUrl, _data?.preview, _data?.initialPreviews, images.length]);

  // Add files — just store locally, NO upload
  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const newImgs: LocalImg[] = Array.from(files).map(f => ({
      file: f,
      preview: URL.createObjectURL(f),
    }));
    setImages(prev => [...prev, ...newImgs]);
  }, []);

  const removeImage = (preview: string) => {
    setImages(prev => {
      const removed = prev.find(i => i.preview === preview);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter(i => i.preview !== preview);
    });
  };

  const clearAll = () => {
    images.forEach(i => URL.revokeObjectURL(i.preview));
    setImages([]);
  };

  // Sync file count + files to store
  useEffect(() => {
    const files = images.map(i => i.file);
    setImageFiles(id, files);

    // Update node data with count (for BatchNode to know how many images)
    setNodes(nds => nds.map(n => {
      if (n.id !== id) return n;
      const currentCount = (n.data.imageCount as number) || 0;
      if (currentCount === images.length) return n;
      return { ...n, data: { ...n.data, imageCount: images.length } };
    }));
  }, [images, id, setNodes]);

  return (
    <div className={`bg-slate-900 border rounded-2xl shadow-xl overflow-hidden h-full w-full flex flex-col ${
      selected ? 'border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]' : 'border-amber-500/40 hover:border-amber-500/60'
    }`}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={200}
        minHeight={120}
        lineClassName="!border-amber-500/50"
        handleClassName="!w-2.5 !h-2.5 !bg-amber-500 !border-2 !border-slate-900 !rounded"
      />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-amber-400 !border-amber-600" />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
        <div className="flex items-center gap-2">
          <ImagePlus className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-amber-300">Ảnh I2V</span>
          <span className="text-[9px] bg-slate-800 text-amber-300 px-1.5 py-0.5 rounded font-bold">
            {images.length} ảnh
          </span>
        </div>
        <div className="flex items-center gap-1">
          {images.length > 0 && (
            <button onClick={clearAll} className="text-slate-500 hover:text-red-400 text-[10px]" title="Xoá tất cả">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => onDeleteNode(id)} className="text-slate-500 hover:text-red-400 text-[10px]">✕</button>
        </div>
      </div>

      {/* Image Grid */}
      <div className="px-2 pt-2 pb-1 flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-wrap gap-1">
          {images.map((img, idx) => (
            <div key={img.preview} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-slate-700 shrink-0">
              <img src={img.preview} className="w-full h-full object-cover" alt="" />
              <div className="absolute bottom-0.5 left-0.5 text-[7px] bg-black/70 text-amber-300 px-1 rounded font-bold">
                {idx + 1}
              </div>
              <button onClick={() => removeImage(img.preview)}
                className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100">
                <X className="w-2 h-2" />
              </button>
            </div>
          ))}

          <button
            onClick={() => fileRef.current?.click()}
            className="nodrag w-16 h-16 rounded-lg border-2 border-dashed border-slate-700 hover:border-amber-500/50 flex flex-col items-center justify-center text-slate-500 hover:text-amber-400 transition-all shrink-0"
          >
            <Upload className="w-4 h-4" />
            <span className="text-[7px] mt-0.5">Thêm ảnh</span>
          </button>
        </div>
        <input ref={fileRef} type="file" className="hidden" accept="image/*" multiple
          onChange={(e) => { handleFiles(e.target.files); if (e.target) e.target.value = ''; }}
        />
      </div>

      <div className="px-2 pb-2 shrink-0">
        <p className="text-[8px] text-slate-600 text-center">
          Chọn ảnh → nối BatchNode I2V → Chạy (upload tự động khi tạo video)
        </p>
      </div>
    </div>
  );
}
