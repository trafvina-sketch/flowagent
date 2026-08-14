import React, { useState, useEffect } from 'react';
import { AnalysisStep, StepStatus, KeyframeOutput } from '../types';
import { LoadingSpinner } from './icons/LoadingSpinner';
import { CheckIcon } from './icons/CheckIcon';
import CodeViewer from './CodeViewer';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

interface StepCardProps {
    step: AnalysisStep;
    isActive: boolean;
}

const StepCard: React.FC<StepCardProps> = ({ step, isActive }) => {
    const hasContent = (step.output && ((typeof step.output === 'string' && step.output.length > 0) || typeof step.output === 'object')) || step.error;
    const isCollapsible = step.status === StepStatus.COMPLETE && hasContent;

    const [isExpanded, setIsExpanded] = useState(true);

    // Adjust expanded state based on step status to automatically collapse completed steps.
    useEffect(() => {
        if (step.status === StepStatus.COMPLETE && !isActive) {
            setIsExpanded(false);
        } else if (step.status === StepStatus.PROCESSING || step.status === StepStatus.ERROR || isActive) {
            setIsExpanded(true);
        }
    }, [step.status, isActive]);

    const handleToggle = () => {
        if (isCollapsible) {
            setIsExpanded(prev => !prev);
        }
    };

    const renderStatusIcon = () => {
        switch (step.status) {
            case StepStatus.PROCESSING:
                return <LoadingSpinner className="w-5 h-5" />;
            case StepStatus.COMPLETE:
                return <div className="w-5 h-5 flex items-center justify-center bg-green-500 rounded-full"><CheckIcon className="w-3 h-3 text-white" /></div>;
            case StepStatus.ERROR:
                return <div className="w-5 h-5 flex items-center justify-center bg-red-500 text-white font-bold rounded-full text-sm">!</div>;
            case StepStatus.PENDING:
            default:
                return <div className="w-5 h-5 border-2 border-zinc-600 rounded-full"></div>;
        }
    };
    
    const getBorderColor = () => {
        if (step.status === StepStatus.ERROR) return 'border-red-500/50';
        if (isActive) return 'border-zinc-500';
        if (step.status === StepStatus.COMPLETE) return 'border-green-500/30';
        return 'border-zinc-800/50';
    };

    const renderOutput = () => {
        if (!step.output) return null;

        // Check for the special keyframe object but only display the log
        if (typeof step.output === 'object' && 'keyframes' in step.output && 'log' in step.output) {
            const keyframeOutput = step.output as KeyframeOutput;
            return (
                <div className="mt-3 pl-8">
                    <CodeViewer code={keyframeOutput.log} language="bash" />
                </div>
            );
        }
        
        // Fallback for regular string output
        if (typeof step.output === 'string') {
            return (
                <div className="mt-3 pl-8">
                    <CodeViewer code={step.output} language={step.output.startsWith('{') ? 'json' : 'bash'} />
                </div>
            );
        }
        
        return null;
    };


    return (
        <div className={`bg-zinc-900/50 p-0 rounded-xl border ${getBorderColor()} transition-colors backdrop-blur-sm`}>
             <div 
                className={`flex items-center justify-between p-4 ${isCollapsible ? 'cursor-pointer' : ''}`}
                onClick={handleToggle}
            >
                <div className="flex items-center gap-3">
                    {renderStatusIcon()}
                    <h3 className={`text-base font-semibold ${isActive ? 'text-zinc-100' : 'text-zinc-400'}`}>
                        {step.title}
                    </h3>
                </div>
                {isCollapsible && (
                    <ChevronDownIcon className={`w-5 h-5 text-zinc-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                )}
            </div>

            {isExpanded && hasContent && (
                 <div className="px-4 pb-4">
                    {renderOutput()}
                    {step.error && (
                        <div className="mt-3 pl-8">
                            <div className="bg-red-900/20 border border-red-500/30 rounded-md p-3 text-sm text-red-400">
                                <p className="font-semibold">Lỗi:</p>
                                <p className="text-red-300">{step.error}</p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default StepCard;