
import React from 'react';

interface StepperProps {
    currentStep: number;
    steps: string[];
}

export const Stepper: React.FC<StepperProps> = ({ currentStep, steps }) => {
    return (
        <nav aria-label="Progress" className="overflow-x-auto pb-2 scrollbar-hide">
            <ol role="list" className="flex space-x-4 md:space-x-8 min-w-max">
                {steps.map((step, index) => (
                    <li key={index} className="flex-shrink-0 w-32 md:w-auto md:flex-1">
                        {index < currentStep ? (
                            <div className="group flex flex-col border-l-4 border-zinc-100 py-2 pl-4 md:border-l-0 md:border-t-4 md:pl-0 md:pt-4 md:pb-0">
                                <span className="text-sm font-medium text-zinc-400">{`Step ${index + 1}`}</span>
                                <span className="text-sm font-medium text-zinc-300">{step}</span>
                            </div>
                        ) : index === currentStep ? (
                            <div className="group flex flex-col border-l-4 border-zinc-100 py-2 pl-4 md:border-l-0 md:border-t-4 md:pl-0 md:pt-4 md:pb-0" aria-current="step">
                                <span className="text-sm font-medium text-zinc-100">{`Step ${index + 1}`}</span>
                                <span className="text-sm font-medium text-zinc-100">{step}</span>
                            </div>
                        ) : (
                             <div className="group flex flex-col border-l-4 border-zinc-800 py-2 pl-4 md:border-l-0 md:border-t-4 md:pl-0 md:pt-4 md:pb-0">
                                <span className="text-sm font-medium text-zinc-600">{`Step ${index + 1}`}</span>
                                <span className="text-sm font-medium text-zinc-600">{step}</span>
                            </div>
                        )}
                    </li>
                ))}
            </ol>
        </nav>
    );
};