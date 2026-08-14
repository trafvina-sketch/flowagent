import React from 'react';
import {
    AnalysisState,
    VideoMetadata,
    StepStatus,
    GeminiAnalysisResponse
} from '../types';
import VideoHeader from './VideoHeader';
import { Stepper } from './Stepper';
import StepCard from './StepCard';
import JsonOutputCard from './JsonOutputCard';
import Step6Card from './Step6Card';
import { LoadingSpinner } from './icons/LoadingSpinner';

interface AnalysisViewProps {
    analysisState: AnalysisState | null;
    videoMetadata: VideoMetadata | null;
    error: string | null;
    finalResult: GeminiAnalysisResponse | null;
    appStatus?: 'idle' | 'processing' | 'finished';
    onReset?: () => void;
    onStop?: () => void;
    includeSrtAnalysis?: boolean;
    generateSrt?: boolean;
}

const STEP_TITLES = [
    "Siêu dữ liệu Video",
    "Tải Video (Mô phỏng)",
    "Phân tích Ngược (Ảnh)",
    "Detect Cảnh quay",
    "Trích xuất Keyframe",
    "Dàn ý Kịch bản (AI)",
    "Chi tiết Cảnh quay (AI)",
    "Cấu trúc JSON",
    "Final Prompts",
];

const AnalysisView: React.FC<AnalysisViewProps> = ({
    analysisState,
    videoMetadata,
    error,
    finalResult,
    appStatus,
    onReset,
    onStop,
    includeSrtAnalysis,
    generateSrt,
}) => {
    
    const renderAnalysisProgress = () => {
        if (!analysisState) {
            return (
                <div className="flex flex-col items-center justify-center text-center p-8 bg-zinc-900/50 rounded-xl border border-zinc-800/50 backdrop-blur-sm">
                    <LoadingSpinner className="w-12 h-12 text-zinc-400" />
                    <p className="mt-4 text-zinc-400 font-medium">Đang khởi tạo trình phân tích...</p>
                </div>
            );
        }

        const stepTitles = analysisState.steps.map(s => s.title);

        return (
            <div className="space-y-4">
                <div className="bg-zinc-900/50 p-4 sm:p-6 rounded-xl border border-zinc-800/50 backdrop-blur-sm">
                    <Stepper currentStep={analysisState.currentStep} steps={stepTitles} />
                </div>
                {analysisState.steps.map((step, index) => {
                    if (index === analysisState.steps.length - 1 && step.status === StepStatus.COMPLETE && finalResult) {
                         return <Step6Card key={index} result={finalResult} initialIncludeSrt={includeSrtAnalysis} generateSrt={generateSrt} />;
                    }
                    if (index === analysisState.steps.length - 2 && step.status === StepStatus.COMPLETE && finalResult) {
                        return <JsonOutputCard key={index} result={finalResult} />;
                    }
                    return (
                        <StepCard 
                            key={index} 
                            step={step}
                            isActive={analysisState.currentStep === index} 
                        />
                    );
                })}
            </div>
        );
    };
    
    return (
        <div className="space-y-6">
            {videoMetadata && <VideoHeader metadata={videoMetadata} />}

            {/* Điều khiển phân tích inline (Dừng) khi đang chạy */}
            {appStatus === 'processing' && onStop && (
                <div className="flex justify-center p-2">
                    <button
                        onClick={onStop}
                        className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white transition-all duration-300 hover:scale-105 active:scale-95 bg-red-600 hover:bg-red-500 hover:shadow-[0_0_20px_rgba(239,68,68,0.4)] cursor-pointer"
                        style={{ animation: 'buttonPulse 2s infinite ease-in-out' }}
                    >
                        <span className="w-3.5 h-3.5 bg-white rounded-sm inline-block" />
                        Dừng phân tích ngay lập tức
                    </button>
                    <style>{`
                        @keyframes buttonPulse {
                            0%, 100% { box-shadow: 0 0 15px rgba(239,68,68,0.4); }
                            50% { box-shadow: 0 0 25px rgba(239,68,68,0.7); }
                        }
                    `}</style>
                </div>
            )}

            {error && (
                 <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-6 text-center backdrop-blur-sm space-y-4">
                    <div>
                        <span className="text-3xl">⚠️</span>
                        <h3 className="text-lg font-bold text-red-400 mt-2">Phân tích không thành công</h3>
                        <p className="text-red-300/80 text-xs font-mono mt-1 bg-red-950/40 p-2.5 rounded-lg border border-red-900/30 inline-block max-w-full overflow-x-auto">{error}</p>
                    </div>
                    
                    {/* Nút Phân tích mới to nổi bật ngay dưới thông báo lỗi */}
                    {onReset && (
                        <div className="pt-2">
                            <button
                                onClick={onReset}
                                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer"
                                style={{
                                    background: 'linear-gradient(135deg, var(--color-accent), var(--color-cyan))',
                                    boxShadow: '0 4px 15px var(--color-accent-dim)'
                                }}
                            >
                                🧬 Phân tích Video khác (Nhập URL mới)
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Nút Phân tích mới khi đã hoàn thành thành công */}
            {finalResult && appStatus === 'finished' && onReset && (
                <div className="flex justify-center pt-2">
                    <button
                        onClick={onReset}
                        className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold text-white transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer"
                        style={{
                            background: 'linear-gradient(135deg, var(--color-accent), var(--color-cyan))',
                            boxShadow: '0 4px 20px var(--color-accent-dim)'
                        }}
                    >
                        🧬 Phân tích Video mới
                    </button>
                </div>
            )}
            
            {renderAnalysisProgress()}
        </div>
    );
};

export default AnalysisView;