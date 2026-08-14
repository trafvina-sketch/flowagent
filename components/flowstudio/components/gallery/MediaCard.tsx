import { useRef, useState, useCallback } from 'react';
import { Eye, Download, Trash2, Loader2, X, Play, Film } from 'lucide-react';
import type { MediaItem } from '../../types';
import { resolveMediaUrl } from '../../config';


/* ────────────────────────────── helpers ────────────────────────────── */

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(month / 12)}y ago`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ────────────────────────────── types ──────────────────────────────── */

interface MediaCardProps {
  key?: string | number;
  item: MediaItem;
  onPreview: (item: MediaItem) => void;
  onDelete: (id: string) => void;
  onCreateVideo?: (item: MediaItem) => void;
}

/* ────────────────────────────── component ──────────────────────────── */

export default function MediaCard({ item, onPreview, onDelete, onCreateVideo }: MediaCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const resolvedUrl = resolveMediaUrl(item.url);
  const resolvedThumb = resolveMediaUrl(item.thumbnail);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (item.type === 'video' && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [item.type]);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (item.type === 'video' && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [item.type]);

  const handleDelete = useCallback(() => {
    if (window.confirm(`Delete "${item.filename}"? This action cannot be undone.`)) {
      onDelete(item.id);
    }
  }, [item.id, item.filename, onDelete]);

  const handleDownload = useCallback(async () => {
    try {
      // ═══ ELECTRON EXE MODE: Use IPC ═══
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.media?.pickFolder) {
        const folderPath = await electronAPI.media.pickFolder();
        if (!folderPath) return; // User cancelled
        const savePath = `${folderPath}\\${item.filename}`;
        const result = await electronAPI.media.downloadFile(resolvedUrl, savePath);
        if (result?.success) {
          // Show brief success toast (optional)
        }
        return;
      }

      // ═══ BROWSER: Try native folder picker (Chrome/Edge) ═══
      if ('showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker({
          mode: 'readwrite',
          startIn: 'desktop',
        });
        const response = await fetch(resolvedUrl);
        const blob = await response.blob();
        const fileHandle = await dirHandle.getFileHandle(item.filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.warn('Download method failed, using fallback', err);
    }
    // Fallback: fetch blob and create download link
    try {
      const response = await fetch(resolvedUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = item.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (err) {
      window.open(resolvedUrl, '_blank');
    }
  }, [resolvedUrl, item.filename]);

  const isVideo = item.type === 'video';
  const aspectClass = isVideo ? 'aspect-video' : 'aspect-4/3';

  /* ── status badge ── */
  const statusBadge = (
    <div className="absolute top-2.5 right-2.5 z-10">
      {item.status === 'ready' && (
        <span className="flex h-3 w-3">
          <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
      )}
      {item.status === 'generating' && (
        <span className="flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-300 backdrop-blur-sm">
          <Loader2 size={12} className="animate-spin" />
          Generating
        </span>
      )}
      {item.status === 'failed' && (
        <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-1 text-[11px] font-medium text-red-400 backdrop-blur-sm">
          <X size={12} />
          Failed
        </span>
      )}
    </div>
  );

  /* ── video duration overlay ── */
  const durationOverlay = isVideo && item.duration != null && (
    <div className="absolute bottom-2 right-2 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
      {formatDuration(item.duration)}
    </div>
  );

  /* ── hover overlay ── */
  const hoverOverlay = (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center gap-3 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 ${
        isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <button
        onClick={() => onPreview(item)}
        className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/80 text-white shadow-lg transition-all hover:bg-indigo-500 hover:scale-110 hover:shadow-indigo-500/40"
        title="Preview"
      >
        <Eye size={18} className="transition-transform group-hover/btn:scale-110" />
      </button>
      <button
        onClick={handleDownload}
        className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/80 text-white shadow-lg transition-all hover:bg-emerald-500 hover:scale-110 hover:shadow-emerald-500/40"
        title="Download"
      >
        <Download size={18} className="transition-transform group-hover/btn:scale-110" />
      </button>
      <button
        onClick={handleDelete}
        className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-red-500/80 text-white shadow-lg transition-all hover:bg-red-500 hover:scale-110 hover:shadow-red-500/40"
        title="Delete"
      >
        <Trash2 size={18} className="transition-transform group-hover/btn:scale-110" />
      </button>
      {!isVideo && onCreateVideo && (
        <button
          onClick={() => onCreateVideo(item)}
          className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/80 text-white shadow-lg transition-all hover:bg-amber-500 hover:scale-110 hover:shadow-amber-500/40"
          title="Create Video from this image"
        >
          <Film size={18} className="transition-transform group-hover/btn:scale-110" />
        </button>
      )}
    </div>
  );

  return (
    <div
      className="glass-card media-card-hover fade-in group relative overflow-hidden"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* ── media container ── */}
      <div className={`relative ${aspectClass} w-full overflow-hidden bg-slate-900`}>
        {isVideo ? (
          <>
            <video
              ref={videoRef}
              src={resolvedUrl}
              poster={resolvedThumb}
              muted
              playsInline
              loop
              className="h-full w-full object-cover"
            />
            {/* play icon when not hovered */}
            <div
              className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
                isHovered ? 'opacity-0' : 'opacity-100'
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm">
                <Play size={22} className="ml-0.5 text-white" fill="white" />
              </div>
            </div>
          </>
        ) : (
          <img
            src={resolvedUrl}
            alt={item.filename}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}

        {statusBadge}
        {durationOverlay}
        {hoverOverlay}
      </div>

      {/* ── info bar ── */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200" title={item.filename}>
            {item.filename}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
            <span>{formatFileSize(item.fileSize)}</span>
            <span className="text-slate-600">•</span>
            <span>{formatRelativeTime(item.createdAt)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
