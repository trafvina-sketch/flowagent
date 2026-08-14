import { useState, useMemo } from 'react';
import { Video, RefreshCw, Search, SortDesc, ChevronDown } from 'lucide-react';
import type { MediaItem } from '../../types';
import MediaCard from './MediaCard';
import { useProjectStore } from '../../store/useProjectStore';

/* ────────────────────────────── types ──────────────────────────────── */

interface VideoGalleryProps {
  videos: MediaItem[];
  onRefresh: () => void;
}

type SortOption = 'newest' | 'oldest' | 'longest' | 'shortest';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'longest', label: 'Longest duration' },
  { value: 'shortest', label: 'Shortest duration' },
];

/* ────────────────────────────── skeleton ───────────────────────────── */

function SkeletonCard() {
  return (
    <div className="glass-card overflow-hidden">
      <div className="aspect-video shimmer w-full" />
      <div className="space-y-2 px-3 py-2.5">
        <div className="shimmer h-3.5 w-3/4 rounded" />
        <div className="shimmer h-3 w-1/2 rounded" />
      </div>
    </div>
  );
}

/* ────────────────────────────── empty state ────────────────────────── */

function EmptyState() {
  return (
    <div className="fade-in col-span-full flex flex-col items-center justify-center py-24">
      <div className="relative mb-6">
        <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
          <Video size={40} className="text-emerald-400" />
        </div>
        {/* floating particles */}
        <div className="absolute -right-2 -top-2 h-3 w-3 animate-bounce rounded-full bg-emerald-400/40" style={{ animationDelay: '0s' }} />
        <div className="absolute -bottom-1 -left-3 h-2 w-2 animate-bounce rounded-full bg-indigo-400/40" style={{ animationDelay: '0.5s' }} />
        <div className="absolute -right-4 bottom-3 h-2.5 w-2.5 animate-bounce rounded-full bg-accent-light/30" style={{ animationDelay: '1s' }} />
      </div>
      <h3 className="text-lg font-semibold text-slate-200">No videos yet</h3>
      <p className="mt-1.5 max-w-xs text-center text-sm text-slate-400">
        Hãy thiết kế video đầu tiên cùng FlowAgent hoặc tải tệp tin lên thư viện để bắt đầu.
      </p>
    </div>
  );
}

/* ────────────────────────────── component ──────────────────────────── */

export default function VideoGallery({ videos, onRefresh }: VideoGalleryProps) {
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [search, setSearch] = useState('');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const setPreviewMedia = useProjectStore((s) => s.setPreviewMedia);
  const removeMedia = useProjectStore((s) => s.removeMedia);

  /* ── filter + sort ── */
  const filtered = useMemo(() => {
    let list = videos;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (v) =>
          v.filename.toLowerCase().includes(q) ||
          v.prompt?.toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    switch (sortBy) {
      case 'newest':
        sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        break;
      case 'longest':
        sorted.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
        break;
      case 'shortest':
        sorted.sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0));
        break;
    }
    return sorted;
  }, [videos, search, sortBy]);

  const isLoading = false; // future: accept via props

  return (
    <div className="fade-in flex flex-col gap-5">
      {/* ── header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-slate-100">Videos</h2>
          <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
            {videos.length}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {/* search */}
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search videos…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-52 rounded-lg border border-border bg-surface-light/60 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 outline-none transition-colors focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
            />
          </div>

          {/* sort dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsSortOpen(!isSortOpen)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-light/60 px-3 text-sm text-slate-300 transition-colors hover:border-border-light hover:text-slate-100"
            >
              <SortDesc size={15} />
              <span className="hidden sm:inline">{SORT_OPTIONS.find((o) => o.value === sortBy)?.label}</span>
              <ChevronDown size={14} className={`transition-transform ${isSortOpen ? 'rotate-180' : ''}`} />
            </button>

            {isSortOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsSortOpen(false)} />
                <div className="absolute right-0 top-11 z-40 min-w-[170px] rounded-xl border border-border bg-surface-light/95 p-1 shadow-xl backdrop-blur-xl slide-up">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setSortBy(opt.value);
                        setIsSortOpen(false);
                      }}
                      className={`flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                        sortBy === opt.value
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'text-slate-300 hover:bg-white/5 hover:text-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* refresh */}
          <button
            onClick={onRefresh}
            className="group flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-light/60 text-slate-400 transition-all hover:border-emerald-500/40 hover:text-emerald-300"
            title="Refresh videos"
          >
            <RefreshCw size={16} className="transition-transform group-hover:rotate-90" />
          </button>
        </div>
      </div>

      {/* ── grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              onPreview={setPreviewMedia}
              onDelete={removeMedia}
            />
          ))}
        </div>
      )}
    </div>
  );
}
