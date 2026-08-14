import React, { useState, useEffect } from 'react';
import { getApiKeys, saveApiKeys, ApiKeyInfo, removeApiKey, addApiKey, getCurrentKeyIndex, setCurrentKeyIndex } from '../services/apiKeyService';
import { getProxyConfig, saveProxyConfig, ProxyConfig, PROXY_MODELS } from '../services/openaiProxyService';
import { TrashIcon } from './icons/TrashIcon';
import { XIcon } from './icons/XIcon';
import { KeyIcon } from './icons/KeyIcon';
import { motion, AnimatePresence } from 'motion/react';

interface ApiKeySettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

type SettingsTab = 'gemini' | 'proxy';

const ApiKeySettings: React.FC<ApiKeySettingsProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<SettingsTab>('gemini');

    // ── Gemini Keys state ──
    const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
    const [newKey, setNewKey] = useState('');
    const [newLabel, setNewLabel] = useState('');
    const [currentIndex, setCurrentIndex] = useState(0);

    // ── Proxy state ──
    const [proxyConfig, setProxyConfig] = useState<ProxyConfig>({ baseUrl: 'http://127.0.0.1:8045/v1', apiKey: '', enabled: false });

    useEffect(() => {
        if (isOpen) {
            setKeys(getApiKeys());
            setCurrentIndex(getCurrentKeyIndex());
            setProxyConfig(getProxyConfig());
        }
    }, [isOpen]);

    // ── Gemini handlers ──
    const handleAddKey = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newKey.trim()) return;
        
        const label = newLabel.trim() || `Key ${keys.length + 1}`;
        addApiKey(newKey.trim(), label);
        setKeys(getApiKeys());
        setNewKey('');
        setNewLabel('');
    };

    const handleRemoveKey = (index: number) => {
        removeApiKey(index);
        setKeys(getApiKeys());
        setCurrentIndex(getCurrentKeyIndex());
    };

    const handleSelectKey = (index: number) => {
        setCurrentKeyIndex(index);
        setCurrentIndex(index);
    };

    // ── Proxy handlers ──
    const handleProxyChange = (field: keyof ProxyConfig, value: string | boolean) => {
        const updated = { ...proxyConfig, [field]: value };
        setProxyConfig(updated);
        saveProxyConfig(updated);
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
                <motion.div 
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border"
                    style={{ 
                        background: '#0f0e26', 
                        borderColor: 'rgba(139, 92, 246, 0.25)',
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), 0 0 40px rgba(139, 92, 246, 0.1)'
                    }}
                >
                    {/* Header */}
                    <div className="p-6 border-b flex justify-between items-center bg-black/20" style={{ borderColor: 'rgba(139, 92, 246, 0.15)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center border" style={{ background: 'rgba(139, 92, 246, 0.1)', borderColor: 'rgba(139, 92, 246, 0.2)' }}>
                                <KeyIcon className="w-5 h-5 text-purple-400" />
                            </div>
                            <h2 className="text-xl font-bold tracking-tight text-white" style={{ fontFamily: '"Plus Jakarta Sans", Outfit, sans-serif' }}>Cấu hình API</h2>
                        </div>
                        <button 
                            onClick={onClose}
                            className="p-2 hover:bg-white/5 rounded-full transition-all text-gray-400 hover:text-white"
                        >
                            <XIcon className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Tab Navigation */}
                    <div className="flex border-b bg-black/10" style={{ borderColor: 'rgba(139, 92, 246, 0.15)' }}>
                        {([
                            { id: 'gemini' as SettingsTab, label: 'Gemini API Keys', icon: '🔑' },
                            { id: 'proxy' as SettingsTab, label: 'Advanced Proxy', icon: '🚀' },
                        ]).map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 px-4 py-3 text-sm font-bold transition-all relative ${
                                    activeTab === tab.id
                                        ? 'text-purple-400'
                                        : 'text-gray-400 hover:text-gray-200'
                                }`}
                            >
                                <span className="flex items-center justify-center gap-2">
                                    <span>{tab.icon}</span>
                                    {tab.label}
                                </span>
                                {activeTab === tab.id && (
                                    <motion.div
                                        layoutId="activeTab"
                                        className="absolute bottom-0 left-0 right-0 h-0.5"
                                        style={{ background: 'linear-gradient(to right, #8b5cf6, #ec4899)' }}
                                    />
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Tab Content */}
                    <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto" style={{ scrollbarColor: 'rgba(139, 92, 246, 0.2) transparent' }}>
                        {activeTab === 'gemini' ? (
                            /* ════════════════════════════════════════════
                                TAB 1: GEMINI API KEYS
                                ════════════════════════════════════════════ */
                            <>
                                <div className="space-y-4">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400/80">Danh sách API Keys</h3>
                                    {keys.length === 0 ? (
                                        <div className="p-8 text-center border border-dashed rounded-xl" style={{ borderColor: 'rgba(139, 92, 246, 0.2)', background: 'rgba(139, 92, 246, 0.02)' }}>
                                            <p className="text-gray-500 italic text-sm">Chưa có API key nào được cấu hình.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {keys.map((keyInfo, index) => (
                                                <div 
                                                    key={index}
                                                    className={`group flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                        currentIndex === index 
                                                        ? 'border-purple-500/50 shadow-md shadow-purple-950/20' 
                                                        : 'hover:border-purple-500/20'
                                                    }`}
                                                    style={{
                                                        background: currentIndex === index ? 'rgba(139, 92, 246, 0.08)' : 'rgba(5, 4, 16, 0.4)',
                                                        borderColor: currentIndex === index ? 'rgba(139, 92, 246, 0.4)' : '#1e1b4b'
                                                    }}
                                                >
                                                    <div 
                                                        className="flex-1 cursor-pointer"
                                                        onClick={() => handleSelectKey(index)}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-gray-200 text-sm">{keyInfo.label}</span>
                                                            {currentIndex === index && (
                                                                <span className="text-[9px] bg-purple-600 text-white px-2 py-0.5 rounded-full uppercase font-extrabold tracking-wider">Đang dùng</span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-gray-400 font-mono truncate max-w-[280px] mt-0.5">
                                                            {keyInfo.key.substring(0, 8)}••••••••{keyInfo.key.substring(keyInfo.key.length - 4)}
                                                        </div>
                                                    </div>
                                                    <button 
                                                        onClick={() => handleRemoveKey(index)}
                                                        className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                        title="Xóa key này"
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <form onSubmit={handleAddKey} className="space-y-4 pt-4 border-t" style={{ borderColor: 'rgba(139, 92, 246, 0.15)' }}>
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400/80">Thêm Key mới</h3>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 mb-1 ml-1">Tên gợi nhớ</label>
                                            <input 
                                                type="text"
                                                value={newLabel}
                                                onChange={(e) => setNewLabel(e.target.value)}
                                                placeholder="Ví dụ: Key phụ 1"
                                                className="w-full px-4 py-2.5 rounded-xl outline-none transition-all text-xs"
                                                style={{ background: 'rgba(5, 4, 16, 0.8)', border: '1px solid #1e1b4b', color: '#f3f4f6' }}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 mb-1 ml-1">Gemini API Key</label>
                                            <input 
                                                type="password"
                                                value={newKey}
                                                onChange={(e) => setNewKey(e.target.value)}
                                                placeholder="Nhập API Key của bạn..."
                                                className="w-full px-4 py-2.5 rounded-xl outline-none transition-all text-xs font-mono"
                                                style={{ background: 'rgba(5, 4, 16, 0.8)', border: '1px solid #1e1b4b', color: '#f3f4f6' }}
                                                required
                                            />
                                        </div>
                                        <button 
                                            type="submit"
                                            className="w-full py-3 text-white rounded-xl font-extrabold transition-all active:scale-[0.98] text-xs"
                                            style={{ 
                                                background: 'linear-gradient(to right, #7c3aed, #ec4899)',
                                                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)'
                                            }}
                                        >
                                            Thêm vào danh sách
                                        </button>
                                    </div>
                                </form>
                            </>
                        ) : (
                            /* ════════════════════════════════════════════
                                TAB 2: ADVANCED PROXY (OpenAI-Compatible)
                                ════════════════════════════════════════════ */
                            <>
                                {/* Enable/Disable Toggle */}
                                <div className="flex items-center justify-between p-4 rounded-xl border bg-black/10" style={{ borderColor: '#1e1b4b' }}>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-bold text-gray-200">Kích hoạt Proxy nâng cao</h3>
                                        <p className="text-xs text-gray-400 mt-1 leading-normal">
                                            Sử dụng proxy server tương thích OpenAI API để truy cập nhiều model hơn (Gemini 3, Claude, ...).
                                        </p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer ml-4">
                                        <input
                                            type="checkbox"
                                            checked={proxyConfig.enabled}
                                            onChange={(e) => handleProxyChange('enabled', e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-gray-800 peer-focus:ring-2 peer-focus:ring-purple-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-600 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                                    </label>
                                </div>

                                {/* Proxy URL */}
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-gray-400 ml-1">Base URL</label>
                                    <input 
                                        type="text"
                                        value={proxyConfig.baseUrl}
                                        onChange={(e) => handleProxyChange('baseUrl', e.target.value)}
                                        placeholder="http://127.0.0.1:8045/v1"
                                        className="w-full px-4 py-2.5 rounded-xl outline-none transition-all text-xs font-mono"
                                        style={{ background: 'rgba(5, 4, 16, 0.8)', border: '1px solid #1e1b4b', color: '#f3f4f6' }}
                                    />
                                    <p className="text-[10px] text-gray-500 ml-1">Endpoint tương thích OpenAI (ví dụ: Antigravity Tools proxy)</p>
                                </div>

                                {/* Proxy API Key */}
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-gray-400 ml-1">API Key (Proxy)</label>
                                    <input 
                                        type="password"
                                        value={proxyConfig.apiKey}
                                        onChange={(e) => handleProxyChange('apiKey', e.target.value)}
                                        placeholder="sk-xxxx..."
                                        className="w-full px-4 py-2.5 rounded-xl outline-none transition-all text-xs font-mono"
                                        style={{ background: 'rgba(5, 4, 16, 0.8)', border: '1px solid #1e1b4b', color: '#f3f4f6' }}
                                    />
                                    <p className="text-[10px] text-gray-500 ml-1">API Key từ trang Settings của Antigravity Tools</p>
                                </div>

                                {/* Status indicator */}
                                <div className={`flex items-center gap-2 p-3 rounded-xl border ${
                                    proxyConfig.enabled && proxyConfig.apiKey
                                        ? 'bg-green-950/20 border-green-900/30'
                                        : 'bg-black/20 border-[#1e1b4b]'
                                }`}>
                                    <div className={`w-2.5 h-2.5 rounded-full ${
                                        proxyConfig.enabled && proxyConfig.apiKey
                                            ? 'bg-green-500 animate-pulse'
                                            : 'bg-gray-700'
                                    }`} />
                                    <span className={`text-xs font-bold ${
                                        proxyConfig.enabled && proxyConfig.apiKey
                                            ? 'text-green-400'
                                            : 'text-gray-400'
                                    }`}>
                                        {proxyConfig.enabled && proxyConfig.apiKey
                                            ? `Đang kết nối → ${proxyConfig.baseUrl}`
                                            : proxyConfig.enabled
                                            ? 'Đã bật nhưng chưa nhập API Key'
                                            : 'Chưa kích hoạt'
                                        }
                                    </span>
                                </div>

                                {/* Supported Models */}
                                <div className="space-y-2">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-purple-400/80">Models hỗ trợ ({PROXY_MODELS.length})</h3>
                                    <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                                        {PROXY_MODELS.map(m => (
                                            <div 
                                                key={m.id} 
                                                className="flex items-center justify-between px-3 py-2 rounded-lg border text-xs bg-[#050410]/20"
                                                style={{ borderColor: '#1e1b4b' }}
                                            >
                                                <div>
                                                    <span className="font-bold text-gray-200">{m.name}</span>
                                                    <span className="ml-2 text-purple-400/60 font-mono text-[10px]">{m.id}</span>
                                                </div>
                                                <span className="text-[10px] text-gray-500">{m.description}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-6 bg-black/40 border-t" style={{ borderColor: 'rgba(139, 92, 246, 0.15)' }}>
                        <p className="text-xs text-gray-400 leading-relaxed font-medium italic">
                            {activeTab === 'gemini'
                                ? '* Hệ thống sẽ tự động xoay vòng sang key tiếp theo nếu key hiện tại hết hạn mức (Quota Exceeded).'
                                : '* Khi Proxy được bật, hệ thống sẽ ưu tiên sử dụng proxy để truy cập các model nâng cao. Nếu proxy lỗi, sẽ tự động fallback về Gemini API Keys.'
                            }
                        </p>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default ApiKeySettings;
