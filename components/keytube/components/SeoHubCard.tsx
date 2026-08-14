import React, { useState } from 'react';
import { Copy, Check, ListChecks, FileText, Clock, Hash, Smartphone, Sparkles, Star } from 'lucide-react';
import type { OptimizedSEO } from '../types';

interface SeoHubCardProps {
  seo: OptimizedSEO;
  onSelectTitle: (title: string) => void;
  selectedTitle: string;
}

export const SeoHubCard: React.FC<SeoHubCardProps> = ({ seo, onSelectTitle, selectedTitle }) => {
  const [activeTab, setActiveTab] = useState<'titles' | 'description' | 'chapters' | 'tags'>('titles');
  const [copiedStates, setCopiedStates] = useState<{ [key: string]: boolean }>({});

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedStates((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setCopiedStates((prev) => ({ ...prev, [id]: false }));
    }, 2000);
  };

  const formattedChapters = (seo.chapters || [])
    .map((ch) => `${ch?.timestamp || '00:00'} - ${ch?.title || 'Chương mới'}`)
    .join('\n');

  return (
    <div className="bg-cinema-900/60 backdrop-blur-md border border-cinema-700/40 rounded-2xl overflow-hidden shadow-xl flex flex-col h-full">
      {/* Tabs Switcher */}
      <div className="flex border-b border-cinema-800 bg-cinema-950/40 p-1">
        <button
          onClick={() => setActiveTab('titles')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'titles'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-gray-400 hover:text-gray-200 hover:bg-cinema-800/50'
          }`}
        >
          <ListChecks className="w-4 h-4" />
          <span>Tiêu đề ({(seo.titles || []).length})</span>
        </button>
        <button
          onClick={() => setActiveTab('description')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'description'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-gray-400 hover:text-gray-200 hover:bg-cinema-800/50'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Mô tả & CTA</span>
        </button>
        <button
          onClick={() => setActiveTab('chapters')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'chapters'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-gray-400 hover:text-gray-200 hover:bg-cinema-800/50'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Chapters ({(seo.chapters || []).length})</span>
        </button>
        <button
          onClick={() => setActiveTab('tags')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'tags'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-gray-400 hover:text-gray-200 hover:bg-cinema-800/50'
          }`}
        >
          <Hash className="w-4 h-4" />
          <span>Tags & Hashtags</span>
        </button>
      </div>

      {/* Tab Content Panel */}
      <div className="p-5 flex-1 overflow-y-auto">
        
        {/* TAB 1: TITLES */}
        {activeTab === 'titles' && (
          <div className="space-y-5 animate-in fade-in duration-200">
            {/* Long Video Titles */}
            <div className="space-y-3">
              <span className="text-[10px] tracking-wider uppercase font-bold text-purple-400 block">
                Tiêu đề video dài (Tối ưu click-through-rate)
              </span>
              <div className="space-y-2">
                {(seo.titles || []).map((title, i) => {
                  const isSelected = selectedTitle === title;
                  return (
                    <div
                      key={i}
                      onClick={() => onSelectTitle(title)}
                      className={`group relative p-4 rounded-xl border text-sm transition-all cursor-pointer flex items-start justify-between gap-3 ${
                        isSelected
                          ? 'bg-purple-600/10 border-purple-500 shadow-md shadow-purple-950/20'
                          : 'bg-cinema-950/30 border-cinema-800 hover:border-cinema-700/60 hover:bg-cinema-950/50'
                      }`}
                    >
                      <div className="flex-1 flex gap-2.5 items-start">
                        <span className={`w-5 h-5 flex-shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          isSelected ? 'bg-purple-600 text-white' : 'bg-cinema-800 text-gray-400'
                        }`}>
                          {i + 1}
                        </span>
                        <p className={`font-semibold leading-relaxed ${isSelected ? 'text-purple-300' : 'text-gray-200'}`}>
                          {title}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(title, `title-${i}`);
                          }}
                          className="p-1.5 bg-cinema-800 hover:bg-cinema-700 rounded-lg text-gray-400 hover:text-white transition-colors"
                          title="Sao chép tiêu đề"
                        >
                          {copiedStates[`title-${i}`] ? (
                            <Check className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-2 left-6 bg-purple-600 text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded flex items-center gap-0.5 text-white">
                          <Star className="w-2.5 h-2.5 fill-white text-white" />
                          Dùng vẽ thumbnail
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Shorts Titles */}
            {seo.shortsTitles && Array.isArray(seo.shortsTitles) && seo.shortsTitles.length > 0 && (
              <div className="space-y-3 pt-3 border-t border-cinema-800/40">
                <span className="text-[10px] tracking-wider uppercase font-bold text-pink-500 flex items-center gap-1">
                  <Smartphone className="w-3.5 h-3.5" />
                  Tiêu đề YouTube Shorts (&lt;60 Ký tự)
                </span>
                <div className="grid gap-2">
                  {(seo.shortsTitles || []).map((title, i) => (
                    <div
                      key={i}
                      className="p-3 bg-cinema-950/20 border border-cinema-800/80 rounded-xl text-xs flex items-center justify-between gap-3"
                    >
                      <p className="font-medium text-gray-300 italic">"{title}"</p>
                      <button
                        onClick={() => handleCopy(title, `shorts-${i}`)}
                        className="p-1 bg-cinema-850 hover:bg-cinema-800 rounded-md text-gray-500 hover:text-white transition-colors flex-shrink-0"
                      >
                        {copiedStates[`shorts-${i}`] ? (
                          <Check className="w-3 h-3 text-green-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DESCRIPTION */}
        {activeTab === 'description' && (
          <div className="space-y-4 animate-in fade-in duration-200 h-full flex flex-col">
            <div className="flex justify-between items-center">
              <span className="text-[10px] tracking-wider uppercase font-bold text-purple-400">
                Mô tả tối ưu chuẩn SEO
              </span>
              <button
                onClick={() => handleCopy(seo.description, 'full-desc')}
                className="px-3 py-1 bg-purple-600/10 hover:bg-purple-600/20 border border-purple-500/30 rounded-lg text-xs font-bold text-purple-400 flex items-center gap-1 transition-all"
              >
                {copiedStates['full-desc'] ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-green-400" />
                    <span>Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Chép Toàn bộ mô tả</span>
                  </>
                )}
              </button>
            </div>
            
            <textarea
              readOnly
              value={seo.description}
              className="w-full flex-1 min-h-[220px] bg-cinema-950 border border-cinema-800 text-gray-300 rounded-xl p-3 focus:outline-none text-xs font-sans leading-relaxed select-all"
            />
            
            {seo.cta && (
              <div className="p-3.5 bg-purple-950/20 border border-purple-900/30 rounded-xl">
                <span className="text-[9px] uppercase tracking-wider font-extrabold text-purple-400 block mb-1">
                  Gợi ý Kêu gọi hành động (Call-To-Action)
                </span>
                <p className="text-xs text-gray-300 leading-relaxed font-semibold italic">"{seo.cta}"</p>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CHAPTERS */}
        {activeTab === 'chapters' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex justify-between items-center">
              <span className="text-[10px] tracking-wider uppercase font-bold text-purple-400">
                Mốc thời gian phân bổ thông minh
              </span>
              <button
                onClick={() => handleCopy(formattedChapters, 'chapters')}
                className="px-3 py-1 bg-purple-600/10 hover:bg-purple-600/20 border border-purple-500/30 rounded-lg text-xs font-bold text-purple-400 flex items-center gap-1 transition-all"
              >
                {copiedStates['chapters'] ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-green-400" />
                    <span>Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép list mốc</span>
                  </>
                )}
              </button>
            </div>

            {(seo.chapters || []).length > 0 ? (
              <div className="relative border-l border-cinema-800 ml-3 pl-6 space-y-4">
                {(seo.chapters || []).map((ch, i) => (
                  <div key={i} className="relative group">
                    <span className="absolute -left-[31px] top-0 w-3.5 h-3.5 rounded-full bg-purple-600 border-2 border-cinema-900 group-hover:scale-125 transition-transform" />
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-bold font-mono text-purple-400 bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-900/30">
                        {ch.timestamp}
                      </span>
                      <p className="text-xs font-bold text-gray-200">{ch.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600 text-center py-6 font-medium">Không tạo được mốc chương tự động.</p>
            )}
          </div>
        )}

        {/* TAB 4: TAGS & HASHTAGS */}
        {activeTab === 'tags' && (
          <div className="space-y-5 animate-in fade-in duration-200">
            {/* Hashtags */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-[10px] tracking-wider uppercase font-bold text-purple-400">
                  Bộ Hashtags đề xuất ({(seo.hashtags || []).length})
                </span>
                <button
                  onClick={() => handleCopy((seo.hashtags || []).map(h => `#${h}`).join(' '), 'hashtags')}
                  className="text-[10px] font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
                >
                  {copiedStates['hashtags'] ? (
                    <>
                      <Check className="w-3 h-3 text-green-400" />
                      <span>Đã chép</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Chép bộ #</span>
                    </>
                  )}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 p-3 bg-cinema-950/20 border border-cinema-800 rounded-xl">
                {(seo.hashtags || []).map((h, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 bg-purple-950/30 text-purple-300 border border-purple-900/30 rounded-lg text-xs font-mono"
                  >
                    #{h}
                  </span>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-[10px] tracking-wider uppercase font-bold text-pink-500">
                  Thẻ Tags Video tối ưu (Điền vào mục thẻ video)
                </span>
                <button
                  onClick={() => handleCopy(seo.tags, 'tags')}
                  className="text-[10px] font-bold text-pink-400 hover:text-pink-300 flex items-center gap-1 transition-colors"
                >
                  {copiedStates['tags'] ? (
                    <>
                      <Check className="w-3 h-3 text-green-400" />
                      <span>Đã chép</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Chép bộ Tags</span>
                    </>
                  )}
                </button>
              </div>
              <div className="p-3 bg-cinema-950/20 border border-cinema-800 rounded-xl">
                <p className="text-xs font-mono text-gray-300 leading-relaxed max-h-28 overflow-y-auto select-all">
                  {seo.tags}
                </p>
              </div>
            </div>
          </div>
        )}

      </div>
      
      {/* Selected Title Notice */}
      <div className="bg-purple-950/20 border-t border-cinema-850 px-5 py-3 flex items-center justify-between text-xs">
        <span className="text-gray-400 flex items-center gap-1">
          <Sparkles className="w-4 h-4 text-purple-400" />
          Tiêu đề vẽ Thumbnail:
        </span>
        <span className="font-extrabold text-purple-300 truncate max-w-[200px]" title={selectedTitle}>
          "{selectedTitle || 'Chưa chọn'}"
        </span>
      </div>
    </div>
  );
};
