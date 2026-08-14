
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { YouTubeIcon } from './icons/YouTubeIcon';
import { generateStoryIdeas } from '../services/geminiService';
import { SparklesIcon } from './icons/SparklesIcon';
import { LoadingSpinner } from './icons/LoadingSpinner';
import { ClipboardIcon } from './icons/ClipboardIcon';
import Tooltip from './Tooltip';
import { languages } from '../src/languages';

interface UrlInputFormProps {
    onAnalyze: (urls: string[], style: string, modelId: string, languageCode: string, summaryDurationMinutes?: number, variationPrompt?: string, files?: File[], imageFiles?: File[], sceneDuration?: number, audioMode?: 'narration' | 'dialogue' | 'asmr' | 'auto', styleWeight?: number, characterWeight?: number, includeSrtAnalysis?: boolean, generateSrt?: boolean) => void;
    isAnalyzing: boolean;
}

const YOUTUBE_URL_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}(\S*)?$/;

const GEMINI_MODELS = [
    { id: 'gemini-2.5-flash',       name: 'Gemini 2.5 Flash (Mặc định)' },
    { id: 'gemini-2.5-pro',         name: 'Gemini 2.5 Pro (Mạnh nhất)' },
    { id: 'gemini-2.5-flash-lite',  name: 'Gemini 2.5 Flash Lite (Nhanh)' },
    { id: 'gemini-2.0-flash',       name: 'Gemini 2.0 Flash (Ổn định)' },
];

// ── shared inline style helpers ──────────────────────────────
const S = {
    card:       { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as React.CSSProperties,
    elevated:   { background: 'var(--color-elevated)', border: '1px solid var(--color-border)' } as React.CSSProperties,
    panel:      { background: 'var(--color-panel)', border: '1px solid var(--color-border-light)' } as React.CSSProperties,
    label:      { color: 'var(--color-text-muted)', fontFamily: 'var(--font-display)' } as React.CSSProperties,
    input:      { background: 'var(--color-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', outline: 'none' } as React.CSSProperties,
    textSec:    { color: 'var(--color-text-secondary)' } as React.CSSProperties,
    accent:     { color: 'var(--color-accent)' } as React.CSSProperties,
    divider:    { borderColor: 'var(--color-border)' } as React.CSSProperties,
};

const UrlInputForm: React.FC<UrlInputFormProps> = ({ onAnalyze, isAnalyzing }) => {
    const { t, i18n } = useTranslation();
    const [_, setTick] = useState(0);

    useEffect(() => {
        const handleLanguageChanged = () => setTick(prev => prev + 1);
        i18n.on('languageChanged', handleLanguageChanged);
        return () => i18n.off('languageChanged', handleLanguageChanged);
    }, [i18n]);

    const [mode, setMode] = useState<'url' | 'file'>('url');
    const [urls, setUrls] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [style, setStyle] = useState('cinematic');
    const [modelId, setModelId] = useState('gemini-2.5-flash');
    const [languageCode, setLanguageCode] = useState('vi');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);

    const [summaryDuration, setSummaryDuration] = useState('');
    const [variationPrompt, setVariationPrompt] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isSuggesting, setIsSuggesting] = useState(false);
    const [suggestionError, setSuggestionError] = useState<string | null>(null);

    // Số giây mỗi cảnh: 4 | 6 | 8 | 10
    const [sceneDuration, setSceneDuration] = useState<4 | 6 | 8 | 10>(8);
    // Chế độ lời thoại
    const [audioManual, setAudioManual] = useState(false); // false = AI tự phân tích
    const [audioMode, setAudioMode] = useState<'narration' | 'dialogue' | 'asmr'>('dialogue');

    // Remix sliders (0% = Clone sát gốc, 100% = Sáng tạo tự do)
    const [styleWeight, setStyleWeight] = useState(0);
    const [characterWeight, setCharacterWeight] = useState(0);

    // Remix mode: 'none' = clone thuần, 'text' = nhập yêu cầu, 'slider' = kéo thanh
    const [remixMode, setRemixMode] = useState<'none' | 'text' | 'slider'>('none');
    const [includeSrtAnalysis, setIncludeSrtAnalysis] = useState(false);
    const [generateSrt, setGenerateSrt] = useState(false);

    const handleRemixModeChange = (mode: 'none' | 'text' | 'slider') => {
        setRemixMode(mode);
        if (mode !== 'text') setVariationPrompt('');
        if (mode !== 'slider') { setStyleWeight(0); setCharacterWeight(0); }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isAnalyzing) return;
        const duration = summaryDuration ? parseInt(summaryDuration, 10) : undefined;
        const finalStyle = imageFiles.length > 0 ? 'image-derived' : style;
        const remixText = variationPrompt.trim() || undefined; // Có text = remix, trống = clone
        if (mode === 'url') {
            const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);
            if (urlList.length === 0) { setError(t('error_no_url')); return; }
            const invalidUrls = urlList.filter(u => !YOUTUBE_URL_REGEX.test(u));
            if (invalidUrls.length > 0) { setError(`${t('error_invalid_urls')}:\n${invalidUrls.join('\n')}`); return; }
            onAnalyze(urlList, finalStyle, modelId, languageCode, remixText ? undefined : duration, remixText, [], imageFiles, sceneDuration, audioManual ? audioMode : 'auto', 100 - styleWeight, 100 - characterWeight, includeSrtAnalysis, generateSrt);
        } else {
            if (files.length === 0) { setError(t('error_no_file')); return; }
            onAnalyze([], finalStyle, modelId, languageCode, remixText ? undefined : duration, remixText, files, imageFiles, sceneDuration, audioManual ? audioMode : 'auto', 100 - styleWeight, 100 - characterWeight, includeSrtAnalysis, generateSrt);
        }
        setError(null);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) { setFiles(Array.from(e.target.files)); if (error) setError(null); }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selected = Array.from(e.target.files);
            const merged = [...imageFiles, ...selected];
            if (merged.length > 5) { setError('Tối đa 5 hình ảnh. Hiện đã có ' + imageFiles.length + ', bạn thêm ' + selected.length + '.'); return; }
            setImageFiles(merged);
            if (error) setError(null);
            // Reset input để có thể chọn lại cùng file
            e.target.value = '';
        }
    };

    // Memoize image preview URLs to avoid creating new blob URLs on every render
    const imagePreviewUrls = useMemo(() => {
        const urls = imageFiles.map(f => URL.createObjectURL(f));
        return urls;
    }, [imageFiles]);

    // Cleanup old preview URLs when imageFiles changes or component unmounts
    useEffect(() => {
        return () => {
            imagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [imagePreviewUrls]);

    const handleGenerateSuggestions = async () => {
        setIsSuggesting(true); setSuggestionError(null); setSuggestions([]);
        try {
            let context = mode === 'url' ? urls.split('\n')[0] : (files[0]?.name || '');
            if (!context) throw new Error('Cần Video hoặc URL để gợi ý.');
            const langName = languages.find(l => l.code === languageCode)?.name || 'Tiếng Việt';
            const ideas = await generateStoryIdeas(context, modelId, langName);
            setSuggestions(ideas);
        } catch (err: any) {
            setSuggestionError(err.message);
        } finally {
            setIsSuggesting(false);
        }
    };

    // ── input focus style toggle ──
    const focusStyle = (e: React.FocusEvent<HTMLElement>) => {
        (e.target as HTMLElement).style.borderColor = 'var(--color-accent)';
        (e.target as HTMLElement).style.boxShadow = '0 0 0 3px var(--color-accent-dim)';
    };
    const blurStyle = (e: React.FocusEvent<HTMLElement>) => {
        (e.target as HTMLElement).style.borderColor = 'var(--color-border)';
        (e.target as HTMLElement).style.boxShadow = 'none';
    };

    return (
        <div className="w-full max-w-2xl mx-auto space-y-4">
            <form onSubmit={handleSubmit}
                className="rounded-2xl overflow-hidden shadow-2xl"
                style={{ ...S.card, boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px var(--color-border)' }}
            >
                {/* ── Top section ── */}
                <div className="p-6 space-y-5">
                    {/* Header row */}
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                                style={{ background: 'linear-gradient(135deg, var(--color-accent-dim), var(--color-cyan-dim))', border: '1px solid var(--color-border-light)' }}>
                                {mode === 'url'
                                    ? <YouTubeIcon className="w-5 h-5" style={{ color: 'var(--color-accent-light)' } as React.CSSProperties} />
                                    : <ClipboardIcon className="w-5 h-5" style={{ color: 'var(--color-accent-light)' } as React.CSSProperties} />
                                }
                            </div>
                            <h2 className="text-base font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                                {t('config_title')}
                            </h2>
                        </div>
                        {/* Mode toggle */}
                        <div className="flex gap-1 p-1 rounded-xl" style={S.elevated}>
                            {(['url', 'file'] as const).map(m => (
                                <button key={m} type="button" onClick={() => setMode(m)}
                                    className="px-4 py-1.5 text-xs font-bold rounded-lg transition-all"
                                    style={mode === m
                                        ? { background: 'var(--color-accent)', color: '#fff', boxShadow: '0 2px 8px var(--color-accent-dim)' }
                                        : { color: 'var(--color-text-muted)', background: 'transparent' }
                                    }
                                >
                                    {m === 'url' ? 'LINK' : 'TỆP'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* URL / File input */}
                    {mode === 'url' ? (
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-[0.15em]" style={S.label}>{t('youtube_link')}</label>
                            <textarea rows={3} value={urls}
                                onChange={e => setUrls(e.target.value)}
                                placeholder={t('paste_link_here')}
                                onFocus={focusStyle} onBlur={blurStyle}
                                className="w-full rounded-xl px-4 py-3 text-sm resize-none transition-all"
                                style={{ ...S.input, fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                                disabled={isAnalyzing}
                            />
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-[0.15em]" style={S.label}>{t('upload_video')}</label>
                            <div onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all"
                                style={{ borderColor: 'var(--color-border-light)', background: 'var(--color-elevated)' }}
                                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
                                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border-light)')}
                            >
                                <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple accept="video/*" className="hidden" />
                                <p className="text-sm font-medium" style={S.textSec}>
                                    {files.length ? t('files_selected', { count: files.length }) : t('click_to_select')}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* 3-column selects */}
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: t('ai_model'), value: modelId, onChange: (v: string) => setModelId(v),
                              options: GEMINI_MODELS.map(m => ({ value: m.id, label: m.name })) },
                            { label: t('style'), value: imageFiles.length > 0 ? 'image-derived' : style,
                              onChange: (v: string) => setStyle(v), disabled: imageFiles.length > 0,
                              options: [
                                  ...(imageFiles.length > 0 ? [{ value: 'image-derived', label: t('style_from_image') }] : []),
                                  { value: 'cinematic', label: '🎬 Cinematic' },
                                  { value: 'anime', label: '🎌 Anime' },
                                  { value: 'ghibli', label: '🌿 Ghibli' },
                                  { value: '3d', label: '🧊 3D / Pixar' },
                                  { value: 'cartoon', label: '📺 Cartoon' },
                                  { value: 'minecraft', label: '🟩 Minecraft' },
                                  { value: 'pixel-art', label: '👾 Pixel Art' },
                                  { value: 'watercolor', label: '🎨 Watercolor' },
                                  { value: 'cyberpunk', label: '🌆 Cyberpunk' },
                                  { value: 'comic-book', label: '📖 Comic Book' },
                                  { value: 'claymation', label: '🧸 Claymation' },
                                  { value: 'realistic', label: '📷 Realistic' },
                                  { value: 'sketch', label: '✏️ Sketch' },
                                  { value: 'noir', label: '🎞️ Film Noir' },
                                  { value: 'vintage-history', label: '📜 Lịch sử (Trắng đen)' },
                                  // ── Kiểu nhân vật / Host ──
                                  { value: 'stickman', label: '🧍 Stickman (Người que)' },
                                  { value: 'chibi', label: '👶 Chibi (Đầu to)' },
                                  { value: 'animal', label: '🐾 Animal (Động vật)' },
                                  { value: 'faceless', label: '🧑‍💼 Faceless (Không host)' },
                                  { value: 'vtuber', label: '🎭 VTuber (Avatar ảo)' },
                                  { value: 'silhouette', label: '👤 Silhouette (Bóng đen)' },
                                  { value: 'superhero', label: '🦸 Superhero' },
                              ]},
                            { label: t('language'), value: languageCode, onChange: (v: string) => setLanguageCode(v),
                              options: languages.map(l => ({ value: l.code, label: l.name })) },
                        ].map((field, i) => (
                            <div key={i} className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-[0.15em]" style={S.label}>{field.label}</label>
                                <select
                                    value={field.value}
                                    onChange={e => field.onChange(e.target.value)}
                                    disabled={(field as any).disabled}
                                    onFocus={focusStyle} onBlur={blurStyle}
                                    className="w-full rounded-xl px-3 py-2 text-xs font-medium transition-all disabled:opacity-40 cursor-pointer"
                                    style={S.input}
                                >
                                    {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                        ))}
                    </div>

                    {/* Duration */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-[0.15em]" style={S.label}>{t('summary_duration')}</label>
                        <input type="number" value={summaryDuration}
                            onChange={e => setSummaryDuration(e.target.value)}
                            placeholder={t('summary_duration_placeholder')}
                            onFocus={focusStyle} onBlur={blurStyle}
                            className="w-full rounded-xl px-4 py-2 text-sm transition-all disabled:opacity-40"
                            style={S.input}
                            disabled={remixMode !== 'none' || isAnalyzing}
                        />
                    </div>

                    {/* ── Remix Mode (chọn 1 trong 3) ── */}
                    <div className="rounded-xl p-5 space-y-4" style={S.panel}>
                        <h3 className="text-xs font-black uppercase tracking-[0.15em]" style={S.label}>
                            🔄 Chế độ Remix
                        </h3>
                        
                        {/* 3 Radio buttons */}
                        <div className="grid grid-cols-3 gap-2">
                            {([
                                { id: 'none' as const, icon: '🎯', label: 'Clone thuần' },
                                { id: 'text' as const, icon: '✏️', label: 'Nhập yêu cầu' },
                                { id: 'slider' as const, icon: '🎚️', label: 'Thanh remix' },
                            ]).map(opt => (
                                <button key={opt.id} type="button"
                                    onClick={() => handleRemixModeChange(opt.id)}
                                    className="flex flex-col items-center gap-1 p-3 rounded-xl text-xs font-bold transition-all border"
                                    style={remixMode === opt.id
                                        ? { background: 'var(--color-accent-dim)', color: 'var(--color-accent-light)', borderColor: 'var(--color-accent)', boxShadow: '0 0 12px var(--color-accent-glow)' }
                                        : { background: 'var(--color-elevated)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }
                                    }
                                >
                                    <span className="text-lg">{opt.icon}</span>
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        {/* Text input (khi chọn 'text') */}
                        {remixMode === 'text' && (
                            <div className="space-y-2 pt-2">
                                <textarea rows={2} value={variationPrompt}
                                    onChange={e => setVariationPrompt(e.target.value)}
                                    onFocus={focusStyle} onBlur={blurStyle}
                                    className="w-full rounded-xl p-3 text-sm resize-none transition-all"
                                    style={S.input}
                                    placeholder="VD: Đổi nhân vật thành Naruto và Sasuke, bối cảnh làng Konoha..."
                                />
                                <p className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>
                                    ✏️ AI sẽ giữ nhịp video gốc nhưng thay đổi nội dung theo yêu cầu của bạn.
                                </p>
                            </div>
                        )}

                        {/* Sliders (khi chọn 'slider') */}
                        {remixMode === 'slider' && (
                            <div className="space-y-4 pt-2">
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Thay đổi phong cách ảnh:</span>
                                        <span className="text-xs font-bold" style={{ color: 'var(--color-accent-light)' }}>{styleWeight}%</span>
                                    </div>
                                    <input type="range" min="0" max="100" value={styleWeight}
                                        onChange={e => setStyleWeight(Number(e.target.value))}
                                        className="w-full h-2 rounded-full appearance-none cursor-pointer"
                                        style={{ accentColor: 'var(--color-accent)' }}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Thay đổi chi tiết nhân vật:</span>
                                        <span className="text-xs font-bold" style={{ color: 'var(--color-accent-light)' }}>{characterWeight}%</span>
                                    </div>
                                    <input type="range" min="0" max="100" value={characterWeight}
                                        onChange={e => setCharacterWeight(Number(e.target.value))}
                                        className="w-full h-2 rounded-full appearance-none cursor-pointer"
                                        style={{ accentColor: 'var(--color-accent)' }}
                                    />
                                </div>
                                <p className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>
                                    🎚️ 0% = Clone sát gốc · 50% = Remix vừa · 100% = Sáng tạo tự do
                                </p>
                            </div>
                        )}

                        {/* Clone thuần hint */}
                        {remixMode === 'none' && (
                            <p className="text-[10px] italic pt-1" style={{ color: 'var(--color-text-muted)' }}>
                                🎯 Clone 100% nội dung video gốc. Chỉ thay đổi ngôn ngữ kịch bản.
                            </p>
                        )}
                    </div>

                    {/* Audio Mode Selector */}
                    <div className="rounded-xl p-5 space-y-3" style={S.panel}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
                                    🎧 Chế độ lời thoại
                                </span>
                                <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                                    style={{ background: audioManual ? 'var(--color-accent-dim)' : 'var(--color-elevated)', color: audioManual ? 'var(--color-accent-light)' : 'var(--color-text-muted)', border: audioManual ? 'none' : '1px solid var(--color-border)' }}>
                                    {!audioManual ? 'AI tự phân tích' : audioMode === 'dialogue' ? 'Thoại nhân vật' : audioMode === 'narration' ? 'Lời dẫn' : 'ASMR'}
                                </span>
                            </div>
                            {/* Toggle */}
                            <button type="button" onClick={() => setAudioManual(!audioManual)}
                                className="relative w-10 h-5 rounded-full transition-all duration-300"
                                style={{ background: audioManual ? 'var(--color-accent)' : 'var(--color-elevated)', border: '1px solid var(--color-border)' }}
                            >
                                <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300"
                                    style={{ left: audioManual ? '20px' : '2px', background: audioManual ? '#fff' : 'var(--color-text-muted)' }} />
                            </button>
                        </div>
                        {audioManual ? (
                            <>
                                <div className="grid grid-cols-3 gap-2">
                                    {([['dialogue', '💬 Thoại NV'], ['narration', '🎙 Lời dẫn'], ['asmr', '🎧 ASMR']] as const).map(([val, label]) => (
                                        <button key={val} type="button" onClick={() => setAudioMode(val)}
                                            className="py-2 rounded-lg text-xs font-bold transition-all"
                                            style={audioMode === val
                                                ? { background: 'var(--color-accent)', color: '#fff', boxShadow: '0 0 10px var(--color-accent-dim)' }
                                                : { background: 'var(--color-elevated)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }
                                            }
                                        >{label}</button>
                                    ))}
                                </div>
                                <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                                    {audioMode === 'dialogue'
                                        ? '💬 Mỗi nhân vật 1 giọng riêng — Script dạng [ID]: "câu thoại". Phù hợp video có nhiều nhân vật.'
                                        : audioMode === 'narration'
                                        ? '🎙 1 giọng narrator duy nhất — Script văn xuôi mạch lạc. Không có thoại trực tiếp giữa nhân vật.'
                                        : '🎧 Không lời thoại — Chỉ mô tả âm thanh ASMR: tapping, scratching, whispering... Phù hợp video ASMR.'}
                                </p>
                            </>
                        ) : (
                            <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                                🤖 AI tự phân tích video để xác định chế độ phù hợp (thoại/thuyết minh/ASMR). Bật toggle nếu muốn chọn thủ công.
                            </p>
                        )}
                    </div>

                    {/* Scene Duration Selector */}
                    <div className="rounded-xl p-5 space-y-3" style={S.panel}>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
                                🎬 Thời lượng mỗi cảnh
                            </span>
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                                style={{ background: 'var(--color-accent-dim)', color: 'var(--color-accent-light)' }}>
                                {sceneDuration}s/cảnh
                            </span>
                        </div>
                        <div className="flex gap-2">
                            {([4, 6, 8, 10] as const).map(s => (
                                <button key={s} type="button" onClick={() => setSceneDuration(s)}
                                    className="flex-1 py-2 rounded-lg text-xs font-bold transition-all"
                                    style={sceneDuration === s
                                        ? { background: 'var(--color-accent)', color: '#fff', boxShadow: '0 0 10px var(--color-accent-dim)' }
                                        : { background: 'var(--color-elevated)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }
                                    }
                                >{s}s</button>
                            ))}
                        </div>
                        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                            {sceneDuration === 4 && '🚀 4s — Veo 3.1 Fast/Lite, Omni Flash (cực nhiều cảnh, thoại rất ngắn)'}
                            {sceneDuration === 6 && '⚡ 6s — Veo 3.1 Lite, Hailuo, Pika (nhiều cảnh hơn, thoại ngắn hơn)'}
                            {sceneDuration === 8 && '✅ 8s — Veo 3 (mặc định, cân bằng)'}
                            {sceneDuration === 10 && '🎥 10s — Kling AI, Runway Gen-3, Omni Flash 10s (ít cảnh hơn, thoại dài hơn)'}
                        </p>
                    </div>

                    {/* SRT Settings Selector */}
                    <div className="rounded-xl p-5 space-y-3" style={S.panel}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
                                    📝 Phụ đề SRT (ID nhân vật)
                                </span>
                                <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                                    style={{ background: includeSrtAnalysis ? 'var(--color-accent-dim)' : 'var(--color-elevated)', color: includeSrtAnalysis ? 'var(--color-accent-light)' : 'var(--color-text-muted)', border: includeSrtAnalysis ? 'none' : '1px solid var(--color-border)' }}>
                                    {includeSrtAnalysis ? 'Bật (Giữ ID)' : 'Tắt (Làm sạch)'}
                                </span>
                            </div>
                            {/* Toggle Switch */}
                            <button type="button" onClick={() => setIncludeSrtAnalysis(!includeSrtAnalysis)}
                                className="relative w-10 h-5 rounded-full transition-all duration-300 cursor-pointer"
                                style={{ background: includeSrtAnalysis ? 'var(--color-accent)' : 'var(--color-elevated)', border: '1px solid var(--color-border)' }}
                            >
                                <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 cursor-pointer"
                                    style={{ left: includeSrtAnalysis ? '20px' : '2px', background: includeSrtAnalysis ? '#fff' : 'var(--color-text-muted)' }} />
                            </button>
                        </div>
                        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                            Bật để giữ ID nhân vật trong phụ đề (ví dụ: <code className="font-mono text-zinc-300 bg-zinc-800/50 px-1 py-0.5 rounded border border-zinc-700/30">[HERO_V1]: "Thoại"</code>). Mặc định là Tắt để xuất phụ đề sạch.
                        </p>
                    </div>

                    {/* Subtitle Generation Toggle */}
                    <div className="rounded-xl p-5 space-y-3" style={S.panel}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
                                    🎬 Tạo phụ đề SRT
                                </span>
                                <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                                    style={{ background: generateSrt ? 'var(--color-accent-dim)' : 'var(--color-elevated)', color: generateSrt ? 'var(--color-accent-light)' : 'var(--color-text-muted)', border: generateSrt ? 'none' : '1px solid var(--color-border)' }}>
                                    {generateSrt ? 'Bật' : 'Tắt'}
                                </span>
                            </div>
                            {/* Toggle Switch */}
                            <button type="button" onClick={() => setGenerateSrt(!generateSrt)}
                                className="relative w-10 h-5 rounded-full transition-all duration-300 cursor-pointer"
                                style={{ background: generateSrt ? 'var(--color-accent)' : 'var(--color-elevated)', border: '1px solid var(--color-border)' }}
                            >
                                <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 cursor-pointer"
                                    style={{ left: generateSrt ? '20px' : '2px', background: generateSrt ? '#fff' : 'var(--color-text-muted)' }} />
                            </button>
                        </div>
                        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                            Bật để tạo và tải về file phụ đề SRT (.srt) trong lịch sử phân tích.
                        </p>
                    </div>

                    {/* Reverse Analysis — Visual DNA */}
                    <div className="rounded-xl p-5 relative overflow-hidden space-y-4" style={S.panel}>
                        {/* Badge */}
                        <div className="absolute top-0 right-0 px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-bl-xl"
                            style={{ background: 'var(--color-accent)', color: '#fff' }}>
                            NEW: Reverse Analysis
                        </div>
                        <div className="flex justify-between items-center">
                            <Tooltip text="AI sẽ học phong cách và nhân vật từ ảnh bạn tải lên để áp dụng vào video mới.">
                                <label className="text-sm font-semibold flex items-center gap-2 cursor-help"
                                    style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>
                                    <SparklesIcon className="w-4 h-4" style={{ color: 'var(--color-accent)' } as React.CSSProperties} />
                                    {t('reverse_analysis')}
                                </label>
                            </Tooltip>
                            {imageFiles.length > 0 && (
                                <button type="button" onClick={() => setImageFiles([])}
                                    className="text-[10px] font-black uppercase tracking-widest transition-colors"
                                    style={{ color: 'var(--color-text-muted)' }}
                                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
                                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                                >
                                    XÓA TẤT CẢ
                                </button>
                            )}
                        </div>
                        <div onClick={() => imageInputRef.current?.click()}
                            className="border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all"
                            style={{ borderColor: 'var(--color-border-light)', background: 'var(--color-surface)' }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border-light)')}
                        >
                            <input type="file" ref={imageInputRef} onChange={handleImageChange} multiple accept="image/*" className="hidden" />
                            {imageFiles.length > 0 ? (
                                <div className="flex flex-wrap gap-3 justify-center">
                                    {imageFiles.map((f, i) => (
                                        <div key={i} className="relative group">
                                            <div className="w-14 h-14 rounded-xl overflow-hidden shadow-md"
                                                style={{ border: '2px solid var(--color-border-light)' }}>
                                                <img src={imagePreviewUrls[i]} alt="preview" className="w-full h-full object-cover" />
                                            </div>
                                            {/* Nút xóa từng ảnh */}
                                            <button type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation(); // Chặn mở dialog chọn file
                                                    setImageFiles(prev => prev.filter((_, idx) => idx !== i));
                                                }}
                                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
                                                style={{
                                                    background: 'var(--color-error, #ef4444)',
                                                    color: '#fff',
                                                    boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                                                    lineHeight: 1
                                                }}
                                                title={`Xóa ảnh ${i + 1}`}
                                            >✕</button>
                                        </div>
                                    ))}
                                    <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl transition-colors"
                                        style={{ border: '2px dashed var(--color-border-light)', color: 'var(--color-text-muted)' }}>+</div>
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('upload_visual_dna')}</p>
                                    <p className="text-xs" style={S.textSec}>{t('upload_visual_dna_desc')}</p>
                                </div>
                            )}
                        </div>
                        <p className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>💡 {t('visual_dna_tip')}</p>
                    </div>
                </div>

                {/* ── Divider ── */}
                <div style={{ height: '1px', background: 'var(--color-border)' }} />

                {/* ── Submit ── */}
                <div className="p-6 space-y-5" style={{ background: 'var(--color-elevated)' }}>

                    {/* Submit button */}
                    <button type="submit" disabled={isAnalyzing}
                        className="w-full py-4 rounded-xl text-white font-bold text-base transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                        style={isAnalyzing
                            ? { background: 'var(--color-panel)', color: 'var(--color-text-muted)' }
                            : { background: 'linear-gradient(135deg, var(--color-accent) 0%, #6366f1 100%)', boxShadow: '0 8px 24px var(--color-accent-glow)', fontFamily: 'var(--font-display)' }
                        }
                        onMouseEnter={e => { if (!isAnalyzing) (e.currentTarget.style.transform = 'translateY(-1px)'); }}
                        onMouseLeave={e => { (e.currentTarget.style.transform = 'translateY(0)'); }}
                    >
                        {isAnalyzing
                            ? <div className="flex items-center justify-center gap-3"><LoadingSpinner className="w-5 h-5" /> {t('analyzing')}...</div>
                            : t('start_analysis')
                        }
                    </button>
                </div>

                {/* Error */}
                {error && (
                    <div className="px-6 py-3 text-sm font-medium text-center"
                        style={{ background: 'rgba(244,63,94,0.08)', borderTop: '1px solid rgba(244,63,94,0.2)', color: 'var(--color-error)' }}>
                        {error}
                    </div>
                )}
            </form>
        </div>
    );
};

export default UrlInputForm;
