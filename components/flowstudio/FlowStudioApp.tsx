import React, { useEffect, useCallback, useState } from 'react';
import axios from 'axios';
import toast, { Toaster } from 'react-hot-toast';
import { Upload, LayoutGrid, GitBranch, Wifi, WifiOff, RefreshCw, Settings, ChevronRight, Trash2, HelpCircle } from 'lucide-react';
import { API } from './config';
import { useProjectStore } from './store/useProjectStore';
import type { MediaItem, MediaStats, ActiveView } from './types';
import ImageGallery from './components/gallery/ImageGallery';
import VideoGallery from './components/gallery/VideoGallery';
import MediaPreviewModal from './components/gallery/MediaPreviewModal';
import ConnectionStatus from './components/sidebar/ConnectionStatus';
import SettingsPanel from './components/sidebar/SettingsPanel';
import WorkflowCanvas from './components/workflow/WorkflowCanvas';

const tabs: { key: ActiveView; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'all', label: 'Tất Cả Media', icon: <LayoutGrid className="w-3.5 h-3.5" />, color: 'text-slate-300' },
  { key: 'workflow', label: 'Workflow', icon: <GitBranch className="w-3.5 h-3.5" />, color: 'text-amber-400' },
];

const FlowStudioApp: React.FC = () => {
  const activeView = useProjectStore((s) => s.activeView);
  const setActiveView = useProjectStore((s) => s.setActiveView);
  const images = useProjectStore((s) => s.images);
  const videos = useProjectStore((s) => s.videos);
  const setImages = useProjectStore((s) => s.setImages);
  const setVideos = useProjectStore((s) => s.setVideos);
  const removeMedia = useProjectStore((s) => s.removeMedia);
  const previewMedia = useProjectStore((s) => s.previewMedia);
  const setPreviewMedia = useProjectStore((s) => s.setPreviewMedia);
  const isSidebarOpen = useProjectStore((s) => s.isSidebarOpen);
  const toggleSidebar = useProjectStore((s) => s.toggleSidebar);
  const setBackendStatus = useProjectStore((s) => s.setBackendStatus);
  const setFlowkitStatus = useProjectStore((s) => s.setFlowkitStatus);
  const flowkitStatus = useProjectStore((s) => s.flowkitStatus);
  const backendStatus = useProjectStore((s) => s.backendStatus);

  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Fetch media from backend
  const fetchMedia = useCallback(async () => {
    setIsLoading(true);
    try {
      const [imgRes, vidRes, statsRes] = await Promise.all([
        axios.get(API.images),
        axios.get(API.videos),
        axios.get(API.mediaStats),
      ]);
      setImages(imgRes.data.images || imgRes.data);
      setVideos(vidRes.data.videos || vidRes.data);
      setStats(statsRes.data);
      setBackendStatus('connected');
    } catch (err) {
      console.error('Failed to fetch media:', err);
      setBackendStatus('disconnected');
    } finally {
      setIsLoading(false);
    }
  }, [setImages, setVideos, setBackendStatus]);

  // Check FlowKit status
  const checkFlowkit = useCallback(async () => {
    try {
      const res = await axios.get(API.flowkitStatus);
      setFlowkitStatus(res.data.connected ? 'connected' : 'disconnected');
    } catch {
      setFlowkitStatus('disconnected');
    }
  }, [setFlowkitStatus]);
  // Initial load
  useEffect(() => {
    fetchMedia();
    checkFlowkit();
    const interval = setInterval(checkFlowkit, 10000);
    return () => clearInterval(interval);
  }, [fetchMedia, checkFlowkit]);

  // Sync API & Proxy settings from Siêu Clone
  useEffect(() => {
    const syncSettings = () => {
      try {
        const proxyStored = localStorage.getItem('advanced_api_proxy');
        const geminiStored = localStorage.getItem('gemini_api_keys');
        
        let targetEndpoint = 'http://127.0.0.1:8045';
        let targetKey = '';
        
        if (proxyStored) {
          const parsedProxy = JSON.parse(proxyStored);
          if (parsedProxy.enabled && parsedProxy.apiKey) {
            targetEndpoint = parsedProxy.baseUrl || 'http://127.0.0.1:8045';
            targetKey = parsedProxy.apiKey;
          }
        }
        
        // If proxy is not enabled/provided, but Gemini keys exist, use them
        if (!targetKey && geminiStored) {
          const parsedGemini = JSON.parse(geminiStored);
          if (Array.isArray(parsedGemini) && parsedGemini.length > 0) {
            targetEndpoint = 'https://generativelanguage.googleapis.com';
            targetKey = parsedGemini.map((k: any) => k.key).join(',');
          }
        }
        
        const currentSettings = useProjectStore.getState().settings;
        if (
          currentSettings.aiProxyEndpoint !== targetEndpoint ||
          currentSettings.aiProxyKey !== targetKey
        ) {
          console.log('🔄 Syncing Siêu Clone API configuration to FlowStudio:', { targetEndpoint, hasKey: !!targetKey });
          useProjectStore.getState().setSettings({
            aiProxyEndpoint: targetEndpoint,
            aiProxyKey: targetKey,
          });
        }
      } catch (err) {
        console.error('Failed to sync Siêu Clone API settings to FlowStudio:', err);
      }
    };

    syncSettings();
    window.addEventListener('focus', syncSettings);
    return () => window.removeEventListener('focus', syncSettings);
  }, []);
  // Delete ALL media
  const handleDeleteAll = useCallback(async () => {
    const allItems = [...images, ...videos];
    if (allItems.length === 0) return;

    const confirmed = window.confirm(`Xoá tất cả ${allItems.length} files trong thư viện? Không thể hoàn tác!`);
    if (!confirmed) return;

    const toastId = toast.loading(`Đang xoá ${allItems.length} files...`);
    let deleted = 0;

    for (const item of allItems) {
      try {
        await axios.delete(API.mediaDelete(item.id));
        removeMedia(item.id);
        deleted++;
      } catch {}
    }

    toast.success(`Đã xoá ${deleted}/${allItems.length} files`, { id: toastId });
    fetchMedia();
  }, [images, videos, removeMedia, fetchMedia]);

  // Upload handler
  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);

        try {
          const res = await axios.post(API.mediaUpload, formData);
          const newItem: MediaItem = res.data.file || res.data;
          useProjectStore.getState().addMedia(newItem);
          toast.success(`Uploaded: ${file.name}`);
        } catch (err) {
          console.error('Upload failed:', err);
          toast.error(`Upload failed: ${file.name}`);
        }
      }

      const statsRes = await axios.get(API.mediaStats);
      setStats(statsRes.data);
    },
    []
  );

  // Drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleUpload(e.dataTransfer.files);
    },
    [handleUpload]
  );

  // All media combined for modal navigation
  const allMedia = [...images, ...videos];

  return (
    <div
      className="flow-studio flex flex-col h-full min-h-[calc(100vh-56px)]"
      style={{ background: '#0f172a' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Toaster
        position="bottom-right"
        containerStyle={{ bottom: 80 }}
        toastOptions={{
          style: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', fontSize: '13px', maxWidth: '360px' },
          duration: 3000,
          success: { duration: 2500 },
          error: { duration: 4000 },
          loading: { duration: 8000 },
        }}
        gutter={6}
      />

      {/* ── Sub-header: Tab nav + actions ── */}
      <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-2xl border-b border-slate-800/80">
        <div className="flex items-center justify-between px-6 h-12">
          {/* Logo & Brand Title */}
          <div className="flex items-center gap-3">
            <img src="./logo.png" alt="FlowAgent AI Logo" className="w-7 h-7 object-contain rounded-lg shadow-md border border-indigo-500/30" />
            <h1 className="text-sm font-extrabold text-white tracking-wide">FlowAgent AI</h1>
            <div className="w-px h-4 bg-slate-800 mx-1" />
          </div>

          {/* Sub-tabs */}
          <nav className="flex items-center gap-1.5 bg-slate-900/60 rounded-xl p-1 border border-slate-800/80">
            {tabs.map((tab) => {
              const isActive = activeView === tab.key;
              const count = tab.key === 'all' ? images.length + videos.length : -1;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveView(tab.key)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-300 ${
                    isActive
                      ? 'bg-slate-800 text-white shadow-md border border-slate-700/50'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <span className={isActive ? tab.color : 'text-slate-500'}>{tab.icon}</span>
                  <span>{tab.label}</span>
                  {count > 0 && (
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full transition-all duration-300 ${
                        isActive
                          ? 'bg-indigo-500/20 text-indigo-400'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {/* Refresh */}
            <button
              onClick={fetchMedia}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 hover:border-indigo-500/40 transition-all disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                  Đang tải...
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3" />
                  Đồng bộ
                </span>
              )}
            </button>

            {/* FlowAgent Status */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                flowkitStatus === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-sm shadow-emerald-500/5'
                  : 'bg-slate-900/60 text-slate-500 border-slate-800'
              }`}
              title={flowkitStatus === 'connected' ? 'FlowAgent Extension đã kết nối' : 'FlowAgent Extension chưa kết nối'}
            >
              {flowkitStatus === 'connected' ? (
                <>
                  <Wifi className="w-3 h-3 text-emerald-400" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-slate-500" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                </>
              )}
              <span>FlowAgent</span>
            </div>

            {/* Backend Status */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                backendStatus === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${backendStatus === 'connected' ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span>Backend</span>
            </div>

            {/* Settings toggle */}
            <button
              onClick={toggleSidebar}
              className={`p-2 rounded-lg transition-all border ${
                isSidebarOpen
                  ? 'bg-slate-800 text-white border-slate-700'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border-transparent'
              }`}
            >
              {isSidebarOpen ? <ChevronRight className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <main className={`flex-1 overflow-y-auto ${activeView === 'workflow' ? '' : 'p-6'}`}>
          {activeView === 'workflow' && (
            <div style={{ height: 'calc(100vh - 112px)' }}>
              <WorkflowCanvas />
            </div>
          )}
          {activeView === 'all' && (
            <div className="space-y-8">
              {images.length > 0 && (
                <ImageGallery images={images} onRefresh={fetchMedia} onCreateVideo={() => {}} />
              )}
              {videos.length > 0 && (
                <VideoGallery videos={videos} onRefresh={fetchMedia} />
              )}
              {images.length === 0 && videos.length === 0 && (
                <div className="flex flex-col items-center justify-center py-32 slide-up">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 flex items-center justify-center mb-6 border border-indigo-500/20">
                    <Upload className="w-8 h-8 text-indigo-400" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-200 mb-2">Chào mừng đến với FlowAgent Studio</h2>
                  <p className="text-sm text-slate-500 max-w-md text-center mb-6">
                    Tải hình ảnh/video của bạn lên, hoặc sử dụng Workflow để sản xuất thước phim AI tự động.
                  </p>
                  <label className="cursor-pointer px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-all border border-slate-700">
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      accept="image/*,video/*"
                      onChange={(e) => handleUpload(e.target.files)}
                    />
                    Upload Media
                  </label>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside
          className={`bg-slate-900/60 border-l border-slate-800/80 overflow-y-auto transition-all duration-300 ease-out shrink-0 ${
            isSidebarOpen ? 'w-[300px] p-4' : 'w-0 p-0 overflow-hidden'
          }`}
        >
          {isSidebarOpen && (
            <div className="space-y-6 fade-in">
              <ConnectionStatus />
              <div className="border-t border-slate-800/50" />
              <SettingsPanel stats={stats} onDeleteAll={handleDeleteAll} />

              {/* Upload zone */}
              <div className="border-t border-slate-800/50 pt-4">
                <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-700/50 hover:border-indigo-500/50 rounded-xl cursor-pointer transition-all group hover:bg-indigo-500/5">
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    accept="image/*,video/*"
                    onChange={(e) => handleUpload(e.target.files)}
                  />
                  <Upload className="w-6 h-6 text-slate-500 group-hover:text-indigo-400 mb-2 transition-colors" />
                  <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors font-medium">
                    Click or drag files here
                  </span>
                </label>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] modal-backdrop flex items-center justify-center pointer-events-none">
          <div className="glass-card p-10 glow-primary text-center slide-up">
            <Upload className="w-12 h-12 text-indigo-400 mx-auto mb-4" />
            <p className="text-lg font-bold text-white">Drop files to upload</p>
            <p className="text-sm text-slate-400 mt-1">Images and videos are supported</p>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      <MediaPreviewModal
        media={previewMedia}
        onClose={() => setPreviewMedia(null)}
        allMedia={allMedia}
      />
    </div>
  );
};

export default FlowStudioApp;
