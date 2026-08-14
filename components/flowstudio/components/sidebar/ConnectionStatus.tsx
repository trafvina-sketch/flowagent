import React from 'react';
import { Wifi, WifiOff, Server, Activity, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { ConnectionState } from '../../types';

const statusConfig: Record<ConnectionState, { color: string; bg: string; border: string; icon: React.ReactNode; label: string }> = {
  connected: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    label: 'Connected',
  },
  connecting: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />,
    label: 'Connecting...',
  },
  disconnected: {
    color: 'text-slate-500',
    bg: 'bg-slate-800/50',
    border: 'border-slate-700/50',
    icon: <XCircle className="w-4 h-4 text-slate-500" />,
    label: 'Disconnected',
  },
};

const ConnectionStatus: React.FC = () => {
  const flowkitStatus = useProjectStore((s) => s.flowkitStatus);
  const backendStatus = useProjectStore((s) => s.backendStatus);

  const fk = statusConfig[flowkitStatus];
  const be = statusConfig[backendStatus];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-indigo-400" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Connection Status</h3>
      </div>

      {/* Backend */}
      <div className={`flex items-center justify-between p-3 rounded-xl ${be.bg} border ${be.border} transition-all`}>
        <div className="flex items-center gap-2.5">
          <Server className="w-4 h-4 text-slate-400" />
          <div>
            <p className="text-xs font-semibold text-slate-200">Backend API</p>
            <p className="text-[10px] text-slate-500">Port 8100</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {be.icon}
          <span className={`text-[10px] font-bold uppercase tracking-wider ${be.color}`}>{be.label}</span>
        </div>
      </div>

      {/* FlowAgent */}
      <div className={`flex items-center justify-between p-3 rounded-xl ${fk.bg} border ${fk.border} transition-all`}>
        <div className="flex items-center gap-2.5">
          {flowkitStatus === 'connected' ? (
            <Wifi className="w-4 h-4 text-emerald-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-slate-500" />
          )}
          <div>
            <p className="text-xs font-semibold text-slate-200">FlowAgent Extension</p>
            <p className="text-[10px] text-slate-500">WebSocket Bridge</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {fk.icon}
          <span className={`text-[10px] font-bold uppercase tracking-wider ${fk.color}`}>{fk.label}</span>
        </div>
      </div>

      {/* Uptime */}
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-slate-500">
        <Clock className="w-3 h-3" />
        <span>Last checked: just now</span>
      </div>
    </div>
  );
};

export default ConnectionStatus;
