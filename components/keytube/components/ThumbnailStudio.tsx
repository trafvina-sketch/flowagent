import React, { useState, useEffect } from 'react';
import { Copy, Check, Paintbrush, Terminal } from 'lucide-react';

interface ThumbnailStudioProps {
  promptText: string; // The raw prompt text from Gemini
}

export const ThumbnailStudio: React.FC<ThumbnailStudioProps> = ({ promptText }) => {
  const [copiedSeamless, setCopiedSeamless] = useState(false);
  
  // States for prompt editor
  const [titleText, setTitleText] = useState('');
  const [cinematicDesc, setCinematicDesc] = useState('');
  const [posterText, setPosterText] = useState('');
  const [styleText, setStyleText] = useState('Cinematic, photorealistic, 8k, dramatic lighting, highly detailed, masterpiece, safe-rated.');

  // Parse raw structured prompt whenever promptText changes
  useEffect(() => {
    if (!promptText) return;
    
    const titleMatch = promptText.match(/Title:\s*(.+)/);
    const descMatch = promptText.match(/Cinematic Description:\s*([\s\S]+?)(?=Poster Text:|$)/);
    const posterTextMatch = promptText.match(/Poster Text:\s*(.+)/);
    const styleMatch = promptText.match(/Style:\s*(.+)/);

    setTitleText(titleMatch ? titleMatch[1].trim() : 'Untitled');
    setCinematicDesc(descMatch ? descMatch[1].trim() : promptText);
    setPosterText(posterTextMatch ? posterTextMatch[1].trim() : '');
    if (styleMatch) setStyleText(styleMatch[1].trim());
  }, [promptText]);

  // Construct the seamless prompt for manual copying
  const getSeamlessPrompt = () => {
    const posterInstruction = posterText 
      ? ` With bold cinematic graphic typography overlay text: "${posterText.replace(/"/g, '')}" in Vietnamese`
      : '';
    return `Create a dramatic cinematic poster showing ${cinematicDesc}. ${posterInstruction}. Style: ${styleText}`;
  };

  const handleCopySeamless = async () => {
    await navigator.clipboard.writeText(getSeamlessPrompt());
    setCopiedSeamless(true);
    setTimeout(() => setCopiedSeamless(false), 2000);
  };

  return (
    <div className="bg-cinema-900/60 backdrop-blur-md border border-cinema-700/40 rounded-2xl overflow-hidden shadow-xl p-5 space-y-6 flex flex-col h-full">
      {/* Title */}
      <div>
        <span className="text-[10px] tracking-wider uppercase font-bold text-pink-500 block">Thumbnail Studio</span>
        <h2 className="text-lg font-bold text-gray-100 flex items-center gap-1.5 mt-1">
          <Paintbrush className="w-5 h-5 text-pink-500 animate-pulse" />
          Prompt Thumbnail AI
        </h2>
      </div>

      {/* Editor & Prompt Visual Panel */}
      <div className="space-y-4 flex-1 flex flex-col justify-between">
        {promptText ? (
          <div className="space-y-4 flex-1 flex flex-col justify-between">
            {/* Editor form fields */}
            <div className="space-y-2.5 bg-cinema-950/40 p-4 border border-cinema-850 rounded-xl flex-1">
              <span className="text-[9px] uppercase tracking-wider font-extrabold text-purple-400 block">
                Tinh chỉnh Prompt & Chữ in đè (Chỉnh sửa trực tiếp)
              </span>

              {/* Title Text (English) */}
              <div className="space-y-1">
                <label className="text-[9px] text-gray-400 font-bold uppercase">Chủ đề gốc của ảnh:</label>
                <input
                  type="text"
                  value={titleText}
                  onChange={(e) => setTitleText(e.target.value)}
                  className="w-full bg-cinema-900 border border-cinema-800 focus:border-purple-500 text-gray-200 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              {/* Cinematic Description */}
              <div className="space-y-1">
                <label className="text-[9px] text-gray-400 font-bold uppercase">Mô tả bối cảnh (Bằng tiếng Anh):</label>
                <textarea
                  rows={4}
                  value={cinematicDesc}
                  onChange={(e) => setCinematicDesc(e.target.value)}
                  className="w-full bg-cinema-900 border border-cinema-800 focus:border-purple-500 text-gray-200 text-xs p-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none font-mono"
                />
              </div>

              {/* Poster Text */}
              <div className="space-y-1">
                <label className="text-[9px] text-gray-400 font-bold uppercase">Văn bản in đè lên ảnh (Tiếng Việt):</label>
                <input
                  type="text"
                  value={posterText}
                  onChange={(e) => setPosterText(e.target.value)}
                  placeholder="Ví dụ: BÍ MẬT SEO YOUTUBE..."
                  className="w-full bg-cinema-900 border border-cinema-850 focus:border-purple-500 text-gray-200 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Seamless prompt copy */}
            <div className="bg-black/40 rounded-xl border border-cinema-800 p-3.5 relative group">
              <div className="absolute -top-3 left-4 bg-cinema-900 border border-cinema-800 px-2 text-[9px] font-bold text-pink-400 flex items-center gap-1">
                <Terminal className="w-3 h-3" />
                DÁN VÀO MIDJOURNEY / FLUX / NANO BANANA
              </div>
              <p className="text-xs text-gray-400 font-mono leading-relaxed select-all line-clamp-4 pr-8 pt-1">
                {getSeamlessPrompt()}
              </p>
              <button
                onClick={handleCopySeamless}
                className="absolute top-3 right-3 p-1.5 bg-cinema-800 hover:bg-cinema-700 rounded-md text-gray-400 hover:text-white transition-colors"
                title="Sao chép prompt liền mạch"
              >
                {copiedSeamless ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="h-48 border border-dashed border-cinema-800 rounded-2xl flex flex-col items-center justify-center text-center text-gray-500 p-4">
            <Paintbrush className="w-8 h-8 text-cinema-800 mb-2 animate-bounce" />
            <p className="text-xs font-semibold">Chưa có prompt thiết kế.</p>
            <p className="text-[10px] text-gray-600 mt-1">Dán link đối thủ và bắt đầu tối ưu 1-click để tạo prompt tự động.</p>
          </div>
        )}
      </div>
    </div>
  );
};
