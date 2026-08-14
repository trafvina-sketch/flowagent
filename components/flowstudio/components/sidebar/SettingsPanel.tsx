import React from 'react';
import { Settings, Key, HardDrive, Image, Video, Database, Trash2 } from 'lucide-react';
import axios from 'axios';
import { API } from '../../config';
import { useProjectStore } from '../../store/useProjectStore';
import type { MediaStats } from '../../types';

interface SettingsPanelProps {
  stats: MediaStats | null;
  onDeleteAll?: () => void;
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const SettingsPanel: React.FC<SettingsPanelProps> = ({ stats, onDeleteAll }) => {
  const settings = useProjectStore((s) => s.settings);
  const setSettings = useProjectStore((s) => s.setSettings);

  const handleSettingChange = async (updates: Partial<typeof settings>) => {
    setSettings(updates);
    try {
      await axios.post(API.project, updates);
    } catch (err) {
      console.error('Failed to save project settings:', err);
    }
  };

  return (
    <div className="space-y-5">
      {/* Settings Header */}
      <div className="flex items-center gap-2">
        <Settings className="w-4 h-4 text-indigo-400" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Settings</h3>
      </div>

      {/* Project ID — auto-saves on change */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <Key className="w-3 h-3" />
          Project ID (Google Labs)
        </label>
        <input
          type="text"
          value={settings.flowkitProjectId}
          onChange={(e) => handleSettingChange({ flowkitProjectId: e.target.value })}
          className="w-full bg-slate-950 text-slate-300 text-xs p-2.5 rounded-lg border border-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all placeholder:text-slate-600"
          placeholder="Paste Project ID from URL..."
        />
        <p className="text-[8px] text-slate-600">Tự lưu khi nhập</p>
      </div>



      {/* Global Visual Style Setting */}
      <div className="space-y-1.5 p-3 bg-slate-900/50 rounded-xl border border-slate-800/80">
        <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-300 uppercase tracking-wider">
          🎨 Global Visual Style
        </label>
        
        <select
          value={
            [
              '',
              ', cinematic moody lighting, shot on 35mm anamorphic lens, f/1.2, masterfully color graded Arri Log-C profile, 4K.',
              ', UGC style, captured on iPhone camera, natural indoor lighting, organic textures, natural background.',
              ', unboxing style, clean studio lighting, top-down perspective, high detailed, commercial look.',
              ', professional product photography, soft studio softbox lighting, clean studio background, sharp focus, 8K resolution.',
              ', 3D Pixar style, cute character design, vibrant colors, soft clay render, high quality 3D model.',
              ', beautiful anime hand-drawn style, detailed line art, colorful key visuals, Makoto Shinkai aesthetic.'
            ].includes(settings.globalArtStyle || '')
              ? settings.globalArtStyle || ''
              : 'custom'
          }
          onChange={(e) => {
            if (e.target.value !== 'custom') {
              handleSettingChange({ globalArtStyle: e.target.value });
            }
          }}
          className="w-full bg-slate-950 text-slate-300 text-xs p-2.5 rounded-lg border border-slate-700 focus:border-indigo-500 focus:outline-none transition-all"
        >
          <option value="">None / Custom Only</option>
          <option value=", cinematic moody lighting, shot on 35mm anamorphic lens, f/1.2, masterfully color graded Arri Log-C profile, 4K.">🎬 TVC Điện ảnh (Cinematic)</option>
          <option value=", UGC style, captured on iPhone camera, natural indoor lighting, organic textures, natural background.">📱 UGC Chân thực (UGC Natural)</option>
          <option value=", unboxing style, clean studio lighting, top-down perspective, high detailed, commercial look.">🛍️ TikTok Review (TikTok Setup)</option>
          <option value=", professional product photography, soft studio softbox lighting, clean studio background, sharp focus, 8K resolution.">📸 Studio Thương mại (Commercial)</option>
          <option value=", 3D Pixar style, cute character design, vibrant colors, soft clay render, high quality 3D model.">🧸 Hoạt hình 3D (Pixar/3D)</option>
          <option value=", beautiful anime hand-drawn style, detailed line art, colorful key visuals, Makoto Shinkai aesthetic.">🎨 Vẽ tay Anime (Anime Art)</option>
          <option value="custom" disabled={settings.globalArtStyle === ''}>✍️ Custom Suffix (Editing below)</option>
        </select>

        <textarea
          value={settings.globalArtStyle || ''}
          onChange={(e) => handleSettingChange({ globalArtStyle: e.target.value })}
          rows={3}
          className="w-full bg-slate-950 text-slate-300 text-xs p-2 rounded-lg border border-slate-700 focus:border-indigo-500 focus:outline-none transition-all placeholder:text-slate-600 font-mono text-[10px]"
          placeholder="e.g. , cinematic lighting, 8k resolution, highly detailed"
        />
        <p className="text-[8px] text-slate-500 leading-normal">
          Hệ thống sẽ tự động ghép phong cách này vào cuối tất cả các prompt khi sinh ảnh/video để đảm bảo tính đồng nhất 100%.
        </p>
      </div>

      {/* Storage Stats */}
      {stats && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-slate-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Storage</h3>
            </div>
            {(stats.totalImages + stats.totalVideos > 0) && onDeleteAll && (
              <button
                onClick={onDeleteAll}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-600/10 hover:bg-red-600/20 text-red-400 hover:text-red-300 text-[9px] font-bold border border-red-500/20 hover:border-red-500/40 transition-all"
              >
                <Trash2 className="w-3 h-3" />
                Xoá tất cả
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 text-center">
              <Image className="w-4 h-4 text-indigo-400 mx-auto mb-1.5" />
              <p className="text-lg font-bold text-white">{stats.totalImages}</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider">Images</p>
            </div>
            <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 text-center">
              <Video className="w-4 h-4 text-emerald-400 mx-auto mb-1.5" />
              <p className="text-lg font-bold text-white">{stats.totalVideos}</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider">Videos</p>
            </div>
            <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 text-center">
              <Database className="w-4 h-4 text-amber-400 mx-auto mb-1.5" />
              <p className="text-lg font-bold text-white">{formatSize(stats.totalSize)}</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider">Total</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;
