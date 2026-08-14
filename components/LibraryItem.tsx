import React from 'react';
import { LibraryEntry, GeminiScene } from '../types';
import { DownloadIcon } from './icons/DownloadIcon';
import { LoadingSpinner } from './icons/LoadingSpinner';
import { XIcon } from './icons/XIcon';
import { ClockIcon } from './icons/ClockIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { languages } from '../src/languages';


interface LibraryItemProps {
    item: LibraryEntry;
    onDelete: (id: string) => void;
    onNextPart: (item: LibraryEntry, nextPartIdea: string, duration: number, language: string, audioMode: 'narration' | 'dialogue' | 'asmr', sceneDuration: number, style?: string, generateSrt?: boolean) => void;
    onRemix: (item: LibraryEntry, remixIdea: string, language: string, audioMode: 'narration' | 'dialogue' | 'asmr', sceneDuration: number, generateSrt?: boolean) => void;
}

const formatDuration = (ms: number): string => {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
        return `${minutes} phút ${seconds} giây`;
    }
    return `${seconds} giây`;
};


export const LibraryItem: React.FC<LibraryItemProps> = ({ item, onDelete, onNextPart, onRemix }) => {
    const hasSrt = React.useMemo(() => {
        return item.generateSrt !== false && !!item.result?.scenes?.some(s => s.script && s.script.trim() !== '~' && s.script.trim() !== '');
    }, [item.generateSrt, item.result?.scenes]);

    const [isCreatingNext, setIsCreatingNext] = React.useState(false);
    const [nextPartIdea, setNextPartIdea] = React.useState('');
    const [nextPartDuration, setNextPartDuration] = React.useState<number | string>(1);
    const [nextPartLanguage, setNextPartLanguage] = React.useState(item.languageCode || 'vi');
    // Default theo audio_mode của item gốc, fallback 'dialogue'
    const [nextPartAudioMode, setNextPartAudioMode] = React.useState<'narration' | 'dialogue' | 'asmr'>(
        (item.result?.video_meta?.audio_mode as any) === 'narration' ? 'narration' : (item.result?.video_meta?.audio_mode as any) === 'asmr' ? 'asmr' : 'dialogue'
    );
    // Số giây mỗi cảnh (6 | 8 | 10), default 8
    const [nextPartSceneDuration, setNextPartSceneDuration] = React.useState<6 | 8 | 10>(8);
    // Phong cách (Style) khi tạo phần tiếp theo
    const [nextPartStyle, setNextPartStyle] = React.useState('inherit');
    const [nextPartGenerateSrt, setNextPartGenerateSrt] = React.useState(item.generateSrt ?? false);

    // ── Remix nhân vật state ──
    const [isRemixing, setIsRemixing] = React.useState(false);
    const [remixIdea, setRemixIdea] = React.useState('');
    const [remixLanguage, setRemixLanguage] = React.useState(item.languageCode || 'vi');
    const [remixAudioMode, setRemixAudioMode] = React.useState<'narration' | 'dialogue' | 'asmr'>(
        (item.result?.video_meta?.audio_mode as any) === 'narration' ? 'narration' : (item.result?.video_meta?.audio_mode as any) === 'asmr' ? 'asmr' : 'dialogue'
    );
    const [remixSceneDuration, setRemixSceneDuration] = React.useState<6 | 8 | 10>(8);
    const [remixGenerateSrt, setRemixGenerateSrt] = React.useState(item.generateSrt ?? false);
    const [includeSrtAnalysis, setIncludeSrtAnalysis] = React.useState(item.includeSrtAnalysis ?? false);
    
    // Lấy audio mode từ kết quả phân tích
    const audioMode = item.result?.video_meta?.audio_mode || 'dialogue';

    const shouldAppendScript = (scene: GeminiScene) => {
        if (!scene.script || scene.script === '[KHÔNG THOẠI]' || scene.script.trim() === '~' || scene.script.trim() === '') return false;
        return true;
    };

    // Helper: lấy style_video sạch làm prompt đầy đủ
    const buildFullPrompt = (scene: GeminiScene) => {
        let cleanPrompt = scene.style_video.replace(/\s+/g, ' ').trim();
        // Strip bất kỳ VO nào đã nhúng vào style_video (cả 2 dạng)
        cleanPrompt = cleanPrompt
            .replace(/\[VO:[^\]]*\]\s*$/i, '')
            .replace(/\bVO:\s*.+$/i, '')
            .trim();

        if (!shouldAppendScript(scene)) {
            return cleanPrompt;
        }

        const scriptText = scene.script.replace(/\s+/g, ' ').trim();
        if (audioMode === 'asmr') {
            return `${cleanPrompt} [SFX: ${scriptText}]`;
        } else {
            return `${cleanPrompt} [VO: ${scriptText}]`;
        }
    };


    const handleDownloadTxt = () => {
        if (!item.result) return;
        const scenes = [...(item.result.scenes || [])];
        // Sắp xếp scenes theo scene_id (số thứ tự) tăng dần
        scenes.sort((a, b) => {
            const numA = parseInt(String(a.scene_id).replace(/\D/g, '')) || 0;
            const numB = parseInt(String(b.scene_id).replace(/\D/g, '')) || 0;
            return numA - numB;
        });
        // Ghi STT 1. 2. 3. trước mỗi prompt
        const prompts = scenes.map((scene, idx) => `${idx + 1}. ${buildFullPrompt(scene)}`).join('\n');
        const blob = new Blob([prompts], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeTitle = item.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `${safeTitle}_prompts.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };


    const handleDownloadScript = () => {
        if (!item.result) return;
        
        const { character_profile, style_profile, story_outline } = item.result;

        // ─ Style descriptor để gắn vào character sheet prompt
        const styleMedium = style_profile?.medium || '';
        const styleTags = style_profile?.style_tags?.join(', ') || 'detailed concept art';

        // Tạo full image-generation prompt cho 1 nhân vật
        const buildCharSheet = (id: string, name: string, prompt: string) =>
            `${id} - ${name}: Character sheet, multiple views (front, back, side), expression sheet, ` +
            `full body illustration, white background, bold outlines, ${styleTags}, detailed concept art, ` +
            `${prompt}${styleMedium ? `. Medium: ${styleMedium}` : ''}.`;

        let content = '';
        const allChars = story_outline?.characters;
        if (allChars && allChars.length > 0) {
            content = allChars.map((c, i) => {
                const cid = (c as any).id || `[CHAR${i + 1}_V1]`;
                return buildCharSheet(cid, c.name, c.prompt);
            }).join('\n');
        } else if (character_profile) {
            content = buildCharSheet(
                character_profile.id,
                character_profile.id,
                `${character_profile.description}. ${character_profile.physical_traits?.join(', ') || ''}`
            );
        }

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeTitle = item.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `${safeTitle}_prompt_nv.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // ── Xuất file SRT (phụ đề) từ dữ liệu phân tích ──
    const handleDownloadSrt = () => {
        if (!item.result) return;
        const scenes = item.result.scenes || [];
        if (scenes.length === 0) return;

        // Convert "mm:ss" → "HH:MM:SS,000" (SRT format)
        const toSrtTime = (mmss: string): string => {
            const parts = mmss.split(':').map(p => parseInt(p, 10) || 0);
            let hours = 0, minutes = 0, seconds = 0;
            if (parts.length === 3) {
                [hours, minutes, seconds] = parts;
            } else if (parts.length === 2) {
                [minutes, seconds] = parts;
            } else {
                seconds = parts[0] || 0;
            }
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},000`;
        };

        // Clean script text for SRT: remove character ID prefixes, trim
        const cleanScript = (script: string): string => {
            if (!script || script === '[KHÔNG THOẠI]' || script.trim() === '~') return '';
            if (includeSrtAnalysis) {
                // Keep the character ID / speaker analysis prefixes
                return script.trim();
            }
            // Remove [CHAR_ID]: prefixes to get clean subtitle text
            return script
                .split('\n')
                .map(line => line.replace(/^\[\w+\]:\s*/g, '').trim())
                .filter(line => line.length > 0)
                .join('\n');
        };

        const srtEntries = scenes
            .filter(scene => {
                if (!shouldAppendScript(scene)) return false;
                const text = cleanScript(scene.script);
                return text.length > 0;
            })
            .map((scene, idx) => {
                const startTime = toSrtTime(scene.t0);
                const endTime = toSrtTime(scene.t1);
                const text = cleanScript(scene.script);
                return `${idx + 1}\n${startTime} --> ${endTime}\n${text}\n`;
            });

        const srtContent = srtEntries.join('\n');
        // BOM + content for UTF-8 compatibility in media players
        const blob = new Blob(['\uFEFF' + srtContent], { type: 'text/srt;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeTitle = item.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `${safeTitle}.srt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const getBorderClass = () => {
        switch (item.status) {
            case 'complete': return 'border-green-500/30';
            case 'error': return 'border-red-500/50';
            case 'processing': return 'border-blue-500/50 border-dashed';
            case 'pending': return 'border-zinc-800/50';
            default: return 'border-zinc-800/50';
        }
    };

    const duration = item.completedAt && item.createdAt ? formatDuration(item.completedAt - item.createdAt) : null;

    return (
        <div className={`bg-[#f5f5f0] rounded-2xl p-4 flex items-start gap-4 border relative transition-colors backdrop-blur-sm shadow-sm ${getBorderClass()}`}>
             <img 
                src={item.thumbnail_url || 'https://placehold.co/128x72/e8e8e0/e8e8e0/png'} 
                alt="Video thumbnail" 
                className="rounded-xl w-28 h-auto aspect-video object-cover flex-shrink-0 bg-[#5A5A40]/10"
            />
            <div className="flex-grow">
                <p className="text-sm font-semibold text-[#2d2d25] line-clamp-2">{item.title}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                    {item.result?.video_meta?.style?.mood && (
                        <p className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-wider bg-[#5A5A40]/10 inline-block px-2 py-0.5 rounded-full">
                            {item.result.video_meta.style.mood}
                        </p>
                    )}
                    {item.result?.style_profile?.medium && (
                        <p className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-wider bg-[#5A5A40]/10 inline-block px-2 py-0.5 rounded-full">
                            {item.result?.style_profile?.medium}
                        </p>
                    )}
                </div>
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#5A5A40]/60 hover:underline break-all block mt-1">{item.url}</a>
                
                 {item.status === 'pending' && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-[#2d2d25]/60">
                        <span>Đang chờ trong hàng...</span>
                    </div>
                )}

                {item.status === 'processing' && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-[#5A5A40]">
                        <LoadingSpinner className="w-4 h-4" />
                        <span>Đang xử lý...</span>
                    </div>
                )}

                {item.status === 'complete' && item.result && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                        <button
                            onClick={handleDownloadTxt}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 bg-[#5A5A40]/10 text-[#5A5A40] text-xs font-semibold rounded-full hover:bg-[#5A5A40]/20 transition-colors border border-[#5A5A40]/20"
                        >
                            <DownloadIcon className="w-3 h-3" />
                            Tải Prompts
                        </button>
                        <button
                            onClick={handleDownloadScript}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 bg-[#5A5A40]/10 text-[#5A5A40] text-xs font-semibold rounded-full hover:bg-[#5A5A40]/20 transition-colors border border-[#5A5A40]/20"
                        >
                            <DownloadIcon className="w-3 h-3" />
                            Tải Prompt NV
                        </button>
                        {hasSrt && (
                            <>
                                <button
                                    onClick={handleDownloadSrt}
                                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1 bg-[#5A5A40]/10 text-[#5A5A40] text-xs font-semibold rounded-full hover:bg-[#5A5A40]/20 transition-colors border border-[#5A5A40]/20"
                                    title="Xuất file phụ đề SRT từ lời thoại/thuyết minh"
                                >
                                    <DownloadIcon className="w-3 h-3" />
                                    Tải SRT
                                </button>
                                <label className="inline-flex items-center gap-1.5 text-xs text-[#5A5A40] cursor-pointer select-none bg-[#5A5A40]/5 px-2.5 py-1 rounded-full border border-[#5A5A40]/10 hover:bg-[#5A5A40]/10 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={includeSrtAnalysis}
                                        onChange={(e) => setIncludeSrtAnalysis(e.target.checked)}
                                        className="w-3 h-3 rounded border-[#5A5A40]/30 text-[#5A5A40] focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#5A5A40]"
                                    />
                                    <span>Phân tích SRT (ID nhân vật)</span>
                                </label>
                            </>
                        )}

                        <button
                            onClick={() => { setIsCreatingNext(!isCreatingNext); if (!isCreatingNext) setIsRemixing(false); }}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 bg-[#5A5A40] text-[#f5f5f0] text-xs font-semibold rounded-full hover:bg-[#4a4a35] transition-colors border border-[#5A5A40]/20"
                        >
                            <SparklesIcon className="w-3 h-3" />
                            {isCreatingNext ? 'Hủy' : 'Tạo phần tiếp theo'}
                        </button>
                        <button
                            onClick={() => { setIsRemixing(!isRemixing); if (!isRemixing) setIsCreatingNext(false); }}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-colors border"
                            style={isRemixing
                                ? { background: '#7c3aed', color: '#f5f5f0', borderColor: '#7c3aed' }
                                : { background: '#7c3aed20', color: '#7c3aed', borderColor: '#7c3aed40' }
                            }
                        >
                            🔀
                            {isRemixing ? 'Hủy Remix' : 'Remix nhân vật'}
                        </button>
                        {isCreatingNext && (
                            <div className="w-full mt-3 p-3 bg-[#e8e8e0] rounded-xl border border-[#5A5A40]/20">
                                <input
                                    type="text"
                                    value={nextPartIdea}
                                    onChange={(e) => setNextPartIdea(e.target.value)}
                                    placeholder="Nhập ý tưởng cho phần tiếp theo (hoặc để trống)..."
                                    className="w-full p-2 text-sm rounded-lg border border-[#5A5A40]/20 bg-[#f5f5f0] text-[#2d2d25] mb-2"
                                />
                                <div className="flex flex-wrap items-center gap-4 mb-3">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#5A5A40]">Thời lượng (phút):</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="10"
                                            value={nextPartDuration}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === '') {
                                                    setNextPartDuration('');
                                                } else {
                                                    const parsed = parseInt(val);
                                                    if (!isNaN(parsed)) {
                                                        setNextPartDuration(parsed);
                                                    }
                                                }
                                            }}
                                            className="p-1.5 text-sm rounded-lg border border-[#5A5A40]/20 bg-[#f5f5f0] text-[#2d2d25] w-16"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#5A5A40]">Ngôn ngữ prompt:</label>
                                        <select
                                            value={nextPartLanguage}
                                            onChange={(e) => setNextPartLanguage(e.target.value)}
                                            className="p-1.5 text-sm rounded-lg border border-[#5A5A40]/20 bg-[#f5f5f0] text-[#2d2d25]"
                                        >
                                            {languages.map((l) => (
                                                <option key={l.code} value={l.code}>
                                                    {l.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#5A5A40]">Phong cách:</label>
                                        <select
                                            value={nextPartStyle}
                                            onChange={(e) => setNextPartStyle(e.target.value)}
                                            className="p-1.5 text-sm rounded-lg border border-[#5A5A40]/20 bg-[#f5f5f0] text-[#2d2d25]"
                                        >
                                            <option value="inherit">🧬 Kế thừa phong cách</option>
                                            <option value="cinematic">🎬 Cinematic</option>
                                            <option value="anime">🎌 Anime</option>
                                            <option value="ghibli">🌿 Ghibli</option>
                                            <option value="3d">🧊 3D / Pixar</option>
                                            <option value="cartoon">📺 Cartoon</option>
                                            <option value="minecraft">🟩 Minecraft</option>
                                            <option value="pixel-art">👾 Pixel Art</option>
                                            <option value="watercolor">🎨 Watercolor</option>
                                            <option value="cyberpunk">🌆 Cyberpunk</option>
                                            <option value="comic-book">📖 Comic Book</option>
                                            <option value="claymation">🧸 Claymation</option>
                                            <option value="realistic">📷 Realistic</option>
                                            <option value="sketch">✏️ Sketch</option>
                                            <option value="noir">🎞️ Film Noir</option>
                                            <option value="vintage-history">📜 Lịch sử (Trắng đen)</option>
                                            <option value="stickman">🧍 Stickman</option>
                                            <option value="chibi">👶 Chibi</option>
                                            <option value="animal">🐾 Animal</option>
                                            <option value="faceless">🧑‍💼 Faceless</option>
                                            <option value="vtuber">🎭 VTuber</option>
                                            <option value="silhouette">👤 Silhouette</option>
                                            <option value="superhero">🦸 Superhero</option>
                                        </select>
                                    </div>
                                    {/* Chế độ thoại */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#5A5A40]">Chế độ lời thoại:</label>
                                        <div className="flex gap-1">
                                            {([['dialogue', '💬 Thoại'], ['narration', '🎤 Lời dẫn'], ['asmr', '🎧 ASMR']] as const).map(([val, label]) => (
                                                <button
                                                    key={val}
                                                    type="button"
                                                    onClick={() => setNextPartAudioMode(val)}
                                                    className="px-2 py-1 text-[10px] font-bold rounded-full border transition-colors"
                                                    style={nextPartAudioMode === val
                                                        ? { background: '#5A5A40', color: '#f5f5f0', borderColor: '#5A5A40' }
                                                        : { background: 'transparent', color: '#5A5A40', borderColor: '#5A5A40' }
                                                    }
                                                >{label}</button>
                                            ))}
                                        </div>
                                    </div>
                                    {/* Scene Duration */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#5A5A40]">Giây/cảnh:</label>
                                        <div className="flex gap-1">
                                            {([6, 8, 10] as const).map(s => (
                                                <button key={s} type="button"
                                                    onClick={() => setNextPartSceneDuration(s)}
                                                    className="px-2 py-1 text-[10px] font-bold rounded-full border transition-colors"
                                                    style={nextPartSceneDuration === s
                                                        ? { background: '#5A5A40', color: '#f5f5f0', borderColor: '#5A5A40' }
                                                        : { background: 'transparent', color: '#5A5A40', borderColor: '#5A5A40' }
                                                    }
                                                >{s}s</button>
                                            ))}
                                        </div>
                                    </div>
                                    {/* Tạo SRT */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#5A5A40] cursor-pointer select-none flex items-center gap-1.5 bg-[#5A5A40]/5 px-2 py-1 rounded-full border border-[#5A5A40]/10 hover:bg-[#5A5A40]/10 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={nextPartGenerateSrt}
                                                onChange={(e) => setNextPartGenerateSrt(e.target.checked)}
                                                className="w-3.5 h-3.5 rounded border-[#5A5A40]/30 text-[#5A5A40] focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#5A5A40]"
                                            />
                                            <span>Tạo phụ đề SRT</span>
                                        </label>
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        const duration = typeof nextPartDuration === 'string' ? 1 : nextPartDuration;
                                        onNextPart(item, nextPartIdea, duration, nextPartLanguage, nextPartAudioMode, nextPartSceneDuration, nextPartStyle, nextPartGenerateSrt);
                                        setIsCreatingNext(false);
                                        setNextPartIdea('');
                                        setNextPartDuration(1);
                                        setNextPartStyle('inherit');
                                    }}
                                    className="w-full px-3 py-1.5 bg-[#5A5A40] text-[#f5f5f0] text-xs font-semibold rounded-full hover:bg-[#4a4a35] transition-colors shadow-sm"
                                >
                                    Bắt đầu phân tích phần tiếp theo
                                </button>
                            </div>
                        )}
                        {isRemixing && (
                            <div className="w-full mt-3 p-3 bg-[#f0e8ff] rounded-xl border border-[#7c3aed]/30">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-sm">🔀</span>
                                    <span className="text-xs font-bold text-[#7c3aed]">Remix nhân vật & phong cách</span>
                                </div>
                                <input
                                    type="text"
                                    value={remixIdea}
                                    onChange={(e) => setRemixIdea(e.target.value)}
                                    placeholder="VD: Chuyển nhân vật sang phong cách anime, thêm nhân vật phản diện..."
                                    className="w-full p-2 text-sm rounded-lg border border-[#7c3aed]/20 bg-white text-[#2d2d25] mb-2"
                                />
                                <div className="flex flex-wrap items-center gap-4 mb-3">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#7c3aed]">Ngôn ngữ:</label>
                                        <select
                                            value={remixLanguage}
                                            onChange={(e) => setRemixLanguage(e.target.value)}
                                            className="p-1.5 text-sm rounded-lg border border-[#7c3aed]/20 bg-white text-[#2d2d25]"
                                        >
                                            {languages.map((l) => (
                                                <option key={l.code} value={l.code}>
                                                    {l.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    {/* Chế độ thoại */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#7c3aed]">Chế độ lời thoại:</label>
                                        <div className="flex gap-1">
                                            {([['dialogue', '💬 Thoại'], ['narration', '🎤 Lời dẫn'], ['asmr', '🎧 ASMR']] as const).map(([val, label]) => (
                                                <button
                                                    key={val}
                                                    type="button"
                                                    onClick={() => setRemixAudioMode(val)}
                                                    className="px-2 py-1 text-[10px] font-bold rounded-full border transition-colors"
                                                    style={remixAudioMode === val
                                                        ? { background: '#7c3aed', color: '#f5f5f0', borderColor: '#7c3aed' }
                                                        : { background: 'transparent', color: '#7c3aed', borderColor: '#7c3aed' }
                                                    }
                                                >{label}</button>
                                            ))}
                                        </div>
                                    </div>
                                    {/* Scene Duration */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#7c3aed]">Giây/cảnh:</label>
                                        <div className="flex gap-1">
                                            {([6, 8, 10] as const).map(s => (
                                                <button key={s} type="button"
                                                    onClick={() => setRemixSceneDuration(s)}
                                                    className="px-2 py-1 text-[10px] font-bold rounded-full border transition-colors"
                                                    style={remixSceneDuration === s
                                                        ? { background: '#7c3aed', color: '#f5f5f0', borderColor: '#7c3aed' }
                                                        : { background: 'transparent', color: '#7c3aed', borderColor: '#7c3aed' }
                                                    }
                                                >{s}s</button>
                                            ))}
                                        </div>
                                    </div>
                                    {/* Tạo SRT */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[#7c3aed] cursor-pointer select-none flex items-center gap-1.5 bg-[#7c3aed]/5 px-2 py-1 rounded-full border border-[#7c3aed]/10 hover:bg-[#7c3aed]/10 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={remixGenerateSrt}
                                                onChange={(e) => setRemixGenerateSrt(e.target.checked)}
                                                className="w-3.5 h-3.5 rounded border-[#7c3aed]/30 text-[#7c3aed] focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#7c3aed]"
                                            />
                                            <span>Tạo phụ đề SRT</span>
                                        </label>
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        onRemix(item, remixIdea, remixLanguage, remixAudioMode, remixSceneDuration, remixGenerateSrt);
                                        setIsRemixing(false);
                                        setRemixIdea('');
                                    }}
                                    className="w-full px-3 py-1.5 text-xs font-semibold rounded-full text-white transition-colors shadow-sm"
                                    style={{ background: '#7c3aed' }}
                                >
                                    🔀 Bắt đầu Remix nhân vật
                                </button>
                            </div>
                        )}
                        <span className="text-xs text-[#2d2d25]/50 font-medium">
                            {(item.result.scenes || []).length} cảnh
                        </span>
                        {/* Chỉ số Remix */}
                        {(() => {
                            const hasTextRemix = !!item.userNote;
                            const hasSliderRemix = (item.styleWeight ?? 100) < 100 || (item.characterWeight ?? 100) < 100;
                            const isRemix = hasTextRemix || hasSliderRemix;
                            return (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    style={{
                                        background: isRemix ? '#7c3aed15' : '#5A5A4015',
                                        color: isRemix ? '#7c3aed' : '#5A5A40',
                                        border: `1px solid ${isRemix ? '#7c3aed30' : '#5A5A4020'}`
                                    }}
                                >
                                    {hasTextRemix
                                        ? '✏️ Text Remix'
                                        : hasSliderRemix
                                        ? `🎚️ Style ${100 - (item.styleWeight ?? 100)}% · Char ${100 - (item.characterWeight ?? 100)}%`
                                        : '🎯 Clone 100%'
                                    }
                                </span>
                            );
                        })()}
                        {duration && (
                             <span className="flex items-center gap-1 text-xs text-[#2d2d25]/50 font-medium">
                                <ClockIcon className="w-3 h-3" />
                                {duration}
                            </span>
                        )}
                        {/* Yêu cầu của người dùng */}
                        {item.userNote && (
                            <div className="w-full mt-2 px-3 py-2 rounded-lg text-xs" 
                                style={{ background: '#7c3aed10', border: '1px solid #7c3aed20' }}>
                                <span className="font-bold" style={{ color: '#7c3aed' }}>✏️ Yêu cầu: </span>
                                <span className="text-[#2d2d25]/70 line-clamp-2">{item.userNote}</span>
                            </div>
                        )}
                    </div>
                )}
                 {item.status === 'error' && (
                    <div className="mt-2 text-xs text-red-600 bg-red-100/50 border border-red-200 p-2 rounded-lg">
                        <p className="font-semibold">Lỗi:</p>
                        <p className="line-clamp-3">{item.error}</p>
                    </div>
                 )}
            </div>
             <button
                onClick={() => onDelete(item.id)}
                className="absolute top-2 right-2 p-1.5 text-[#5A5A40]/40 hover:text-red-500 rounded-full hover:bg-[#5A5A40]/10 transition-colors"
                aria-label="Xóa mục"
            >
                <XIcon className="w-4 h-4" />
            </button>
        </div>
    );
};