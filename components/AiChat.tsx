
import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import { SendIcon } from './icons/SendIcon';
import { LoadingSpinner } from './icons/LoadingSpinner';

interface AiChatProps {
    messages: ChatMessage[];
    onSendMessage: (message: string) => void;
    isLoading: boolean;
}

const AiChat: React.FC<AiChatProps> = ({ messages, onSendMessage, isLoading }) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim()) {
            onSendMessage(input);
            setInput('');
        }
    };

    return (
        <div className="bg-zinc-900/50 rounded-xl flex flex-col h-full w-full max-h-[calc(100vh-200px)] lg:max-h-full border border-zinc-800/50 backdrop-blur-sm">
            <div className="p-4 border-b border-zinc-800/50">
                <h3 className="text-lg font-semibold text-zinc-100">Hỏi AI về video này</h3>
            </div>
            <div className="flex-grow p-4 overflow-y-auto">
                <div className="space-y-4">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex items-start gap-3 ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                            {msg.sender === 'ai' && (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex-shrink-0"></div>
                            )}
                            <div
                                className={`max-w-xs md:max-w-sm lg:max-w-md px-4 py-2 rounded-xl ${
                                    msg.sender === 'user'
                                        ? 'bg-zinc-100 text-zinc-900 rounded-br-none'
                                        : 'bg-zinc-800 text-zinc-300 rounded-bl-none'
                                }`}
                            >
                                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex-shrink-0"></div>
                             <div className="max-w-xs px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 rounded-bl-none">
                                <LoadingSpinner className="w-5 h-5 text-zinc-400" />
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>
            <div className="p-4 border-t border-zinc-800/50">
                <form onSubmit={handleSend} className="flex items-center gap-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="ví dụ: Tóm tắt video..."
                        className="flex-grow bg-zinc-900/50 border border-zinc-700 rounded-full px-4 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:ring-2 focus:ring-zinc-500 outline-none"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-full text-zinc-900 hover:bg-zinc-300 disabled:bg-zinc-800 disabled:text-zinc-500 transition-colors"
                    >
                        <SendIcon />
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AiChat;