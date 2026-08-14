import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { XIcon } from './icons/XIcon';

interface TutorialModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const tabs = [
    { id: 'intro', label: '✨ Giới thiệu', emoji: '🎬' },
    { id: 'guide', label: '📋 Hướng dẫn', emoji: '🗂️' },
    { id: 'flowstudio', label: '🎨 Flow Studio', emoji: '🎨' },
    { id: 'keytube', label: '🔍 KeyTube SEO', emoji: '🔍' },
    { id: 'modes', label: '⚙️ Chế độ', emoji: '🛠️' },
    { id: 'export', label: '📤 Xuất file', emoji: '💾' },
    { id: 'tips', label: '💡 Mẹo hay', emoji: '🔥' },
];

const FeatureCard = ({ icon, title, desc }: { icon: string; title: string; desc: string }) => (
    <div className="flex gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
        <div className="text-2xl flex-shrink-0">{icon}</div>
        <div>
            <div className="text-sm font-bold text-white">{title}</div>
            <div className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{desc}</div>
        </div>
    </div>
);

const Step = ({ num, title, desc, sub }: { num: number; title: string; desc: string; sub?: string }) => (
    <div className="flex gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-black">{num}</div>
        <div className="flex-1 pb-4 border-b border-white/5">
            <div className="text-sm font-bold text-white">{title}</div>
            <div className="text-xs text-zinc-400 mt-1 leading-relaxed">{desc}</div>
            {sub && <div className="mt-1.5 px-2 py-1 bg-violet-900/30 rounded-lg text-[11px] text-violet-300 font-mono">{sub}</div>}
        </div>
    </div>
);

const ModeCard = ({ emoji, title, badge, desc, items }: { emoji: string; title: string; badge: string; desc: string; items: string[] }) => (
    <div className="p-4 bg-white/5 rounded-xl border border-white/10">
        <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">{emoji}</span>
            <span className="font-bold text-white text-sm">{title}</span>
            <span className="ml-auto text-[10px] font-black px-2 py-0.5 bg-violet-600/30 text-violet-300 rounded-full border border-violet-500/30">{badge}</span>
        </div>
        <p className="text-xs text-zinc-400 mb-2">{desc}</p>
        <ul className="space-y-1">
            {items.map((item, i) => (
                <li key={i} className="text-xs text-zinc-300 flex gap-1.5">
                    <span className="text-violet-400 flex-shrink-0">→</span>{item}
                </li>
            ))}
        </ul>
    </div>
);

const TipCard = ({ emoji, title, desc }: { emoji: string; title: string; desc: string }) => (
    <div className="flex gap-3 p-3 bg-amber-500/5 rounded-xl border border-amber-500/20">
        <span className="text-xl flex-shrink-0">{emoji}</span>
        <div>
            <div className="text-sm font-bold text-amber-300">{title}</div>
            <div className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{desc}</div>
        </div>
    </div>
);

const TutorialModal: React.FC<TutorialModalProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('intro');

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 24 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                        className="fixed inset-0 flex items-center justify-center z-50 p-4"
                    >
                        <div className="bg-[#141928] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
                            {/* Header */}
                            <div className="flex items-center gap-3 p-5 border-b border-white/10 flex-shrink-0">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-xl">🎬</div>
                                <div>
                                    <h2 className="text-lg font-black text-white leading-none">FlowAgent AI</h2>
                                    <p className="text-xs text-zinc-500 mt-0.5">Automation & Content System</p>
                                </div>
                                <button onClick={onClose} className="ml-auto p-2 hover:bg-white/10 rounded-xl transition-colors">
                                    <XIcon className="w-5 h-5 text-zinc-400" />
                                </button>
                            </div>

                            {/* Tabs */}
                            <div className="flex flex-wrap gap-1 px-4 pt-3 flex-shrink-0">
                                {tabs.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                            activeTab === tab.id
                                                ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20'
                                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Content */}
                            <div className="overflow-y-auto flex-1 p-5">
                                <AnimatePresence mode="wait">
                                    {activeTab === 'intro' && (
                                        <motion.div key="intro" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                                            <div className="p-4 bg-gradient-to-r from-violet-600/20 to-blue-600/10 rounded-xl border border-violet-500/20">
                                                <p className="text-sm text-zinc-200 leading-relaxed">
                                                    <span className="font-black text-violet-300">FlowAgent AI</span> là công cụ tự động hóa & sản xuất video nội dung đa kênh cao cấp.
                                                </p>
                                            </div>

                                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Tính năng chính</p>

                                            <div className="grid grid-cols-1 gap-2">
                                                <FeatureCard icon="👁️" title="AI xem video thực tế" desc="Gemini phân tích nội dung YouTube/video tải lên trực tiếp — nhân vật, cảnh quay, lời thoại trích xuất từ video thật." />
                                                <FeatureCard icon="💬" title="Chế độ lời thoại" desc="Chọn: 🎙 Lời dẫn (1 giọng narrator), 💬 Thoại nhân vật (mỗi nhân vật 1 giọng riêng). Script được AI viết đúng format cho từng chế độ — không lẫn âm thanh môi trường vào transcript." />
                                                <FeatureCard icon="🎬" title="Thời lượng cảnh linh hoạt" desc="Chọn 6s / 8s / 10s cho mỗi cảnh. AI tự tính số cảnh phù hợp với tổng thời lượng. 6s = Hailuo/Pika, 8s = Veo 3, 10s = Kling/Runway." />
                                                <FeatureCard icon="👥" title="Nhân vật nhất quán" desc="Mỗi nhân vật gán ID [TÊN_V1] xuyên suốt mọi cảnh — dùng ID này khi tạo ảnh/video để nhân vật nhất quán." />
                                                <FeatureCard icon="🎨" title="Tab Flow Studio" desc="Thiết kế batch workflow tạo ảnh, video AI Veo 3.1 chất lượng điện ảnh 16:9 bằng Google Flow API qua WebSocket bridge." />
                                                <FeatureCard icon="🔍" title="Tab KeyTube SEO" desc="Phân tích video đối thủ chỉ với 1-Click để nhận bộ tài nguyên SEO tối ưu: tiêu đề, mô tả chứa từ khóa, timeline chapters, tags & prompt thumbnail." />
                                            </div>
                                        </motion.div>
                                    )}

                                    {activeTab === 'guide' && (
                                        <motion.div key="guide" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4">Hướng dẫn từng bước</p>
                                            <Step num={1} title="Cài đặt API Key" desc='Nhấn ⚙️ góc trên phải → Dán Gemini API Key (lấy tại ai.google.dev) → Chọn model hoặc kích hoạt Advanced Proxy.' sub="Miễn phí: gemini-2.5-flash-lite | Mạnh nhất: gemini-2.5-pro" />
                                            <Step num={2} title="Nhập URL hoặc tải video" desc="Dán link YouTube (nhiều link = mỗi dòng 1 link) hoặc nhấn TỆP để upload video MP4/WebM/MOV từ máy. AI xem trực tiếp nội dung." sub="YouTube: dán link | Video máy: nhấn TỆP → chọn file" />
                                            <Step num={3} title="Chọn chế độ lời thoại" desc='Chọn 💬 Thoại nhân vật (nhiều giọng, format [ID]: "câu thoại") hoặc 🎙 Lời dẫn (1 giọng narrator, văn xuôi). Ảnh hưởng trực tiếp đến cách AI viết script.' />
                                            <Step num={4} title="Chọn thời lượng mỗi cảnh" desc="Chọn 6s / 8s / 10s tùy nền tảng AI video bạn dùng. AI tự tính số cảnh và giới hạn từ phù hợp với số giây đã chọn." sub="6s = Hailuo/Pika | 8s = Veo 3 | 10s = Kling/Runway" />
                                            <Step num={5} title="Yêu cầu Remix (tùy chọn)" desc='Nhập yêu cầu thay đổi vào ô "Yêu cầu Remix". VD: "Đổi nhân vật thành Naruto, Sasuke" hoặc "Bối cảnh ở Việt Nam". Để trống = clone nguyên bản video gốc.' sub='✏️ Có text = AI áp dụng thay đổi | Trống = Clone 100%' />
                                            <Step num={6} title="Điều chỉnh Remix Weight" desc='Kéo thanh Thay đổi phong cách & Thay đổi chi tiết nhân vật (0-100%) để điều chỉnh mức độ thay đổi so với video gốc. 0% = clone sát, 100% = sáng tạo tự do.' sub='Style 0% + Char 0% = Clone thuần | Tăng = Remix nhiều hơn' />
                                            <Step num={7} title="Phân tích & Xuất file" desc='Nhấn PHÂN TÍCH. Mất 1-3 phút. Sau đó tải Prompts, Tóm tắt, SRT. Nhấn "Tạo phần tiếp theo" để nối series.' />
                                        </motion.div>
                                    )}

                                    {activeTab === 'flowstudio' && (
                                        <motion.div key="flowstudio" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">🎨 Hướng dẫn sử dụng Flow Studio</p>
                                            
                                            <div className="p-4 bg-indigo-600/10 rounded-xl border border-indigo-500/20">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <span className="text-xl">🚀</span>
                                                    <span className="font-bold text-indigo-300 text-sm">Kết nối Backend & Extension</span>
                                                </div>
                                                <p className="text-xs text-zinc-400 mb-2 leading-relaxed">
                                                    Để tạo ảnh/video AI qua Google Flow API, bạn cần chạy backend Python đi kèm và bật FlowKit extension trên trình duyệt:
                                                </p>
                                                <ul className="space-y-1.5 text-xs text-zinc-300">
                                                    <li>• Nhấp đúp chạy file <code className="text-indigo-300">Cài đặt Python (Flow Studio).bat</code> tại thư mục cài đặt để cài đặt Python và các thư viện tự động.</li>
                                                    <li>• Cài đặt tiện ích mở rộng Chrome <code className="text-indigo-300">flowkit_extension</code> (Load Unpacked) và đăng nhập để nhận Bridge kết nối.</li>
                                                </ul>
                                            </div>

                                            <div className="p-4 bg-emerald-600/10 rounded-xl border border-emerald-500/20">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <span className="text-xl">⛓️</span>
                                                    <span className="font-bold text-emerald-300 text-sm">Node-based Workflow Canvas</span>
                                                </div>
                                                <p className="text-xs text-zinc-400 mb-2 leading-relaxed">
                                                    Thiết kế quy trình xử lý ảnh/video tự động hàng loạt:
                                                </p>
                                                <ul className="space-y-1 text-xs text-zinc-300">
                                                    <li>• Kéo các node Đầu vào, Prompts, Model Veo 3.1 / GemPix, node upscale.</li>
                                                    <li>• Nối các đường dây tín hiệu để tạo pipeline tự động từ ảnh sang video (I2V) hoặc batch tạo.</li>
                                                </ul>
                                            </div>

                                            <div className="p-4 bg-blue-600/10 rounded-xl border border-blue-500/20">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-xl">📸</span>
                                                    <span className="font-bold text-blue-300 text-sm">Bộ tạo nhanh (Generate Panel)</span>
                                                </div>
                                                <p className="text-xs text-zinc-400 leading-normal">
                                                    Tạo nhanh ảnh/video bằng form: Text-to-Image (T2I), Text-to-Video (T2V), Image-to-Video (I2V) và Reference-to-Video (R2V). Hỗ trợ tải trực tiếp kết quả về thư viện.
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}

                                    {activeTab === 'keytube' && (
                                        <motion.div key="keytube" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">🔍 Hướng dẫn sử dụng KeyTube SEO</p>
                                            
                                            <div className="p-4 bg-purple-600/10 rounded-xl border border-purple-500/20">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <span className="text-xl">⚡</span>
                                                    <span className="font-bold text-purple-300 text-sm">Phân tích đối thủ 1-Click</span>
                                                </div>
                                                <p className="text-xs text-zinc-400 mb-2 leading-relaxed">
                                                    Biến một video đối thủ thành công thành bộ tài nguyên SEO tối ưu hoàn toàn cho bạn:
                                                </p>
                                                <ul className="space-y-1.5 text-xs text-zinc-300">
                                                    <li>1. Dán đường link video YouTube của đối thủ cạnh tranh cần phân tích.</li>
                                                    <li>2. Điền thông tin cá nhân của bạn: Tên kênh, độ dài video mới mong muốn (Chapters) và giọng điệu chủ đạo.</li>
                                                    <li>3. Nhấn <strong>PHÂN TÍCH & TỐI ƯU HÓA 1-CLICK</strong>.</li>
                                                </ul>
                                            </div>

                                            <div className="p-4 bg-pink-600/10 rounded-xl border border-pink-500/20">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <span className="text-xl">📊</span>
                                                    <span className="font-bold text-pink-300 text-sm">Nhận bộ tài nguyên SEO tối ưu</span>
                                                </div>
                                                <ul className="space-y-1.5 text-xs text-zinc-300">
                                                    <li>• <strong>Tiêu đề</strong>: 3-5 tiêu đề giật gân, cuốn hút chuẩn click-through-rate và tiêu đề cho YouTube Shorts.</li>
                                                    <li>• <strong>Mô tả & CTA</strong>: Đoạn mô tả chèn từ khóa chính tự nhiên đúng 5 lần, chèn tên kênh của bạn và lời kêu gọi hành động tinh tế.</li>
                                                    <li>• <strong>Chapters</strong>: Chia mốc thời gian thông minh bắt đầu từ 00:00.</li>
                                                    <li>• <strong>Tags & Hashtags</strong>: Bộ từ khóa tags viết thường và danh sách hashtags chuẩn SEO.</li>
                                                </ul>
                                            </div>

                                            <div className="p-4 bg-rose-600/10 rounded-xl border border-rose-500/20">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-xl">🖼️</span>
                                                    <span className="font-bold text-rose-300 text-sm">Sáng tạo Prompt vẽ Thumbnail AI</span>
                                                </div>
                                                <p className="text-xs text-zinc-400 leading-normal">
                                                    AI tự động dịch tiêu đề bạn đã chọn thành một prompt Tiếng Anh mô tả bối cảnh phim điện ảnh (Cinematic Prompt) kịch tính để nạp trực tiếp vào các mô hình vẽ ảnh (Midjourney, Flux, Imagen...) để tạo ra Thumbnail tuyệt đẹp.
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}

                                    {activeTab === 'modes' && (
                                        <motion.div key="modes" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Chế độ kịch bản</p>
                                            <ModeCard
                                                emoji="🎯"
                                                title="Clone 100%"
                                                badge="MẶC ĐỊNH"
                                                desc="Tái hiện TRUNG THỰC nhịp điệu, góc máy, loại cảnh của video gốc. Chỉ thay đổi ngôn ngữ kịch bản."
                                                items={[
                                                    'Giữ đúng cấu trúc mở đầu / leo thang / cao trào',
                                                    'Không sáng tạo thêm cảnh không có trong video',
                                                    'Phù hợp: Clone nội dung viral, học cách làm video',
                                                ]}
                                            />
                                            <ModeCard
                                                emoji="✏️"
                                                title="Yêu cầu Remix"
                                                badge="TEXT INPUT"
                                                desc='Nhập yêu cầu thay đổi bằng text. AI giữ nhịp video gốc nhưng thay đổi nội dung theo yêu cầu.'
                                                items={[
                                                    'VD: "Đổi nhân vật thành Naruto, Sasuke"',
                                                    'VD: "Bối cảnh chuyển sang Việt Nam thời phong kiến"',
                                                    'Để trống = clone thuần. Có text = AI áp dụng thay đổi',
                                                    'Kết hợp với Remix Weight để kiểm soát mức độ thay đổi',
                                                ]}
                                            />
                                            <ModeCard
                                                emoji="🔀"
                                                title="Remix Weight"
                                                badge="THANH TRƯỢT"
                                                desc="Kéo thanh Thay đổi phong cách & Thay đổi chi tiết nhân vật (0-100%) để điều chỉnh mức độ clone/remix."
                                                items={[
                                                    '0% = Clone sát video gốc (mặc định)',
                                                    '1-30% = Clone + thay đổi nhẹ chi tiết',
                                                    '31-70% = Giữ mạch chuyện, tự do chi tiết',
                                                    '71-100% = Chỉ lấy cảm hứng, sáng tạo lại hoàn toàn',
                                                ]}
                                            />
                                            <ModeCard
                                                emoji="⚡"
                                                title="Compress"
                                                badge="TÓM TẮT"
                                                desc="Giữ nguyên nội dung gốc nhưng rút gọn xuống thời lượng ngắn hơn bạn chỉ định."
                                                items={[
                                                    'Nhập thời lượng mong muốn (VD: 2 phút)',
                                                    'Ưu tiên giữ lại các cảnh quan trọng nhất',
                                                    'Phù hợp: Tóm tắt video dài, highlight reel',
                                                ]}
                                            />
                                            <div className="mt-2 space-y-3">
                                                <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Chế độ Lời Thoại</p>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="p-3 bg-blue-600/10 rounded-xl border border-blue-500/20">
                                                        <div className="text-sm font-bold text-blue-300 mb-1">💬 Thoại nhân vật</div>
                                                        <p className="text-xs text-zinc-400">Mỗi nhân vật 1 giọng riêng. Format: <code className="text-blue-300">[ID]: "câu thoại"</code>. Cảnh im lặng: AI tự viết narrator ngắn.</p>
                                                    </div>
                                                    <div className="p-3 bg-emerald-600/10 rounded-xl border border-emerald-500/20">
                                                        <div className="text-sm font-bold text-emerald-300 mb-1">🎙 Lời dẫn</div>
                                                        <p className="text-xs text-zinc-400">1 giọng narrator duy nhất. Văn xuôi mạch lạc, không thoại trực tiếp. Phù hợp video thuyết minh.</p>
                                                    </div>
                                                </div>
                                                <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Thời lượng mỗi cảnh</p>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {[{s:'6s',c:'⚡',p:'Hailuo, Pika',col:'amber'},{s:'8s',c:'✅',p:'Veo 3 (mặc định)',col:'violet'},{s:'10s',c:'🎥',p:'Kling, Runway',col:'blue'}].map(({s,c,p,col})=>(
                                                        <div key={s} className={`p-3 bg-${col}-600/10 rounded-xl border border-${col}-500/20 text-center`}>
                                                             <div className={`text-xs font-black text-${col}-300`}>{c} {s}</div>
                                                             <p className="text-[9px] text-zinc-400 mt-1">{p}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                                <p className="text-[11px] text-zinc-500">💡 Số giây ảnh hưởng số cảnh tạo ra và giới hạn từ mỗi cảnh (6s→11 từ, 8s→15 từ, 10s→19 từ)</p>
                                            </div>
                                        </motion.div>
                                    )}

                                    {activeTab === 'export' && (
                                        <motion.div key="export" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Các định dạng xuất file</p>
                                            
                                            <div className="p-4 bg-violet-600/10 rounded-xl border border-violet-500/20">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <span className="text-xl">📄</span>
                                                    <span className="font-bold text-violet-300 text-sm">Tải Prompts (.txt)</span>
                                                    <span className="ml-auto text-[10px] font-black px-2 py-0.5 bg-violet-600/30 text-violet-300 rounded-full border border-violet-500/30">PROMPT</span>
                                                </div>
                                                <p className="text-xs text-zinc-400 mb-2">File chứa prompt đầy đủ cho từng cảnh (style_video + lời thoại/thuyết minh). Dùng được ngay cho AI tạo video/ảnh.</p>
                                                <ul className="space-y-1">
                                                    <li className="text-xs text-zinc-300 flex gap-1.5"><span className="text-violet-400 flex-shrink-0">→</span>Mỗi dòng = 1 prompt cảnh, bao gồm đầy đủ mô tả và [VO:] lời thoại</li>
                                                    <li className="text-xs text-zinc-300 flex gap-1.5"><span className="text-violet-400 flex-shrink-0">→</span>Dán trực tiếp vào Midjourney, Flux, Kling, Runway</li>
                                                </ul>
                                            </div>

                                            <div className="p-4 bg-blue-600/10 rounded-xl border border-blue-500/20">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <span className="text-xl">📝</span>
                                                    <span className="font-bold text-blue-300 text-sm">Tải Tóm tắt (.txt)</span>
                                                    <span className="ml-auto text-[10px] font-black px-2 py-0.5 bg-blue-600/30 text-blue-300 rounded-full border border-blue-500/30">SCRIPT</span>
                                                </div>
                                                <p className="text-xs text-zinc-400 mb-2">File chứa logline, dàn ý kịch bản, và đầy đủ character sheet của tất cả nhân vật.</p>
                                                <ul className="space-y-1">
                                                    <li className="text-xs text-zinc-300 flex gap-1.5"><span className="text-blue-400 flex-shrink-0">→</span>Character sheet: prompt tạo ảnh sẵn sàng (multiple views, expression sheet)</li>
                                                    <li className="text-xs text-zinc-300 flex gap-1.5"><span className="text-blue-400 flex-shrink-0">→</span>Dùng để brief cho đội sản xuất hoặc lưu trữ kịch bản</li>
                                                </ul>
                                            </div>

                                            <div className="p-4 bg-emerald-600/10 rounded-xl border border-emerald-500/20">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <span className="text-xl">🔁</span>
                                                    <span className="font-bold text-emerald-300 text-sm">Tạo phần tiếp theo</span>
                                                    <span className="ml-auto text-[10px] font-black px-2 py-0.5 bg-emerald-600/30 text-emerald-300 rounded-full border border-emerald-500/30">MỚI</span>
                                                </div>
                                                <p className="text-xs text-zinc-400 mb-2">Từ video đã phân tích, tạo tiếp Phần 2, Phần 3... nối tiếp tự nhiên. Nhấn nút "Tạo phần tiếp theo" ở thẻ trong thư viện.</p>
                                                <ul className="space-y-1">
                                                    <li className="text-xs text-zinc-300 flex gap-1.5"><span className="text-emerald-400 flex-shrink-0">→</span>Chọn lại chế độ thoại và số giây/cảnh cho phần mới</li>
                                                    <li className="text-xs text-zinc-300 flex gap-1.5"><span className="text-emerald-400 flex-shrink-0">→</span>Nhập ý tưởng hướng đi cho phần tiếp (hoặc để trống)</li>
                                                    <li className="text-xs text-zinc-300 flex gap-1.5"><span className="text-emerald-400 flex-shrink-0">→</span>Kế thừa nhân vật, phong cách từ phần gốc tự động</li>
                                                </ul>
                                            </div>

                                            <div className="p-4 bg-amber-600/10 rounded-xl border border-amber-500/20">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <span className="text-xl">📋</span>
                                                    <span className="font-bold text-amber-300 text-sm">Sao chép Prompts</span>
                                                </div>
                                                <p className="text-xs text-zinc-400">Sao chép toàn bộ prompt vào clipboard — dán nhanh vào công cụ AI mà không cần tải file.</p>
                                            </div>
                                        </motion.div>
                                    )}

                                    {activeTab === 'tips' && (
                                        <motion.div key="tips" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4">Mẹo & Thủ thuật</p>
                                            <TipCard emoji="💬" title="Chọn đúng chế độ thoại trước khi phân tích" desc='Chọn 💬 Thoại nhân vật nếu video có nhiều nhân vật nói chuyện. Chọn 🎙 Lời dẫn nếu cần 1 giọng thuyết minh duy nhất. Script sẽ được AI viết khác nhau hoàn toàn.' />
                                            <TipCard emoji="🎬" title="Chọn số giây/cảnh đúng nền tảng" desc='6s cho Hailuo/Pika, 8s cho Veo 3, 10s cho Kling/Runway. Chọn đúng để số prompt khớp với số clip bạn cần tạo — không thừa, không thiếu.' />
                                            <TipCard emoji="✏️" title="Yêu cầu Remix = thay đổi thông minh" desc='Nhập yêu cầu vào ô Remix (VD: "Đổi thành Naruto"). AI giữ nhịp video gốc nhưng thay đổi nhân vật/bối cảnh theo text. Để trống = clone nguyên bản.' />
                                            <TipCard emoji="🎚️" title="Kết hợp Remix Weight + Text yêu cầu" desc='Kéo thanh weight lên 50% + nhập "Bối cảnh Việt Nam" = AI giữ mạch chuyện gốc, đổi bối cảnh + tự do chi tiết. Weight càng cao = càng sáng tạo.' />
                                            <TipCard emoji="🖼️" title="Dùng ảnh tham chiếu để khóa phong cách" desc="Upload ảnh nhân vật trước khi phân tích. AI phân tích style (2D/3D/Cinematic) từ ảnh → khóa phong cách cho toàn bộ prompt." />
                                            <TipCard emoji="🔑" title="Character ID là chìa khóa nhất quán" desc='Sau phân tích, copy ID nhân vật (VD: [ELARA_V1]) và dùng đúng ID này khi nhập prompt vào Midjourney/Flux/Kling để nhân vật giống nhau xuyên suốt.' />
                                            <TipCard emoji="🔁" title="Tạo series dài bằng Phần tiếp theo" desc='Phân tích xong → nhấn "Tạo phần tiếp theo" → nhập ý tưởng hướng đi → AI tạo phần 2 kế thừa nhân vật và phong cách. Lặp lại để có series vô hạn.' />
                                            <TipCard emoji="⚡" title="Video dài? Dùng Compress thay Clone" desc="Video trên 10 phút → dùng Compress (đặt 3-5 phút). Clone 100% video dài tốn nhiều token hơn và đôi khi kém chính xác." />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Footer */}
                            <div className="flex gap-2 p-4 border-t border-white/10 flex-shrink-0">
                                <button
                                    onClick={() => {
                                        const nextIdx = (tabs.findIndex(t => t.id === activeTab) + 1) % tabs.length;
                                        setActiveTab(tabs[nextIdx].id);
                                    }}
                                    className="flex-1 py-2.5 bg-white/5 border border-white/10 text-zinc-300 text-sm font-bold rounded-xl hover:bg-white/10 transition-colors"
                                >
                                    Tiếp theo →
                                </button>
                                <button
                                    onClick={onClose}
                                    className="flex-1 py-2.5 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-500 transition-colors shadow-lg shadow-violet-500/25"
                                >
                                    Bắt đầu sử dụng →
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

export default TutorialModal;
