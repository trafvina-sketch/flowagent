import React from 'react';
import { History, Trash2, ExternalLink, Calendar } from 'lucide-react';
import type { HistoryItem } from '../types';

interface HistoryPanelProps {
  history: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  activeId: string | undefined;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  history,
  onSelect,
  onDelete,
  onClear,
  activeId,
}) => {
  if (history.length === 0) return null;

  return (
    <div className="bg-cinema-900/60 backdrop-blur-md border border-cinema-700/40 rounded-2xl p-5 space-y-4 shadow-xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
          <History className="w-4 h-4 text-purple-400" />
          Lịch sử phân tích ({history.length})
        </h3>
        <button
          onClick={onClear}
          className="text-[10px] font-bold text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Xóa tất cả
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[300px] overflow-y-auto pr-1">
        {history.map((item) => {
          const isActive = activeId === item.id;
          const competitorThumbnail = `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`;

          return (
            <div
              key={item.id}
              onClick={() => onSelect(item)}
              className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer group transition-all select-none ${
                isActive
                  ? 'bg-purple-600/10 border-purple-500 shadow-md'
                  : 'bg-cinema-950/30 border-cinema-850 hover:border-cinema-800 hover:bg-cinema-950/50'
              }`}
            >
              {/* Small Thumbnail Preview */}
              <div className="w-16 aspect-video bg-black/40 rounded-lg overflow-hidden flex-shrink-0 relative">
                <img
                  src={competitorThumbnail}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Title & Metadata */}
              <div className="flex-1 min-w-0 space-y-1">
                <p className={`text-xs font-bold truncate leading-tight ${
                  isActive ? 'text-purple-300' : 'text-gray-200 group-hover:text-purple-400 transition-colors'
                }`}>
                  {item.title}
                </p>
                <div className="flex items-center justify-between text-[9px] text-gray-500 font-semibold">
                  <span className="flex items-center gap-0.5">
                    <Calendar className="w-2.5 h-2.5" />
                    {new Date(item.timestamp).toLocaleDateString('vi-VN')}
                  </span>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-purple-400 flex items-center gap-0.5 transition-colors"
                  >
                    Watch
                    <ExternalLink className="w-2 h-2" />
                  </a>
                </div>
              </div>

              {/* Delete individual */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
                className="p-1.5 rounded-lg bg-cinema-850 hover:bg-red-950/20 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                title="Xóa bản ghi"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
