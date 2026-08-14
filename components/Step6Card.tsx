import React, { useState } from 'react';
import { GeminiAnalysisResponse } from '../types';
import { CheckIcon } from './icons/CheckIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { CopyIcon } from './icons/CopyIcon';
import { SparklesIcon } from './icons/SparklesIcon';

interface Step6CardProps {
    result: GeminiAnalysisResponse;
    generateSrt?: boolean;
}

const Step6Card: React.FC<Step6CardProps> = ({ result, generateSrt = true }) => {
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [showAllScenes, setShowAllScenes] = useState(false);

    const hasSrt = React.useMemo(() => {
        return generateSrt !== false && result.scenes && result.scenes.some(s => s.script && s.script.trim() !== '~' && s.script.trim() !== '');
    }, [result.scenes, generateSrt]);

    const sortedScenes = React.useMemo(() => {
        return [...result.scenes].sort((a, b) => {
            const numA = parseInt(String(a.scene_id).replace(/\D/g, '')) || 0;
            const numB = parseInt(String(b.scene_id).replace(/\D/g, '')) || 0;
            return numA - numB;
        });
    }, [result.scenes]);

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const audioMode = result.video_meta?.audio_mode || 'dialogue';

    const shouldAppendScript = (s: any) => {
        if (!s.script || s.script === '[KHÔNG THOẠI]' || s.script.trim() === '~' || s.script.trim() === '') return false;
        return true;
    };

    const buildFullPrompt = (scene: any) => {
        let cleanPrompt = scene.style_video.replace(/\s+/g, ' ').trim();
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


    const [includeSrtAnalysis, setIncludeSrtAnalysis] = useState(false);

    const handleDownloadAnalysis = () => {
        // ─ Style descriptor để gãn vào character sheet prompt
        const styleMedium = result.style_profile?.medium || '';
        const styleTags = result.style_profile?.style_tags?.join(', ') || 'detailed concept art';

        // Tạo full image-generation prompt cho 1 nhân vật
        const buildCharSheet = (id: string, name: string, prompt: string) =>
            `${id} - ${name}: Character sheet, multiple views (front, back, side), expression sheet, ` +
            `full body illustration, white background, bold outlines, ${styleTags}, detailed concept art, ` +
            `${prompt}${styleMedium ? `. Medium: ${styleMedium}` : ''}.`;

        const formatTime = (sec: number) =>
            `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

        // ── 1. DÀN Ỡ CÂU CHUYỆN ──
        let section1 = '1. DÀN Ỡ CÂU CHUYỆN (STORY OUTLINE):\n';
        if (result.story_outline) {
            const ol = result.story_outline;
            section1 += `LOGLINE: ${ol.logline}\n\n`;
            if (ol.characters?.length) {
                section1 += 'DANH SÁCH NHÂN VẬT TRONG KỊỀH BẢN:\n';
                section1 += ol.characters.map(c => {
                    const cid = (c as any).id || '[CHAR_V1]';
                    // → [ID] đứng TRƯỜC rồi mới đến tên và mô tả
                    return `- ${cid} | ${c.name}: ${c.prompt.slice(0, 120)}${c.prompt.length > 120 ? '...' : ''}`;
                }).join('\n');
                section1 += '\n\n';
            }
            if (ol.parts?.length) {
                section1 += 'CÁC PHẦN CÂU CHUYỆN:\n';
                section1 += ol.parts.map(p =>
                    `[${p.start_time} - ${p.end_time}] Phần ${p.part_id}: ${p.title}\n` +
                    `  Tóm tắt: ${p.summary}\n` +
                    `  Script: ${p.script}`
                ).join('\n\n');
                section1 += '\n\n';
            }
        }

        // ── 2. NHÂN VẬT CHỦ ĐẠO — TẤT CẢ ──
        let section2 = '2. NHÂN VẬT CHỦ ĐẠO (MAIN CHARACTER ANCHOR):\n';
        const allChars = result.story_outline?.characters;
        if (allChars?.length) {
            section2 += allChars.map((c, i) => {
                const cid = (c as any).id || `[CHAR${i + 1}_V1]`;
                const fullPrompt = buildCharSheet(cid, c.name, c.prompt);
                return [
                    `${cid} — ${c.name}`,      // → [ID] đứng đầu dòng
                    `Mô tả: ${c.prompt}`,
                    `Prompt tạo ảnh đầy đủ (copy để tạo nhân vật):`,
                    fullPrompt
                ].join('\n');
            }).join('\n\n---\n\n');
        } else if (result.character_profile) {
            const cp = result.character_profile;
            const fullPrompt = buildCharSheet(cp.id, cp.id, `${cp.description}. ${cp.physical_traits.join(', ')}`);
            section2 += `${cp.id} — Nhân vật chính\nMô tả: ${cp.description}\nĐặc điểm: ${cp.physical_traits.join(', ')}\nPrompt đầy đủ:\n${fullPrompt}`;
        }
        section2 += '\n\n';

        // ── 3. PHONG CÁCH ──
        let section3 = '';
        if (result.style_profile) {
            const sp = result.style_profile;
            section3 = [
                '3. PHONG CÁCH HÌNH ẢNH (STYLE ARCHITECTURE):',
                `Medium: ${sp.medium}`,
                `Lighting: ${sp.lighting}`,
                `Color Grading: ${sp.color_grading}`,
                `Lens/Film: ${sp.lens_film}`,
                `Materials: ${sp.environment_materials}`,
                `Style Tags: ${sp.style_tags.join(', ')}`,
                ''
            ].join('\n') + '\n';
        }

        // ── Sample prompt (từ ảnh) ──
        const sampleSection = result.sample_video_prompt
            ? `SAMPLE VIDEO PROMPT (ừ THỤC kèm theo ảnh tham chiếu):\n${result.sample_video_prompt}\n\n`
            : '';

        // ── 4. CHI TIẾT TỮNG CẢNH ──
        // Sử dụng sortedScenes đã được tính toán ở phạm vi component
        const sceneLines = sortedScenes.map((scene, idx) => {
            const speakerLine = (scene as any).speaker_id && (scene as any).speaker_id !== '~'
                ? `- Speaker: ${(scene as any).speaker_id}\n` : '';
            return [
                `CẢNH ${idx + 1} (${scene.t0} - ${scene.t1}):`,
                `- Tiêu đề: ${scene.title}`,
                `- Tóm tắt: ${scene.summary}`,
                `- Script/VO: ${scene.script}`,
                speakerLine.trim() ? speakerLine.trim() : null,
                `- Hành động: ${scene.action_prompt}`,
                `- 🌍 Bối cảnh môi trường: ${scene.SET || 'N/A'} | Âm thanh: ${scene.SND || 'N/A'} | Không khí: ${scene.MOOD || 'N/A'}`,
                `- CAM: ${scene.CAM} | SUBJ: ${scene.SUBJ}`,
                `- FX: ${scene.FX} | CLR: ${scene.CLR}`,
                `- EDIT: ${scene.EDIT} | RNDR: ${scene.RNDR} | TIM: ${scene.TIM}`,
                `- FOCAL: ${scene['!FOCAL']}`,
                `- Prompt đầy đủ: ${idx + 1}. ${buildFullPrompt(scene)}`,
            ].filter(Boolean).join('\n');
        }).join('\n\n');
        const section4 = `4. CHI TIẾT TỮNG CẢNH (SCENE DETAILS):\n${sceneLines}`;

        // ── Assemble file ──
        const div = '='.repeat(40);
        const header = [
            `BÁO CÁO PHÂN TÍCH VIDEO: ${result.video_meta.title}`,
            `Thời lượng: ${formatTime(result.video_meta.duration_sec)}`,
            `Chế độ Audio: ${(result.video_meta as any).audio_mode === 'narration' ? 'Thuyết minh (1 giọng)' : (result.video_meta as any).audio_mode === 'asmr' ? 'ASMR (không lời thoại)' : 'Hội thoại (nhiều giọng)'}`,
            div,
        ].join('\n');

        const content = `${header}\n\n${section1}${section2}${section3}${sampleSection}${div}\n\n${section4}`;
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = result.video_meta.title.replace(/[^\w\s]/g, '').replace(/\s+/g, '_').slice(0, 40);
        a.download = `${safeName}_analysis.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDownloadPrompts = () => {
        const prompts = sortedScenes.map((scene, idx) => `${idx + 1}. ${buildFullPrompt(scene)}`).join('\n');
        const blob = new Blob([prompts], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeTitle = result.video_meta.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `${safeTitle}_prompts.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDownloadScript = () => {
        const { character_profile, style_profile, story_outline } = result;
        const styleMedium = style_profile?.medium || '';
        const styleTags = style_profile?.style_tags?.join(', ') || 'detailed concept art';

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
        const safeTitle = result.video_meta.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `${safeTitle}_prompt_nv.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDownloadSrt = () => {
        const scenes = result.scenes || [];
        if (scenes.length === 0) return;

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

        const audioMode = result.video_meta?.audio_mode || 'dialogue';
        const shouldAppendScript = (s: any) => {
            if (!s.script || s.script === '[KHÔNG THOẠI]' || s.script.trim() === '~' || s.script.trim() === '') return false;
            if (audioMode === 'asmr') return true;
            if (audioMode === 'dialogue') {
                const trimmed = s.script.trim();
                return trimmed.startsWith('[') || (s.speaker_id && s.speaker_id !== '~');
            }
            return true;
        };

        const cleanScript = (script: string): string => {
            if (!script || script === '[KHÔNG THOẠI]' || script.trim() === '~') return '';
            if (includeSrtAnalysis) {
                return script.trim();
            }
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
        const blob = new Blob(['\uFEFF' + srtContent], { type: 'text/srt;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeTitle = result.video_meta.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `${safeTitle}.srt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleCopyBioTemplate = () => {
        const template = {
            character: result.character_profile,
            story_characters: result.story_outline?.characters,
            style: result.style_profile,
            sample_video_prompt: result.sample_video_prompt,
            scenes: sortedScenes.map(s => ({ id: s.scene_id, action: s.action_prompt }))
        };
        handleCopy(JSON.stringify(template, null, 2), 'bio-template');
    };

    return (
        <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800/50 overflow-hidden shadow-xl backdrop-blur-sm">
            {/* Header */}
            <div className="p-5 border-b border-zinc-800/50 bg-gradient-to-r from-zinc-900/80 to-zinc-900/40">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl shadow-lg shadow-zinc-900/50">
                            <SparklesIcon className="w-6 h-6 text-zinc-900" />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-zinc-100 tracking-tight">
                                Pro Analysis Dashboard
                            </h3>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">3-Tier Decoupled Output</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={handleDownloadAnalysis}
                            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 bg-zinc-100 text-zinc-900 text-xs font-bold rounded-xl hover:bg-zinc-200 transition-all shadow-sm active:scale-95"
                            title="Tải toàn bộ báo cáo phân tích chi tiết (.txt)"
                        >
                            <DownloadIcon className="w-4 h-4" />
                            Tải Báo Cáo
                        </button>
                    </div>
                </div>
            </div>

            <div className="p-6 space-y-10">
                {/* Tier 1 & 3: Profiles */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Tier 3: Character ID Card */}
                    {result.character_profile && (
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                            <div className="relative p-6 bg-zinc-900 rounded-2xl border border-blue-900/30 flex flex-col h-full">
                                <div className="flex justify-between items-start mb-4">
                                    <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em]">Tier 3: Character ID</h4>
                                    <button 
                                        onClick={() => handleCopy(result.character_profile!.id, 'char-id')}
                                        className="p-1.5 hover:bg-blue-900/20 rounded-lg transition-colors"
                                    >
                                        {copiedId === 'char-id' ? <CheckIcon className="w-3.5 h-3.5 text-green-500" /> : <CopyIcon className="w-3.5 h-3.5 text-blue-500" />}
                                    </button>
                                </div>
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="w-16 h-16 bg-blue-900/30 rounded-full flex items-center justify-center text-blue-400 font-black text-xl border-2 border-blue-800/50">
                                        {result.character_profile.id.charAt(1)}
                                    </div>
                                    <div>
                                        <div className="text-lg font-black text-blue-100 leading-none mb-1">{result.character_profile.id}</div>
                                        <div className="text-[10px] font-bold text-blue-500 uppercase">Fixed Reference ID</div>
                                    </div>
                                </div>
                                <p className="text-xs text-blue-300 leading-relaxed mb-4 flex-grow italic">
                                    "{result.character_profile.description}"
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    {result.character_profile.physical_traits.map((trait, i) => (
                                        <span key={i} className="px-2.5 py-1 bg-blue-900/20 text-[10px] font-bold text-blue-400 rounded-lg border border-blue-800/30">{trait}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tier 1: Visual Style Architect */}
                    {result.style_profile && (
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                            <div className="relative p-6 bg-zinc-900 rounded-2xl border border-purple-900/30 flex flex-col h-full">
                                <div className="flex justify-between items-start mb-4">
                                    <h4 className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em]">Tier 1: Style Architect</h4>
                                    <button 
                                        onClick={() => handleCopy(result.style_profile?.style_tags?.join(', ') || '', 'style-tags')}
                                        className="p-1.5 hover:bg-purple-900/20 rounded-lg transition-colors"
                                    >
                                        {copiedId === 'style-tags' ? <CheckIcon className="w-3.5 h-3.5 text-green-500" /> : <CopyIcon className="w-3.5 h-3.5 text-purple-500" />}
                                    </button>
                                </div>
                                <div className="mb-4">
                                    <div className="text-lg font-black text-purple-100 leading-none mb-1">{result.style_profile?.medium}</div>
                                    <div className="text-[10px] font-bold text-purple-500 uppercase">Visual Medium</div>
                                </div>
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div className="space-y-3">
                                        <div>
                                            <div className="text-[9px] font-black text-purple-500 uppercase">Lighting</div>
                                            <div className="text-[11px] font-bold text-purple-300">{result.style_profile?.lighting}</div>
                                        </div>
                                        <div>
                                            <div className="text-[9px] font-black text-purple-500 uppercase">Lens/Film</div>
                                            <div className="text-[11px] font-bold text-purple-300">{result.style_profile?.lens_film}</div>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <div>
                                            <div className="text-[9px] font-black text-purple-500 uppercase">Color Grading</div>
                                            <div className="text-[11px] font-bold text-purple-300">{result.style_profile?.color_grading}</div>
                                        </div>
                                        <div>
                                            <div className="text-[9px] font-black text-purple-500 uppercase">Materials</div>
                                            <div className="text-[11px] font-bold text-purple-300">{result.style_profile?.environment_materials}</div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5 mt-auto">
                                    {result.style_profile?.style_tags?.map((tag, i) => (
                                        <span key={i} className="px-2.5 py-1 bg-purple-900/20 text-[10px] font-bold text-purple-400 rounded-lg border border-purple-800/30">#{tag}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Sample Video Prompt (if available) */}
                {result.sample_video_prompt && (
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-emerald-600 to-teal-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                        <div className="relative p-6 bg-zinc-900 rounded-2xl border border-emerald-900/30">
                            <div className="flex justify-between items-start mb-4">
                                <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em]">Sample Video Prompt (From Image)</h4>
                                <button 
                                    onClick={() => handleCopy(result.sample_video_prompt!, 'sample-prompt')}
                                    className="p-1.5 hover:bg-emerald-900/20 rounded-lg transition-colors"
                                >
                                    {copiedId === 'sample-prompt' ? <CheckIcon className="w-3.5 h-3.5 text-green-500" /> : <CopyIcon className="w-3.5 h-3.5 text-emerald-500" />}
                                </button>
                            </div>
                            <div className="p-4 bg-zinc-950 rounded-xl border border-emerald-900/30">
                                <p className="text-sm font-mono text-emerald-100 leading-relaxed">
                                    {result.sample_video_prompt}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Story Characters — hiển thị Character ID để dùng trong prompt */}
                {result.story_outline?.characters && result.story_outline.characters.length > 0 && (
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-orange-600 to-amber-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                        <div className="relative p-6 bg-zinc-900 rounded-2xl border border-orange-900/30">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h4 className="text-[10px] font-black text-orange-400 uppercase tracking-[0.2em]">Story Characters</h4>
                                    <p className="text-[9px] text-orange-600 mt-0.5">{result.story_outline.characters.length} nhân vật — click ID để copy</p>
                                </div>
                                <span className="px-2 py-0.5 bg-orange-900/20 text-[10px] font-black text-orange-400 rounded-full border border-orange-800/30">
                                    {result.story_outline.characters.length} CHARS
                                </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {result.story_outline.characters.map((char, idx) => {
                                    const charId = (char as any).id || `[CHAR${idx + 1}_V1]`;
                                    return (
                                        <div key={idx} className="p-4 bg-zinc-950 rounded-xl border border-orange-900/30 flex flex-col gap-2">
                                            {/* Header: Name + Copy prompt button */}
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h5 className="text-sm font-bold text-orange-200 leading-none">{char.name}</h5>
                                                    {/* Character ID badge — click to copy */}
                                                    <button
                                                        onClick={() => handleCopy(charId, `char-id-${idx}`)}
                                                        className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 bg-orange-900/30 hover:bg-orange-800/40 rounded-md border border-orange-700/40 transition-colors group/id"
                                                        title="Click để copy Character ID"
                                                    >
                                                        <span className="font-mono text-[10px] font-black text-amber-300 group-hover/id:text-amber-100">{charId}</span>
                                                        {copiedId === `char-id-${idx}` 
                                                            ? <CheckIcon className="w-2.5 h-2.5 text-green-400" /> 
                                                            : <CopyIcon className="w-2.5 h-2.5 text-orange-500 opacity-0 group-hover/id:opacity-100" />
                                                        }
                                                    </button>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        const styleMedium = result.style_profile?.medium || '';
                                                        const styleTags = result.style_profile?.style_tags?.join(', ') || 'detailed concept art';
                                                        const fullPrompt =
                                                            `${charId} - ${char.name}: Character sheet, multiple views (front, back, side), ` +
                                                            `expression sheet, full body illustration, white background, bold outlines, ` +
                                                            `${styleTags}, detailed concept art, ${char.prompt}` +
                                                            `${styleMedium ? `. Medium: ${styleMedium}` : ''}.`;
                                                        handleCopy(fullPrompt, `char-prompt-${idx}`);
                                                    }}
                                                    className="p-1.5 hover:bg-orange-900/20 rounded-lg transition-colors flex-shrink-0"
                                                    title="Copy FULL character sheet prompt (dùng để tạo ảnh nhân vật)"
                                                >
                                                    {copiedId === `char-prompt-${idx}` ? <CheckIcon className="w-3.5 h-3.5 text-green-500" /> : <CopyIcon className="w-3.5 h-3.5 text-orange-500" />}
                                                </button>
                                            </div>
                                            {/* Character prompt */}
                                            <p className="text-xs font-mono text-orange-100/70 leading-relaxed flex-grow">
                                                {char.prompt}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* Tier 2: Action & Camera Flow */}
                <div className="bg-zinc-900/50 rounded-2xl p-6 border border-zinc-800/50">
                    <div className="flex items-center justify-between mb-6">
                        <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Tier 2: Action & Camera Flow</h4>
                        <span className="px-3 py-1 bg-zinc-800 rounded-full text-[10px] font-black text-zinc-400 border border-zinc-700">
                            {result.scenes.length} SCENES
                        </span>
                    </div>
                    
                    <div className="space-y-4">
                        {(() => {
                            const sorted = [...result.scenes].sort((a, b) => {
                                const numA = parseInt(String(a.scene_id).replace(/\D/g, '')) || 0;
                                const numB = parseInt(String(b.scene_id).replace(/\D/g, '')) || 0;
                                return numA - numB;
                            });
                            const visibleScenes = showAllScenes ? sorted : sorted.slice(0, 12);
                            return visibleScenes.map((scene, idx) => (
                            <div key={idx} className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 hover:border-zinc-600 transition-all group">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 pt-1">
                                        <div className="text-[10px] font-black text-zinc-600 mb-1">TIME</div>
                                        <div className="text-xs font-mono font-bold text-zinc-100">{scene.t0}</div>
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-xs font-black text-zinc-100 uppercase tracking-tight">Scene {scene.scene_id}: {scene.title}</div>
                                            <button 
                                                onClick={() => {
                                                    handleCopy(buildFullPrompt(scene), `scene-prompt-${idx}`);
                                                }}
                                                className="p-1.5 hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1.5 text-[10px] font-bold text-zinc-500 hover:text-zinc-300"
                                            >
                                                {copiedId === `scene-prompt-${idx}` ? <CheckIcon className="w-3.5 h-3.5 text-green-500" /> : <CopyIcon className="w-3.5 h-3.5" />}
                                                Copy Prompt
                                            </button>
                                        </div>
                                        <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800/50 text-xs font-mono text-zinc-400 leading-relaxed mb-3">
                                            <span className="text-zinc-300 font-black mr-2">SUMMARY:</span>
                                            {scene.summary}
                                        </div>
                                        <div className="p-3 bg-emerald-900/10 rounded-lg border border-emerald-900/20 text-xs font-mono text-emerald-400/80 leading-relaxed mb-3">
                                            <span className="text-emerald-500 font-black mr-2">SCRIPT/VO:</span>
                                            {scene.script}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ));
                        })()}
                        {result.scenes.length > 12 && (
                            <div className="text-center py-6">
                                <button 
                                    onClick={() => setShowAllScenes(!showAllScenes)}
                                    className="text-xs font-black text-zinc-400 hover:text-zinc-300 uppercase tracking-widest flex items-center gap-2 mx-auto cursor-pointer"
                                >
                                    <span className="w-8 h-px bg-zinc-700"></span>
                                    {showAllScenes ? "Thu gọn danh sách" : `Xem đầy đủ ${result.scenes.length} cảnh`}
                                    <span className="w-8 h-px bg-zinc-700"></span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Step6Card;
