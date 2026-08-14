import React, { useState, useEffect, useCallback } from 'react';
import { 
  Sparkles, 
  Settings as SettingsIcon, 
  Tv, 
  AlertCircle, 
  MessageSquare
} from 'lucide-react';

// Inline YouTube icon (lucide-react version in Siêu Clone doesn't export it)
const YoutubeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/>
    <path d="m10 15 5-3-5-3z"/>
  </svg>
);
import type { VideoDetails, OptimizedSEO, Settings, HistoryItem } from './types';
import { Tone } from './types';
import { extractVideoId, isValidYoutubeUrl } from './utils/helpers';
import { getVideoDetails } from './services/youtubeService';
import { optimizeSEOContent, generateThumbnailPrompt } from './services/geminiService';

import { CompetitorCard } from './components/CompetitorCard';
import { SeoHubCard } from './components/SeoHubCard';
import { ThumbnailStudio } from './components/ThumbnailStudio';
import { HistoryPanel } from './components/HistoryPanel';
import { isProxyEnabled } from '../../services/openaiProxyService';

const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};


// ─── Bridge: Đọc Gemini API keys từ hệ thống Siêu Clone ───
function getGeminiKeysFromSieuClone(): string[] {
  try {
    const stored = localStorage.getItem('gemini_api_keys');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Siêu Clone lưu dạng ApiKeyInfo[] { key, label }
      if (Array.isArray(parsed)) {
        return parsed.map((k: any) => typeof k === 'string' ? k : k.key).filter(Boolean);
      }
    }
  } catch (e) {
    console.error('[KeyTube] Failed to read Siêu Clone API keys:', e);
  }
  return [];
}

const DEFAULT_SETTINGS: Settings = {
  tone: Tone.Friendly,
  includeEmojis: true,
  channelName: '',
  videoDuration: '10:00',
  outputLanguage: 'vi',
  youtubeApiKey: 'AIzaSyDwTSvkH1mvEuXwjbnE8OqpBlI3SMZTbDk',
  geminiApiKeys: [],
};

export default function KeyTubeApp() {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentGeminiIndex, setCurrentGeminiIndex] = useState(0);
  const [proxyEnabled, setProxyEnabled] = useState(false);

  // Analysis states
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | undefined>(undefined);

  // Active Result states
  const [originalDetails, setOriginalDetails] = useState<VideoDetails | null>(null);
  const [optimizedSeo, setOptimizedSeo] = useState<OptimizedSEO | null>(null);
  const [thumbnailPrompt, setThumbnailPrompt] = useState('');
  const [selectedTitle, setSelectedTitle] = useState('');

  // Load configuration on mount — lấy keys từ Siêu Clone + settings riêng KeyTube
  useEffect(() => {
    try {
      const storedSettings = localStorage.getItem('keytube-ultimate-settings');
      if (storedSettings) {
        const parsed = JSON.parse(storedSettings);
        setSettings((prev) => ({ ...prev, ...parsed }));
      }

      const storedHistory = localStorage.getItem('keytube-ultimate-history');
      if (storedHistory) {
        try {
          const parsed = JSON.parse(storedHistory);
          if (Array.isArray(parsed)) {
            // Lọc bỏ những bản ghi lỗi để tránh crash khi render
            const cleanHistory = parsed.filter(item => item && typeof item === 'object' && item.id && item.videoId);
            setHistory(cleanHistory);
          } else {
            setHistory([]);
          }
        } catch (e) {
          console.error("Failed to parse history data, resetting:", e);
          setHistory([]);
          localStorage.removeItem('keytube-ultimate-history');
        }
      }
    } catch (err) {
      console.error("Failed to load local storage data", err);
    }
  }, []);

  // Sync Gemini keys and proxy status from Siêu Clone mỗi khi tab render hoặc lấy focus
  useEffect(() => {
    const syncKeysAndProxy = () => {
      setProxyEnabled(isProxyEnabled());
      const keysFromClone = getGeminiKeysFromSieuClone();
      if (keysFromClone.length > 0) {
        setSettings((prev) => ({ ...prev, geminiApiKeys: keysFromClone }));
      }
    };
    syncKeysAndProxy();
    window.addEventListener('focus', syncKeysAndProxy);
    return () => window.removeEventListener('focus', syncKeysAndProxy);
  }, []);

  const handleSettingChange = (key: keyof Settings, value: any) => {
    setSettings((prev) => {
      const newSettings = { ...prev, [key]: value };
      localStorage.setItem('keytube-ultimate-settings', JSON.stringify(newSettings));
      return newSettings;
    });
  };

  const saveGeminiKeyIndex = useCallback((index: number) => {
    setCurrentGeminiIndex(index);
  }, []);

  // Core 1-Click Action Flow
  const handleOneClickAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Re-sync keys from Siêu Clone trước khi phân tích
    const keysFromClone = getGeminiKeysFromSieuClone();
    const activeKeys = keysFromClone.length > 0 ? keysFromClone : settings.geminiApiKeys;
    const isProxyActive = isProxyEnabled();

    if (activeKeys.length === 0 && !isProxyActive) {
      setError("Vui lòng cấu hình ít nhất một Gemini API Key hoặc kích hoạt Advanced Proxy trong phần Cài đặt của Siêu Clone (tab 🧬 Siêu Clone → ⚙️ Cài đặt).");
      return;
    }

    if (!isValidYoutubeUrl(youtubeUrl)) {
      setError("Vui lòng cung cấp URL video đối thủ hợp lệ từ YouTube.");
      return;
    }

    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      setError("Không thể trích xuất mã Video ID từ liên kết này.");
      return;
    }

    // Update settings with synced keys
    const workingSettings = { ...settings, geminiApiKeys: activeKeys };

    setIsLoading(true);
    setError(null);
    setOriginalDetails(null);
    setOptimizedSeo(null);
    setThumbnailPrompt('');

    try {
      setLoadingStep("Bước 1/3: Đang tải thông tin chi tiết video và kênh đối thủ...");
      const details = await getVideoDetails(videoId, workingSettings.youtubeApiKey);
      setOriginalDetails(details);

      setLoadingStep("Bước 2/3: Đang dùng Gemini phân tích đối thủ & tối ưu hóa SEO...");
      const seoPack = await optimizeSEOContent(details, workingSettings, currentGeminiIndex, saveGeminiKeyIndex);
      setOptimizedSeo(seoPack);

      const defaultTitle = seoPack.titles[0] || details.title;
      setSelectedTitle(defaultTitle);

      setLoadingStep("Bước 3/3: Đang sáng tạo Prompt điện ảnh tạo ảnh Thumbnail...");
      const prompt = await generateThumbnailPrompt(
        defaultTitle,
        details.videoTopics.join(', ') || 'General',
        workingSettings,
        currentGeminiIndex,
        saveGeminiKeyIndex
      );
      setThumbnailPrompt(prompt);

      const newItem: HistoryItem = {
        id: generateUUID(),
        url: youtubeUrl,
        title: details.title,
        videoId: videoId,
        originalDetails: details,
        optimizedSEO: seoPack,
        thumbnailPrompt: prompt,
        generatedThumbnailUrl: null,
        timestamp: Date.now(),
      };

      setHistory((prev) => {
        const updated = [newItem, ...prev].slice(0, 15);
        localStorage.setItem('keytube-ultimate-history', JSON.stringify(updated));
        return updated;
      });
      setActiveAnalysisId(newItem.id);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Đã xảy ra lỗi trong quá trình tối ưu hóa. Vui lòng kiểm tra lại API Key.");
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const handleSelectHistoryItem = (item: HistoryItem) => {
    setActiveAnalysisId(item.id);
    setYoutubeUrl(item.url);
    if (item.originalDetails) setOriginalDetails(item.originalDetails);
    if (item.optimizedSEO) {
      setOptimizedSeo(item.optimizedSEO);
      setSelectedTitle(item.optimizedSEO.titles[0] || '');
    }
    if (item.thumbnailPrompt) setThumbnailPrompt(item.thumbnailPrompt);
    setError(null);
  };

  const handleDeleteHistoryItem = (id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      localStorage.setItem('keytube-ultimate-history', JSON.stringify(updated));
      return updated;
    });
    if (activeAnalysisId === id) {
      setActiveAnalysisId(undefined);
      setOriginalDetails(null);
      setOptimizedSeo(null);
      setThumbnailPrompt('');
    }
  };

  const handleClearHistory = () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử phân tích không?")) {
      setHistory([]);
      localStorage.removeItem('keytube-ultimate-history');
      setActiveAnalysisId(undefined);
      setOriginalDetails(null);
      setOptimizedSeo(null);
      setThumbnailPrompt('');
    }
  };

  const handleSelectTitle = async (title: string) => {
    setSelectedTitle(title);
    if (!originalDetails) return;

    const keysFromClone = getGeminiKeysFromSieuClone();
    const activeKeys = keysFromClone.length > 0 ? keysFromClone : settings.geminiApiKeys;
    const workingSettings = { ...settings, geminiApiKeys: activeKeys };

    setThumbnailPrompt('');
    try {
      const prompt = await generateThumbnailPrompt(
        title,
        originalDetails.videoTopics.join(', ') || 'General',
        workingSettings,
        currentGeminiIndex,
        saveGeminiKeyIndex
      );
      setThumbnailPrompt(prompt);

      if (activeAnalysisId) {
        setHistory((prev) => {
          const updated = prev.map((item) => {
            if (item.id === activeAnalysisId) {
              return { ...item, thumbnailPrompt: prompt };
            }
            return item;
          });
          localStorage.setItem('keytube-ultimate-history', JSON.stringify(updated));
          return updated;
        });
      }
    } catch (err: any) {
      console.error(err);
      setError(`Lỗi khi tạo lại prompt cho tiêu đề mới: ${err.message}`);
    }
  };

  // Đếm số key đang có
  const keyCount = getGeminiKeysFromSieuClone().length;

  return (
    <div className="keytube-tab min-h-[calc(100vh-56px)] flex flex-col p-4 sm:p-6 lg:p-8" style={{ background: '#050410', backgroundImage: 'radial-gradient(at 0% 0%, rgba(139, 92, 246, 0.15) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(236, 72, 153, 0.15) 0px, transparent 50%)' }}>
      <div className="max-w-7xl mx-auto w-full space-y-6 flex-1 flex flex-col" style={{ fontFamily: '"Plus Jakarta Sans", Outfit, sans-serif' }}>
        
        {/* Hero Section */}
        <header className="text-center py-6 space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold" style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#a855f7' }}>
            <Sparkles className="w-3.5 h-3.5" />
            Công cụ tối ưu SEO đỉnh cao cho Creator
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight" style={{ background: 'linear-gradient(to right, #a855f7, #ec4899, #f43f5e)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            KeyTube 1-Click SEO
          </h1>
          <p className="text-sm max-w-xl mx-auto leading-relaxed" style={{ color: '#9ca3af' }}>
            Dán đường link đối thủ, AI tự động phân tích sâu, tối ưu SEO, viết mô tả và vẽ ảnh thumbnail đẹp mắt.
          </p>
          {/* API Key status indicator */}
          {(proxyEnabled || keyCount > 0) && (
            <div className="flex items-center justify-center gap-2 text-xs" style={{ color: proxyEnabled ? '#a855f7' : '#22c55e' }}>
              <span className={`w-2 h-2 rounded-full ${proxyEnabled ? 'bg-purple-500 animate-pulse' : 'bg-green-500'}`} />
              {proxyEnabled
                ? 'Đang dùng Advanced Proxy từ Siêu Clone'
                : `Đang dùng ${keyCount} Gemini API key từ Siêu Clone`}
            </div>
          )}
        </header>

        {/* 1-Click CONTROL PANEL */}
        <div className="backdrop-blur-md border rounded-2xl shadow-xl p-5 sm:p-6" style={{ background: 'rgba(15,14,38,0.6)', borderColor: 'rgba(109,40,217,0.4)' }}>
          <form onSubmit={handleOneClickAnalyze} className="space-y-5">
            {/* Input URL */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>
                Đường Link Video Đối Thủ Cần Phân Tích
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-red-500">
                  <YoutubeIcon className="w-5 h-5" />
                </div>
                <input
                  type="url"
                  required
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="Ví dụ: https://www.youtube.com/watch?v=dQw4w9WgXcQ..."
                  className="w-full text-sm rounded-xl pl-11 pr-4 py-3.5 focus:outline-none transition-colors"
                  style={{ background: 'rgba(5,4,16,0.8)', border: '1px solid #1e1b4b', color: '#f3f4f6' }}
                />
              </div>
            </div>

            {/* Sub-inputs options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Tên Kênh Của Bạn</label>
                <input type="text" required value={settings.channelName} onChange={(e) => handleSettingChange('channelName', e.target.value)} placeholder="Ví dụ: Thọ Vlog..." className="w-full text-xs px-3.5 py-2.5 rounded-lg focus:outline-none" style={{ background: 'rgba(5,4,16,0.8)', border: '1px solid #1e1b4b', color: '#e5e7eb' }} />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Độ Dài Video Mới (Chapters)</label>
                <input type="text" required value={settings.videoDuration} onChange={(e) => handleSettingChange('videoDuration', e.target.value)} placeholder="Ví dụ: 12:30 hoặc 15 phút" className="w-full text-xs px-3.5 py-2.5 rounded-lg focus:outline-none" style={{ background: 'rgba(5,4,16,0.8)', border: '1px solid #1e1b4b', color: '#e5e7eb' }} />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Giọng điệu SEO</label>
                <select value={settings.tone} onChange={(e) => handleSettingChange('tone', e.target.value as Tone)} className="w-full text-xs px-3.5 py-2.5 rounded-lg focus:outline-none" style={{ background: 'rgba(5,4,16,0.8)', border: '1px solid #1e1b4b', color: '#d1d5db' }}>
                  {Object.values(Tone).map((tone) => (<option key={tone} value={tone}>{tone}</option>))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Ngôn ngữ kết quả</label>
                <select value={settings.outputLanguage} onChange={(e) => handleSettingChange('outputLanguage', e.target.value)} className="w-full text-xs px-3.5 py-2.5 rounded-lg focus:outline-none" style={{ background: 'rgba(5,4,16,0.8)', border: '1px solid #1e1b4b', color: '#d1d5db' }}>
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                </select>
              </div>
            </div>

            {/* Checkbox */}
            <div className="flex flex-wrap items-center gap-5 pt-1 text-xs" style={{ color: '#9ca3af' }}>
              <label className="flex items-center gap-2 cursor-pointer select-none hover:text-gray-200 transition-colors">
                <input type="checkbox" checked={settings.includeEmojis} onChange={(e) => handleSettingChange('includeEmojis', e.target.checked)} className="rounded" style={{ background: 'rgba(5,4,16,0.8)', borderColor: '#1e1b4b' }} />
                Chèn Emojis vào SEO
              </label>
            </div>

            {/* Error display */}
            {error && (
              <div className="p-4 rounded-xl flex gap-3 items-center text-sm" style={{ background: 'rgba(127,29,29,0.2)', border: '1px solid rgba(127,29,29,0.4)', color: '#fca5a5' }}>
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                <p className="font-medium">{error}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full text-white font-extrabold py-4 rounded-xl shadow-xl transition-all duration-300 transform active:scale-[0.98] flex items-center justify-center gap-2.5 text-sm focus:outline-none"
              style={{ background: 'linear-gradient(to right, #7c3aed, #ec4899, #f43f5e)' }}
            >
              <Sparkles className="w-5 h-5 text-yellow-300" />
              {isLoading ? "ĐANG TIẾN HÀNH PHÂN TÍCH..." : "PHÂN TÍCH & TỐI ƯU HÓA 1-CLICK"}
            </button>
          </form>

          {/* Loading indicator */}
          {isLoading && (
            <div className="mt-6 p-5 rounded-xl space-y-4 animate-pulse" style={{ background: 'rgba(5,4,16,1)', border: '1px solid #1e1b4b' }}>
              <div className="flex items-center justify-between text-xs font-bold" style={{ color: '#a855f7' }}>
                <span>{loadingStep}</span>
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8b5cf6', animationDelay: '100ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8b5cf6', animationDelay: '200ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8b5cf6', animationDelay: '300ms' }} />
                </span>
              </div>
              <div className="w-full rounded-full h-2" style={{ background: '#0f0e26' }}>
                <div 
                  className="h-2 rounded-full transition-all duration-500"
                  style={{
                    background: 'linear-gradient(to right, #8b5cf6, #ec4899, #f43f5e)',
                    width: loadingStep.includes('Bước 1') ? '33%' : loadingStep.includes('Bước 2') ? '66%' : '90%'
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* DASHBOARD RESULT SECTION */}
        {(originalDetails || optimizedSeo || thumbnailPrompt) && (
          <div id="dashboard-results" className="space-y-6 pt-4">
            <div className="flex items-center gap-3">
              <div className="h-0.5 flex-1" style={{ background: 'rgba(30,27,75,0.8)' }} />
              <h2 className="text-sm font-extrabold uppercase tracking-widest flex items-center gap-1.5" style={{ background: 'linear-gradient(to right, #a855f7, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                <Tv className="w-4 h-4" style={{ color: '#a855f7', WebkitTextFillColor: 'initial' }} />
                BẢNG ĐIỀU KHIỂN KẾT QUẢ SEO & THUMBNAIL
              </h2>
              <div className="h-0.5 flex-1" style={{ background: 'rgba(30,27,75,0.8)' }} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
              <div className="md:col-span-1">
                {originalDetails && (<CompetitorCard details={originalDetails} videoId={extractVideoId(youtubeUrl) || ''} />)}
              </div>
              <div className="md:col-span-1">
                {optimizedSeo && (<SeoHubCard seo={optimizedSeo} onSelectTitle={handleSelectTitle} selectedTitle={selectedTitle} />)}
              </div>
              <div className="md:col-span-1">
                <ThumbnailStudio promptText={thumbnailPrompt} />
              </div>
            </div>
          </div>
        )}

        {/* HISTORY LIST */}
        <HistoryPanel
          history={history}
          onSelect={handleSelectHistoryItem}
          onDelete={handleDeleteHistoryItem}
          onClear={handleClearHistory}
          activeId={activeAnalysisId}
        />
      </div>
    </div>
  );
}
