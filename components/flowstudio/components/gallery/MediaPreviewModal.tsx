import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
  Calendar,
  HardDrive,
  Maximize2,
} from 'lucide-react';
import type { MediaItem } from '../../types';

/* ────────────────────────────── helpers ────────────────────────────── */

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ────────────────────────────── types ──────────────────────────────── */

interface MediaPreviewModalProps {
  media: MediaItem | null;
  onClose: () => void;
  allMedia: MediaItem[];
}

/* ────────────────────────────── component ──────────────────────────── */

export default function MediaPreviewModal({ media, onClose, allMedia }: MediaPreviewModalProps) {
  const [isZoomed, setIsZoomed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const currentIndex = useMemo(
    () => (media ? allMedia.findIndex((m) => m.id === media.id) : -1),
    [media, allMedia]
  );

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allMedia.length - 1 && currentIndex !== -1;

  const navigateTo = useCallback(
    (index: number) => {
      if (index >= 0 && index < allMedia.length) {
        setIsZoomed(false);
        // We simulate navigation by calling onClose & re-open — but better to use a local state
        // Instead, we'll dispatch a custom event or directly manipulate via store.
        // For simplicity, we use a workaround: the parent should pass a setter.
        // Since we only receive onClose, we trigger navigation by dispatching a custom event.
        const event = new CustomEvent('media-preview-navigate', {
          detail: allMedia[index],
        });
        window.dispatchEvent(event);
      }
    },
    [allMedia]
  );

  const goPrev = useCallback(() => {
    if (hasPrev) navigateTo(currentIndex - 1);
  }, [hasPrev, currentIndex, navigateTo]);

  const goNext = useCallback(() => {
    if (hasNext) navigateTo(currentIndex + 1);
  }, [hasNext, currentIndex, navigateTo]);

  /* ── keyboard navigation ── */
  useEffect(() => {
    if (!media) return;

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [media, onClose, goPrev, goNext]);

  /* ── mount / unmount animation ── */
  useEffect(() => {
    if (media) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [media]);

  if (!media) return null;

  const isImage = media.type === 'image';
  const dims = media.dimensions;

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* ── close button ── */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-60 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white hover:scale-110"
        title="Close (Esc)"
      >
        <X size={20} />
      </button>

      {/* ── prev arrow ── */}
      {hasPrev && (
        <button
          onClick={goPrev}
          className="absolute left-4 top-1/2 z-60 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white hover:scale-110"
          title="Previous (←)"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      {/* ── next arrow ── */}
      {hasNext && (
        <button
          onClick={goNext}
          className="absolute right-4 top-1/2 z-60 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-all hover:bg-white/20 hover:text-white hover:scale-110"
          title="Next (→)"
        >
          <ChevronRight size={24} />
        </button>
      )}

      {/* ── main content ── */}
      <div
        className={`flex max-h-[85vh] max-w-[90vw] flex-col items-center gap-4 transition-transform duration-300 ${
          isVisible ? 'scale-100' : 'scale-95'
        }`}
      >
        {/* media */}
        <div className="relative flex items-center justify-center">
          {isImage ? (
            <img
              src={media.url}
              alt={media.filename}
              onClick={() => setIsZoomed(!isZoomed)}
              className={`rounded-lg shadow-2xl shadow-black/50 transition-all duration-300 ${
                isZoomed
                  ? 'max-h-none max-w-none cursor-zoom-out'
                  : 'max-h-[70vh] max-w-[85vw] cursor-zoom-in object-contain'
              }`}
            />
          ) : (
            <video
              src={media.url}
              controls
              autoPlay
              className="max-h-[70vh] max-w-[85vw] rounded-lg shadow-2xl shadow-black/50"
            />
          )}

          {/* zoom toggle for images */}
          {isImage && (
            <button
              onClick={() => setIsZoomed(!isZoomed)}
              className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-all hover:bg-black/70 hover:text-white"
              title={isZoomed ? 'Fit to screen' : 'Actual size'}
            >
              {isZoomed ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
            </button>
          )}
        </div>

        {/* ── info panel ── */}
        <div className="glass-card flex w-full max-w-2xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
          {/* filename */}
          <div className="flex min-w-0 items-center gap-2 text-sm text-slate-200">
            <FileText size={14} className="shrink-0 text-slate-400" />
            <span className="truncate font-medium">{media.filename}</span>
          </div>

          {/* dimensions */}
          {dims && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Maximize2 size={12} />
              <span>{dims.width} × {dims.height}</span>
            </div>
          )}

          {/* file size */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <HardDrive size={12} />
            <span>{formatFileSize(media.fileSize)}</span>
          </div>

          {/* date */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Calendar size={12} />
            <span>{formatDate(media.createdAt)}</span>
          </div>

          {/* counter */}
          {allMedia.length > 1 && (
            <span className="ml-auto text-xs text-slate-500">
              {currentIndex + 1} / {allMedia.length}
            </span>
          )}

          {/* prompt */}
          {media.prompt && (
            <p className="w-full border-t border-border/50 pt-2 text-xs leading-relaxed text-slate-400">
              <span className="font-medium text-slate-300">Prompt: </span>
              {media.prompt}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
