import React, { useState } from 'react';
import { CopyIcon } from './icons/CopyIcon';
import { CheckIcon } from './icons/CheckIcon';

interface CodeViewerProps {
    code: string;
    language?: string;
}

const CodeViewer: React.FC<CodeViewerProps> = ({ code, language = 'json' }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bg-gray-800 rounded-md overflow-hidden relative group border border-gray-600">
            <div className="flex justify-between items-center px-4 py-1 bg-gray-700 border-b border-gray-600">
                <span className="text-xs font-semibold text-gray-400 uppercase">{language}</span>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 rounded-md hover:bg-gray-600 transition-colors"
                >
                    {copied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <CopyIcon className="w-4 h-4" />}
                    {copied ? 'Đã chép!' : 'Chép'}
                </button>
            </div>
            <pre className="p-4 text-xs text-gray-200 overflow-x-auto">
                <code>{code}</code>
            </pre>
        </div>
    );
};

export default CodeViewer;