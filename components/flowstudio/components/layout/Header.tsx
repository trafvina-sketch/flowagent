import React, { useState } from 'react';
import { Sparkles, LayoutGrid, Settings, Wifi, WifiOff, ChevronRight, GitBranch, HelpCircle } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { ActiveView } from '../../types';
import GuideModal from './GuideModal';

const tabs: { key: ActiveView; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'all', label: 'Tất Cả Media', icon: <LayoutGrid className="w-3.5 h-3.5" />, color: 'text-slate-300' },
  { key: 'workflow', label: 'Workflow', icon: <GitBranch className="w-3.5 h-3.5" />, color: 'text-amber-400' },
];

interface HeaderProps {
  onRefresh: () => void;
  isLoading: boolean;
}

const Header: React.FC<HeaderProps> = ({ onRefresh, isLoading }) => {
  const activeView = useProjectStore((s) => s.activeView);
  const setActiveView = useProjectStore((s) => s.setActiveView);
  const flowkitStatus = useProjectStore((s) => s.flowkitStatus);
  const images = useProjectStore((s) => s.images);
  const videos = useProjectStore((s) => s.videos);
  const toggleSidebar = useProjectStore((s) => s.toggleSidebar);
  const isSidebarOpen = useProjectStore((s) => s.isSidebarOpen);

  const [isGuideOpen, setIsGuideOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 bg-slate-950/70 backdrop-blur-2xl border-b border-slate-900 shadow-lg shadow-black/20">
        <div className="flex items-center justify-between px-6 h-14">
          
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 shadow-md shadow-indigo-500/10">
              <Sparkles className="w-4 h-4 text-white animate-pulse" />
              <div className="absolute -inset-0.5 bg-gradient-to-tr from-violet-600 to-indigo-600 rounded-xl blur opacity-30 -z-10" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wide flex items-center">
                <span className="bg-gradient-to-r from-violet-400 via-indigo-300 to-cyan-400 bg-clip-text text-transparent font-extrabold text-base tracking-tight">FlowAgent</span>
                <span className="text-slate-400 ml-1 font-semibold text-xs bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded-md">Studio</span>
              </h1>
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex items-center gap-1.5 bg-slate-900/60 rounded-xl p-1 border border-slate-800/80 backdrop-blur-md">
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
          <div className="flex items-center gap-3">
            
            {/* Guide Button */}
            <button
              onClick={() => setIsGuideOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 transition-all active:scale-95 duration-200"
            >
              <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
              <span>Hướng Dẫn</span>
            </button>

            {/* Zalo Support Button */}
            <a
              href="https://zalo.me/0934415387"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-md shadow-blue-500/10 hover:shadow-lg hover:shadow-blue-500/25 transition-all active:scale-95 duration-200 border border-cyan-400/10"
            >
              <span>💬</span>
              <span>Hỗ trợ Zalo</span>
            </a>

            <div className="h-4 w-[1px] bg-slate-800/80 mx-1" />

            {/* Refresh */}
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 hover:border-indigo-500/40 transition-all disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                  Đang tải...
                </span>
              ) : (
                'Đồng bộ'
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
      </header>

      {/* Guide Modal */}
      <GuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </>
  );
};

export default Header;
