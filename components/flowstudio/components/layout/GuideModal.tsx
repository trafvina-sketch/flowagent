import React, { useState } from 'react';
import { 
  X, Sparkles, Image, Video, 
  Music, Bot, Workflow, Sliders, Layers, BookOpen, AlertCircle
} from 'lucide-react';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'quickstart' | 'agent' | 'canvas' | 'tips';

const GuideModal: React.FC<GuideModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('quickstart');

  if (!isOpen) return null;

  const tabs = [
    { id: 'quickstart', label: 'Bắt Đầu Nhanh', icon: Sparkles, color: 'text-indigo-400 bg-indigo-500/10' },
    { id: 'agent', label: 'Trợ Lý AI (Chat)', icon: Bot, color: 'text-emerald-400 bg-emerald-500/10' },
    { id: 'canvas', label: 'Workflow Canvas', icon: Workflow, color: 'text-sky-400 bg-sky-500/10' },
    { id: 'tips', label: 'Quy Tắc Vàng (Pro Tips)', icon: BookOpen, color: 'text-amber-400 bg-amber-500/10' },
  ] as const;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={onClose} />

      {/* Modal Content */}
      <div className="relative w-full max-w-4xl h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col glow-primary animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950/60 border-b border-slate-850">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
              <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                Cẩm Nang Sử Dụng <span className="gradient-text font-black">FlowAgent Studio</span>
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-semibold">v0.3.0 Update</span>
              </h2>
              <p className="text-[11px] text-slate-400">Bí quyết làm chủ AI Video, Audio & Visual Workflow chuyên nghiệp</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 py-2 bg-slate-950/20 border-b border-slate-850 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap border ${
                  isActive 
                    ? 'bg-slate-800/80 border-slate-700 text-white shadow-md' 
                    : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                }`}
              >
                <Icon className={`w-4 h-4 ${tab.color.split(' ')[0]}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
          
          {/* TAB 1: QUICKSTART */}
          {activeTab === 'quickstart' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* Introduction Card */}
              <div className="relative p-5 bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-900/30 rounded-2xl overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  🚀 Chào mừng bạn đến với FlowAgent Studio!
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Đây là nền tảng AI tích hợp tối ưu hóa toàn diện cho việc sản xuất video quảng cáo và câu chuyện từ hình ảnh/âm thanh. 
                  FlowAgent hoạt động dưới dạng ứng dụng Desktop bảo mật mã hóa code (không lộ tài khoản khách hàng) 
                  và kết nối với trình duyệt thông qua extension để thực thi tác vụ.
                </p>
              </div>

              {/* Chrome Extension FlowKit Guide */}
              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                  <Layers className="w-4 h-4" /> 1. CẦU NỐI BẮT BUỘC: FLOWKIT CHROME EXTENSION
                </h4>
                <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-3">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Hệ thống hoạt động dựa trên cơ chế <strong>Browser Automation bảo mật</strong> qua <strong>Extension FlowKit</strong>. 
                    Để sử dụng các tính năng sinh ảnh/video, bạn bắt buộc phải cài đặt và kích hoạt extension này trên trình duyệt Chrome.
                  </p>
                  
                  {/* Status checklist */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div className="flex items-start gap-2.5 p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 animate-pulse" />
                      <div>
                        <h5 className="text-[11px] font-bold text-slate-200">Kích hoạt & Trạng thái</h5>
                        <p className="text-[10px] text-slate-400">Xem chỉ báo ở góc trên bên phải màn hình app. Đảm bảo trạng thái hiển thị màu xanh lá <span className="text-emerald-400 font-bold">🟢 Connected</span>.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5 p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5" />
                      <div>
                        <h5 className="text-[11px] font-bold text-slate-200">Đăng nhập tài khoản Google</h5>
                        <p className="text-[10px] text-slate-400">Hãy đăng nhập sẵn tài khoản Google trên profile Chrome chạy extension để các API ngầm của Google Flow hoạt động trơn tru.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3 Step Workflow */}
              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                  <Layers className="w-4 h-4" /> 2. QUY TRÌNH HOẠT ĐỘNG CHUẨN
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-950/20 border border-slate-850 rounded-xl p-4 space-y-2">
                    <div className="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 text-xs font-bold text-indigo-400">
                      1
                    </div>
                    <h5 className="text-xs font-bold text-slate-200">Setup Cấu Hình AI</h5>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Mở sidebar, điền API Key (Gemini) để chatbot có thể phân tích kịch bản, dịch thuật và lập storyboard.
                    </p>
                  </div>
                  <div className="bg-slate-950/20 border border-slate-850 rounded-xl p-4 space-y-2">
                    <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-xs font-bold text-emerald-400">
                      2
                    </div>
                    <h5 className="text-xs font-bold text-slate-200">Chọn Chế Độ Sáng Tạo</h5>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Sử dụng <strong>Chat với AI Agent</strong> để tạo nhanh bằng ngôn ngữ tự nhiên, hoặc <strong>Workflow Canvas</strong> để tinh chỉnh từng phân cảnh.
                    </p>
                  </div>
                  <div className="bg-slate-950/20 border border-slate-850 rounded-xl p-4 space-y-2">
                    <div className="w-6 h-6 rounded-lg bg-sky-500/10 flex items-center justify-center border border-sky-500/20 text-xs font-bold text-sky-400">
                      3
                    </div>
                    <h5 className="text-xs font-bold text-slate-200">Xuất Bản & Ghép Nối</h5>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Tải các thước phim lẻ về máy, hoặc yêu cầu Agent tự động ghép nối thành một video duy nhất hoàn hảo.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AI AGENT */}
          {activeTab === 'agent' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* Introduction */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Bot className="w-5 h-5 text-emerald-400" /> Trợ Lý AI Đa Năng - Điều Hướng Tự Động
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Bảng chat Agent là nơi bạn tương tác trực tiếp với các AI Agent chuyên biệt (Director Agent, Music Agent, Story Agent). 
                  Thay vì phải tự click thiết lập từng node thủ công, bạn chỉ cần trò chuyện, ra lệnh bằng tiếng Việt.
                </p>
              </div>

              {/* New Music Feature Details */}
              <div className="bg-gradient-to-r from-emerald-950/40 to-slate-900 border border-emerald-900/30 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                    <Music className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-emerald-300">TÍNH NĂNG MỚI: AI MUSIC VIDEO STORY PIPELINE (MP3/WAV UPLOAD)</h4>
                    <p className="text-[10px] text-slate-400">Tạo video khớp nhịp điệu và cảm xúc của bài hát</p>
                  </div>
                </div>
                
                <div className="text-xs text-slate-300 space-y-2.5">
                  <p>
                    Giờ đây bạn có thể sản xuất video ca nhạc hoặc video quảng cáo trên nền nhạc cực kỳ đơn giản:
                  </p>
                  <div className="pl-4 border-l-2 border-emerald-500/40 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">Bước 1:</span>
                      <span>Click nút <strong>Âm nhạc (Music Icon màu xanh lá 🟢)</strong> ngay bên trái nút tải ảnh trong thanh nhập chat. Chọn file âm thanh của bạn (MP3/WAV).</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">Bước 2:</span>
                      <span>AI Music Agent tự động kích hoạt, "lắng nghe" và phân tích cấu trúc, nhịp điệu (tempo), cảm xúc (mood) của bài hát, sau đó đề xuất <strong>3 ý tưởng kịch bản (Script Concepts)</strong>.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">Bước 3:</span>
                      <span>Bạn chọn 1 ý tưởng phù hợp. AI sẽ tự lập storyboard chi tiết gồm nhiều phân cảnh khớp với thời gian bài nhạc.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">Bước 4:</span>
                      <span>Hệ thống tự động kích hoạt tiến trình tạo ảnh (R2I), render video (I2V) cho từng phân cảnh và ghép nối thành một MV hoàn chỉnh.</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stop button explanation */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-rose-500/10 flex items-center justify-center border border-rose-500/20 text-rose-400">
                      ■
                    </div>
                    <h4 className="text-xs font-bold text-slate-200">Nút Dừng (Stop / Cancel)</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Khi ra lệnh cho Agent chạy hàng loạt tác vụ nặng (như sinh 10 phân cảnh liên tục), nếu bạn thấy kịch bản bị lệch hướng, hãy nhấn nút <strong>Dừng (Stop) màu đỏ</strong>. 
                    Mọi tác vụ đang chờ trong hàng đợi sẽ được hủy ngay lập tức để tiết kiệm tài nguyên và thời gian render.
                  </p>
                </div>

                <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                      <Video className="w-4 h-4 text-indigo-400" />
                    </div>
                    <h4 className="text-xs font-bold text-slate-200">I2V Agent Pipeline (Image-to-Video)</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Sau khi sinh ảnh thành công từ prompt, bạn chỉ cần gõ <code>"tạo video từ ảnh vừa vẽ"</code> hoặc chỉ định phân cảnh cụ thể. 
                    I2V Pipeline sẽ lấy hình ảnh đó làm hình nền gốc và biến đổi nó thành clip động sinh động với các chuyển động vật lý mượt mà.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: WORKFLOW CANVAS */}
          {activeTab === 'canvas' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* Introduction */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Workflow className="w-5 h-5 text-sky-400" /> Workflow Canvas - Làm Chủ Bảng Vẽ Nút Trực Quan
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Nếu ô chat Agent phù hợp để tự động hóa nhanh, thì <strong>Workflow Canvas</strong> chính là nơi dành cho các nhà thiết kế muốn kiểm soát tuyệt đối từng chi tiết. 
                  Canvas biểu diễn kịch bản của bạn dưới dạng các hộp (Node) trực quan có kết nối.
                </p>
              </div>

              {/* Detailed Node Explanation */}
              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-sky-400">
                  ⚙️ CÁC LOẠI NODE CHỦ CHỐT VÀ CÁCH SỬ DỤNG
                </h4>
                
                <div className="space-y-3.5">
                  {/* Node Character */}
                  <div className="flex gap-3.5 p-3.5 bg-slate-950/40 border border-slate-800 rounded-xl">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                      <Image className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div className="space-y-1">
                      <h5 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                        Character / Entity Node (Node Nhân vật/Sản phẩm)
                      </h5>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Nơi bạn tải lên các hình ảnh tham chiếu (Reference). Bạn có thể định nghĩa tên hiển thị của nhân vật hoặc sản phẩm tại đây (ví dụ: <code className="text-indigo-300 font-semibold">"model_A"</code>). 
                        Mọi hình ảnh sinh ra từ các node kết nối phía sau sẽ dựa vào ảnh tham chiếu này để giữ nguyên các chi tiết nhận diện thương hiệu.
                      </p>
                    </div>
                  </div>

                  {/* Node Scene/Prompt */}
                  <div className="flex gap-3.5 p-3.5 bg-slate-950/40 border border-slate-800 rounded-xl">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-sky-400" />
                    </div>
                    <div className="space-y-1">
                      <h5 className="text-xs font-bold text-slate-200">Scene & Prompt Node (Node Phân cảnh & Kịch bản)</h5>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Nơi lưu trữ lời thoại (Dialog), giọng đọc AI (Voice Speaker), mô tả hình ảnh (Visual Prompt). 
                        Bạn có thể nhấp đúp vào node này để đổi trực tiếp text kịch bản, chỉnh sửa tỉ lệ khung hình (Aspect Ratio), hay cố định hạt ngẫu nhiên (Seed) để tái tạo chính xác phong cách hình ảnh mong muốn.
                      </p>
                    </div>
                  </div>

                  {/* Media Nodes */}
                  <div className="flex gap-3.5 p-3.5 bg-slate-950/40 border border-slate-800 rounded-xl">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                      <Video className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="space-y-1">
                      <h5 className="text-xs font-bold text-slate-200">Image & Video Node (Khối Kết Quả Đầu Ra)</h5>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Hiển thị trực quan các bức ảnh hoặc đoạn video được sinh ra từ các phân cảnh. 
                        Bạn có thể nhấp chuột vào đây để xem trước phóng to, tải xuống cục bộ, hoặc nhấn nút **Tạo lại (Regenerate)** nếu kết quả chưa vừa ý.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* API Configuration & Controls */}
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2.5 text-xs text-slate-300">
                <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-indigo-400" /> Tinh Chỉnh Nâng Cao Trong Canvas
                </h4>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-400">
                  <li><strong>Lựa chọn Voice:</strong> App hỗ trợ nhiều giọng đọc AI tiếng Việt chất lượng cao. Bạn có thể chọn giọng trong node Scene.</li>
                  <li><strong>Camera Motion (Góc máy):</strong> Tự chọn góc máy quay ở mục nâng cao của Node Prompt trước khi render video để điều hướng dòng chảy hình ảnh theo đúng ý đồ đạo diễn.</li>
                  <li><strong>Xuất/Nhập Dự Án:</strong> Canvas tự động lưu tiến trình của bạn. Bạn không cần lo lắng bị mất dữ liệu khi tắt máy.</li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB 4: PRO TIPS */}
          {activeTab === 'tips' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* Golden Rules of Prompting */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-amber-400" /> Quy Tắc Vàng Giữ Đồng Nhất (R2I - Reference to Image)
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Để vẽ ra những bức ảnh quảng cáo hoặc mẫu người mẫu đẹp, giống 100% với ảnh gốc bạn đã tải lên node Character/Reference mà không bị biến dạng, hãy làm theo quy tắc sau:
                </p>

                <div className="p-4 bg-slate-950/60 border border-slate-850 rounded-xl space-y-3 font-mono text-[11px]">
                  <div className="flex items-start gap-2 text-rose-400">
                    <span className="text-rose-500 font-black">❌ SAI LẦM PHỔ BIẾN:</span>
                    <span className="leading-relaxed">
                      "A model with long brown wavy hair, wearing a white sports hoodie with a red zipper, blue sneakers, running in a modern park, smiling" 
                      <br/>
                      <span className="text-[10px] text-slate-500 font-sans italic block mt-1">
                        (Nhược điểm: Khi mô tả chi tiết lại thế này, AI sẽ tự vẽ ra một cô gái khác và cái áo hoodie khác hoàn toàn so với ảnh tham chiếu).
                      </span>
                    </span>
                  </div>
                  
                  <div className="border-t border-slate-800 my-2" />

                  <div className="flex items-start gap-2 text-emerald-400">
                    <span className="text-emerald-500 font-black">✅ QUY PHÁP ĐÚNG CHUẨN:</span>
                    <span className="leading-relaxed">
                      "the model is running in a modern park, side view, natural sunlight, cinematic look"
                      <br/>
                      <span className="text-[10px] text-slate-500 font-sans italic block mt-1">
                        (Ưu điểm: AI tự động phân tích ảnh tham chiếu của bạn, nhận diện chuẩn xác gương mặt và trang phục để đưa vào bối cảnh mới).
                      </span>
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-indigo-950/20 border border-indigo-900/30 rounded-xl flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-indigo-300 leading-relaxed">
                    <strong>Tóm lại:</strong> Chỉ cần gọi từ khóa vàng <code className="bg-indigo-950 px-1 py-0.5 rounded text-indigo-200 text-[10px]">the model</code> (đối với người) hoặc <code className="bg-indigo-950 px-1 py-0.5 rounded text-indigo-200 text-[10px]">the product</code> (đối với sản phẩm). Không liệt kê lại các nét đặc trưng đã xuất hiện ở ảnh tham chiếu!
                  </p>
                </div>
              </div>

              {/* Phân tách Image Prompt & Video Prompt */}
              <div className="space-y-3 p-4 bg-gradient-to-r from-violet-950/40 to-slate-900 border border-violet-900/30 rounded-2xl">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  ⚡ Sự Khác Biệt Giữa Image Prompt & Video Prompt (Omni I2V)
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Để tối ưu hóa chất lượng khi sử dụng mô hình tạo video thế hệ mới (Omni I2V), hệ thống phân tách độc lập tuyệt đối hai giai đoạn:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1.5 text-xs">
                  <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800 space-y-1.5">
                    <h4 className="font-bold text-violet-400 flex items-center gap-1">🖼️ 1. Giai đoạn vẽ ảnh tĩnh (Image Prompt)</h4>
                    <ul className="list-disc pl-4 text-[11px] text-slate-400 space-y-1 leading-normal">
                      <li><strong>Đặc điểm:</strong> Ngắn gọn (5-15 từ khi có ảnh tham chiếu), chỉ tả chủ thể và bối cảnh tĩnh.</li>
                      <li><strong>Nguyên tắc:</strong> KHÔNG thêm từ khóa chuyển động camera (Dolly, Pan, Zoom) hay chất lượng video ở bước này để tránh làm AI vẽ ảnh bị rối.</li>
                    </ul>
                  </div>
                  <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800 space-y-1.5">
                    <h4 className="font-bold text-emerald-400 flex items-center gap-1">🎬 2. Giai đoạn sinh chuyển động (Video Prompt)</h4>
                    <ul className="list-disc pl-4 text-[11px] text-slate-400 space-y-1 leading-normal">
                      <li><strong>Đặc điểm:</strong> Dài, chi tiết, chứa tham số điện ảnh rõ ràng (ví dụ: "Pan Left 30 degrees, slow Dolly In 2 meters").</li>
                      <li><strong>Nguyên tắc:</strong> Chỉ ra cách camera chuyển động tuần tự và chỉ dẫn chuyển động miệng (nhắm/mở tự nhiên) để khớp khẩu hình Voice AI.</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Automatic Video Merging Pro Tip */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  🎬 Nghệ Thuật Ghép Video (Smart Video Merge)
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Sau khi tất cả các phân đoạn video lẻ được render xong từ các node, bạn hãy chuyển sang ô chat Agent và gửi yêu cầu: 
                  <code className="text-amber-300 font-mono bg-amber-950/30 px-1 py-0.5 rounded ml-1 text-[11px]">"ghép các video lại và lồng nhạc cho tôi"</code>.
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Hệ thống sẽ chạy ngầm tiến trình ghép các clip lại với nhau, lồng ghép nhạc nền gốc (nếu bạn đã tải file MP3 nhạc lên trước đó), và tự động tính toán tạo các hiệu ứng chuyển cảnh (transitions) mượt mà để cho ra một sản phẩm hoàn thiện sẵn sàng đăng tải TikTok, Facebook Reels hay YouTube Shorts.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/60 border-t border-slate-850 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px]">
          <div className="text-slate-500 font-medium">
            FlowAgent Studio v0.3.0 &middot; Công cụ tự động hóa video AI cao cấp
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-slate-400">Cần trợ giúp thêm?</span>
            <a 
              href="https://zalo.me/0934415387" 
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold transition-all shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 flex items-center gap-1"
            >
              💬 Zalo kỹ thuật: 0934415387
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuideModal;
