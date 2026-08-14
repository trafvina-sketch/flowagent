import React, { useState, useEffect } from 'react';
import { X, Key, ShieldCheck, HelpCircle } from 'lucide-react';
import type { Settings } from '../types';

interface ApiKeySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSave: (youtubeApiKey: string, geminiApiKeys: string[]) => void;
}

export const ApiKeySettingsModal: React.FC<ApiKeySettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [ytKey, setYtKey] = useState(settings.youtubeApiKey);
  const [geminiKeysText, setGeminiKeysText] = useState(settings.geminiApiKeys.join('\n'));
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setYtKey(settings.youtubeApiKey);
    setGeminiKeysText(settings.geminiApiKeys.join('\n'));
  }, [settings]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const splitKeys = geminiKeysText
      .split('\n')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    onSave(ytKey.trim(), splitKeys);
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-cinema-900 border border-cinema-700/60 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cinema-800 bg-cinema-950/40">
          <div className="flex items-center gap-2 text-purple-400 font-semibold text-lg">
            <Key className="w-5 h-5" />
            <span>Cài đặt API Keys</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-cinema-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* YouTube API Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-300">
                YouTube Data API Key v3
              </label>
              <a 
                href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" 
                target="_blank" 
                rel="noreferrer"
                className="text-xs text-purple-400 hover:underline flex items-center gap-1"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                Lấy Key của bạn
              </a>
            </div>
            <input
              type="text"
              value={ytKey}
              onChange={(e) => setYtKey(e.target.value)}
              placeholder="Nhập YouTube API Key của bạn..."
              className="w-full bg-cinema-950 border border-cinema-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-gray-100 placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors"
            />
            <p className="text-xs text-gray-500">
              * Chúng tôi đã tự động cấu hình một key hoạt động tốt để bạn phân tích ngay.
            </p>
          </div>

          {/* Gemini API Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-300">
                Gemini API Keys (Một key mỗi dòng)
              </label>
              <a 
                href="https://aistudio.google.com/" 
                target="_blank" 
                rel="noreferrer"
                className="text-xs text-purple-400 hover:underline flex items-center gap-1"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Lấy Gemini Key Free
              </a>
            </div>
            <textarea
              rows={4}
              value={geminiKeysText}
              onChange={(e) => setGeminiKeysText(e.target.value)}
              placeholder="Dán một hoặc nhiều API Key ở đây&#10;AIzaSy... (Dòng 1)&#10;AIzaSy... (Dòng 2)"
              className="w-full bg-cinema-950 border border-cinema-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-gray-100 placeholder-gray-600 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none transition-colors resize-none"
            />
            <p className="text-xs text-gray-500 leading-relaxed">
              Nhập nhiều key (mỗi dòng một key) sẽ kích hoạt tính năng **tự động xoay tua**. Khi một key hết hạn ngạch (quota 429), hệ thống tự động nhảy sang key tiếp theo để không gián đoạn công việc của bạn.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4 border-t border-cinema-800">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-cinema-800 hover:bg-cinema-700/80 text-gray-300 text-sm font-semibold rounded-xl transition-colors focus:outline-none"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white text-sm font-semibold rounded-xl shadow-lg transition-colors focus:outline-none flex items-center justify-center gap-2"
            >
              {saveSuccess ? (
                <>
                  <ShieldCheck className="w-4 h-4 animate-bounce" />
                  <span>Đã Lưu Thành Công!</span>
                </>
              ) : (
                <span>Lưu Cấu Hình</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
